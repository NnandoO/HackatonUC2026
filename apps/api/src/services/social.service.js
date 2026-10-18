import fs from 'node:fs';
import crypto from 'node:crypto';
import { db } from '../database/db.js';

function readSecretFile(filePath) {
    if (!filePath) return '';
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
        return '';
    }
}

async function getCredentials(provider) {
    const apiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
    if (provider === 'instagram') {
        const accessToken = readSecretFile(process.env.META_ACCESS_TOKEN_FILE);
        const accountId = process.env.META_INSTAGRAM_USER_ID || '';
        if (!accessToken || !accountId) {
            throw new Error('META_NOT_CONFIGURED: falta el token de Instagram o META_INSTAGRAM_USER_ID.');
        }
        return { accessToken, accountId, host: 'graph.instagram.com', apiVersion };
    }
    const connection = await db.queryOne(`SELECT * FROM meta_facebook_connection WHERE id = 1`);
    const accessToken = connection ? decryptToken(connection) : readSecretFile(process.env.META_FACEBOOK_PAGE_TOKEN_FILE);
    const accountId = connection?.page_id || process.env.META_FACEBOOK_PAGE_ID || '';
    if (!accessToken || !accountId) {
        throw new Error('META_NOT_CONFIGURED: falta el token de la Página o META_FACEBOOK_PAGE_ID.');
    }
    return { accessToken, accountId, host: 'graph.facebook.com', apiVersion };
}

function encryptionKey() {
    const value = process.env.META_TOKEN_ENCRYPTION_KEY || '';
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('META_NOT_CONFIGURED: falta META_TOKEN_ENCRYPTION_KEY de 32 bytes en hexadecimal.');
    return Buffer.from(value, 'hex');
}

function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { token_ciphertext: ciphertext.toString('base64'), token_iv: iv.toString('base64'), token_tag: cipher.getAuthTag().toString('base64') };
}

function decryptToken(record) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.token_iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.token_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.token_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

async function metaGet(pathname, params = {}) {
    const query = new URLSearchParams(params);
    const response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}/${pathname}?${query}`, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(`META_API_ERROR: ${payload.error?.message || `HTTP ${response.status}`}`);
    return payload;
}

export function resolvePublicImageUrl(imageUrl) {
    if (/^https:\/\//i.test(imageUrl || '')) return imageUrl;
    const publicBaseUrl = String(process.env.PUBLIC_MEDIA_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBaseUrl || !/^https:\/\//i.test(publicBaseUrl)) {
        throw new Error('MEDIA_NOT_PUBLIC: configura PUBLIC_MEDIA_BASE_URL con la URL HTTPS pública del backend.');
    }
    if (!String(imageUrl || '').startsWith('/media/')) {
        throw new Error('INVALID_INPUT: la imagen del producto no tiene una ruta publicable.');
    }
    return `${publicBaseUrl}${imageUrl}`;
}

async function graphRequest(provider, pathname, body) {
    const { accessToken, host, apiVersion } = await getCredentials(provider);
    let response;
    try {
        response = await fetch(`https://${host}/${apiVersion}/${pathname}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(body),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        // A transport error after sending a POST is ambiguous; do not retry automatically.
        error.metaRequestSent = true;
        throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
        const message = payload.error?.message || `HTTP ${response.status}`;
        const error = new Error(`META_API_ERROR: ${message}`);
        error.metaResponseReceived = true;
        throw error;
    }
    return payload;
}

async function waitForInstagramContainer(containerId) {
    const { accessToken, host, apiVersion } = await getCredentials('instagram');
    for (let attempt = 0; attempt < 7; attempt++) {
        const response = await fetch(`https://${host}/${apiVersion}/${containerId}?fields=status_code,status`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json();
        if (!response.ok || payload.error) throw new Error(`META_CONTAINER_ERROR: ${payload.error?.message || response.status}`);
        if (payload.status_code === 'FINISHED') return;
        if (['ERROR', 'EXPIRED', 'PUBLISHED'].includes(payload.status_code)) {
            throw new Error(`META_CONTAINER_${payload.status_code}: ${payload.status || 'El contenedor no está disponible para publicar.'}`);
        }
        if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('META_CONTAINER_PROCESSING: Instagram todavía está preparando la imagen. No se publicó.');
}

async function beginPublication(draftId, provider) {
    const existing = await db.queryOne(
        `SELECT * FROM social_publications WHERE draft_id = $1 AND provider = $2`,
        [draftId, provider],
    );
    if (existing?.status === 'published') {
        return { alreadyPublished: true, record: existing };
    }
    if (existing && ['publishing', 'unknown'].includes(existing.status)) {
        throw new Error('PUBLICATION_UNCERTAIN: Meta podría haber recibido el envío. Verifica la Página antes de reintentar.');
    }
    const now = new Date().toISOString();
    if (existing?.status === 'failed') {
        await db.execute(
            `UPDATE social_publications SET status = 'publishing', error = NULL, attempts = attempts + 1, updated_at = $1 WHERE id = $2`,
            [now, existing.id]
        );
        return { alreadyPublished: false, record: { ...existing, status: 'publishing', attempts: existing.attempts + 1 } };
    }
    const id = crypto.randomUUID();
    await db.execute(
        `INSERT INTO social_publications (id, draft_id, provider, status, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, 'publishing', 1, $4, $5)`,
        [id, draftId, provider, now, now]
    );
    return { alreadyPublished: false, record: { id, draft_id: draftId, provider, status: 'publishing', attempts: 1 } };
}

async function finishPublication(id, status, remoteId = null, errorMessage = null) {
    const now = new Date().toISOString();
    await db.execute(
        `UPDATE social_publications SET status = $1, remote_id = $2, error = $3, updated_at = $4 WHERE id = $5`,
        [status, remoteId, errorMessage, now, id]
    );
}

export class SocialService {
    async getSocialDrafts(options = {}) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const cursor = options.cursor;
        let sql = `SELECT * FROM social_drafts WHERE 1=1`;
        const params = [];
        if (cursor) {
            params.push(cursor);
            sql += ` AND created_at < $${params.length}`;
        }
        params.push(limit + 1);
        sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
        const rows = await db.query(sql, params);
        const hasMore = rows.length > limit;
        const records = hasMore ? rows.slice(0, limit) : rows;
        const drafts = await Promise.all(records.map(async (r) => {
            const publications = await db.query(
                `SELECT provider, status, remote_id, error, updated_at FROM social_publications WHERE draft_id = $1`,
                [r.id]
            );
            return {
                id: r.id,
                productId: r.product_id,
                caption: r.caption,
                imageUrls: JSON.parse(r.image_urls || '[]'),
                status: 'prepared',
                publications: Object.fromEntries(publications.map((item) => [item.provider, {
                    status: item.status,
                    remoteId: item.remote_id,
                    error: item.error,
                    updatedAt: item.updated_at,
                }])),
            };
        }));
        const nextCursor = hasMore && records.length > 0 ? records[records.length - 1].created_at : null;
        return { items: drafts, nextCursor, connections: await this.getConnectionStatus() };
    }

    async getConnectionStatus() {
        const connected = await db.queryOne(`SELECT page_id, page_name FROM meta_facebook_connection WHERE id = 1`);
        return {
            facebook: Boolean(connected || (readSecretFile(process.env.META_FACEBOOK_PAGE_TOKEN_FILE) && process.env.META_FACEBOOK_PAGE_ID)),
            facebookPageName: connected?.page_name || '',
            facebookOAuthConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_OAUTH_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.META_TOKEN_ENCRYPTION_KEY || '')),
            instagram: Boolean(readSecretFile(process.env.META_ACCESS_TOKEN_FILE) && process.env.META_INSTAGRAM_USER_ID),
            publicMedia: /^https:\/\//i.test(process.env.PUBLIC_MEDIA_BASE_URL || process.env.PUBLIC_BASE_URL || ''),
            publishEnabled: process.env.META_PUBLISH_ENABLED === 'true',
        };
    }

    async beginFacebookOAuth() {
        if (!process.env.META_APP_ID || !process.env.META_APP_SECRET || !process.env.META_OAUTH_REDIRECT_URI) {
            throw new Error('META_NOT_CONFIGURED: configura META_APP_ID, META_APP_SECRET y META_OAUTH_REDIRECT_URI.');
        }
        encryptionKey();
        const state = crypto.randomBytes(32).toString('base64url');
        const now = new Date();
        await db.execute(`DELETE FROM meta_oauth_states WHERE expires_at < $1`, [now.toISOString()]);
        await db.execute(
            `INSERT INTO meta_oauth_states (state_hash, expires_at, created_at) VALUES ($1, $2, $3)`,
            [crypto.createHash('sha256').update(state).digest('hex'), new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString()]
        );
        const url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}/dialog/oauth`);
        const authParams = {
            client_id: process.env.META_APP_ID,
            redirect_uri: process.env.META_OAUTH_REDIRECT_URI,
            state,
            response_type: 'code',
        };
        const businessLoginConfigId = process.env.META_FACEBOOK_LOGIN_CONFIG_ID?.trim();
        if (businessLoginConfigId) {
            // Facebook Login for Business defines its scopes in a saved Meta configuration.
            authParams.config_id = businessLoginConfigId;
        } else {
            authParams.scope = 'pages_show_list,pages_read_engagement,pages_manage_posts';
        }
        url.search = new URLSearchParams(authParams).toString();
        return { authorizationUrl: url.toString() };
    }

    async completeFacebookOAuth(code, state) {
        if (!code || !state || typeof code !== 'string' || typeof state !== 'string' || code.length > 4096 || state.length > 256) throw new Error('INVALID_INPUT: respuesta OAuth inválida.');
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');
        const pendingState = await db.queryOne(
            `SELECT * FROM meta_oauth_states WHERE state_hash = $1 AND expires_at > $2`,
            [stateHash, new Date().toISOString()]
        );
        if (!pendingState) throw new Error('INVALID_INPUT: sesión OAuth vencida o inválida. Vuelve a conectar Facebook.');
        await db.execute(`DELETE FROM meta_oauth_states WHERE state_hash = $1`, [stateHash]);
        const shortLivedToken = await metaGet('oauth/access_token', { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: process.env.META_OAUTH_REDIRECT_URI, code });
        if (!shortLivedToken.access_token) throw new Error('META_API_ERROR: Meta no devolvió un token de acceso.');
        const longLivedToken = await metaGet('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: shortLivedToken.access_token });
        if (!longLivedToken.access_token) throw new Error('META_API_ERROR: Meta no devolvió un token de larga duración.');
        const pages = await metaGet('me/accounts', { fields: 'id,name,access_token,tasks', access_token: longLivedToken.access_token });
        const eligible = (pages.data || []).filter((page) => page.id && page.name && page.access_token && (!Array.isArray(page.tasks) || page.tasks.includes('CREATE_CONTENT') || page.tasks.includes('PROFILE_PLUS_CREATE_CONTENT')));
        if (!eligible.length) throw new Error('META_NOT_CONFIGURED: la cuenta no tiene Páginas con permiso para crear contenido.');
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        await db.execute(`DELETE FROM meta_pending_pages`);
        for (const page of eligible) {
            const encrypted = encryptToken(page.access_token);
            await db.execute(
                `INSERT INTO meta_pending_pages (page_id, page_name, token_ciphertext, token_iv, token_tag, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [page.id, page.name, encrypted.token_ciphertext, encrypted.token_iv, encrypted.token_tag, expiresAt]
            );
        }
        return { pages: eligible.map(({ id, name }) => ({ id, name })) };
    }

    async listFacebookPages() {
        await db.execute(`DELETE FROM meta_pending_pages WHERE expires_at < $1`, [new Date().toISOString()]);
        return db.query(`SELECT page_id AS id, page_name AS name FROM meta_pending_pages ORDER BY page_name`);
    }

    async selectFacebookPage(pageId) {
        const page = await db.queryOne(
            `SELECT * FROM meta_pending_pages WHERE page_id = $1 AND expires_at > $2`,
            [pageId, new Date().toISOString()]
        );
        if (!page) throw new Error('NOT_FOUND: Página no disponible; vuelve a conectar Facebook.');
        await db.execute(
            `INSERT INTO meta_facebook_connection (id, page_id, page_name, token_ciphertext, token_iv, token_tag, connected_at)
             VALUES (1, $1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               page_id = EXCLUDED.page_id,
               page_name = EXCLUDED.page_name,
               token_ciphertext = EXCLUDED.token_ciphertext,
               token_iv = EXCLUDED.token_iv,
               token_tag = EXCLUDED.token_tag,
               connected_at = EXCLUDED.connected_at`,
            [page.page_id, page.page_name, page.token_ciphertext, page.token_iv, page.token_tag, new Date().toISOString()]
        );
        await db.execute(`DELETE FROM meta_pending_pages`);
        return { connected: true, pageName: page.page_name };
    }

    async disconnectFacebook() {
        await db.execute(`DELETE FROM meta_facebook_connection`);
        await db.execute(`DELETE FROM meta_pending_pages`);
        return { connected: false };
    }

    async publishDraft(draftId, provider) {
        if (!['facebook', 'instagram'].includes(provider)) throw new Error('INVALID_INPUT: red social no admitida.');
        if (process.env.META_PUBLISH_ENABLED !== 'true') {
            throw new Error('META_PUBLISH_DISABLED: la publicación externa está desactivada; el demo solo prepara borradores.');
        }
        const draft = await db.queryOne(`SELECT * FROM social_drafts WHERE id = $1`, [draftId]);
        if (!draft) throw new Error('NOT_FOUND: Borrador social no encontrado.');

        const { alreadyPublished, record } = await beginPublication(draftId, provider);
        if (alreadyPublished) {
            return { draftId, provider, mediaId: record.remote_id, status: 'published', alreadyPublished: true };
        }

        try {
            const imageUrls = JSON.parse(draft.image_urls || '[]');
            const imageUrl = resolvePublicImageUrl(imageUrls[0]);
            const { accountId } = await getCredentials(provider);
            let published;
            if (provider === 'instagram') {
                const container = await graphRequest(provider, `${accountId}/media`, {
                    image_url: imageUrl,
                    caption: draft.caption,
                });
                if (!container.id) throw new Error('META_API_ERROR: Meta no devolvió el contenedor.');
                await waitForInstagramContainer(container.id);
                published = await graphRequest(provider, `${accountId}/media_publish`, {
                    creation_id: container.id,
                });
            } else {
                published = await graphRequest(provider, `${accountId}/photos`, {
                    url: imageUrl,
                    caption: draft.caption,
                });
            }
            if (!published.id) throw new Error('META_API_ERROR: Meta no confirmó la publicación.');
            await finishPublication(record.id, 'published', published.post_id || published.id);
            return { draftId, provider, mediaId: published.post_id || published.id, status: 'published' };
        } catch (error) {
            const uncertain = error?.metaRequestSent && !error?.metaResponseReceived;
            await finishPublication(record.id, uncertain ? 'unknown' : 'failed', null,
                error instanceof Error ? error.message : 'Error desconocido al publicar.');
            throw error;
        }
    }

    async publishInstagramDraft(draftId) {
        return this.publishDraft(draftId, 'instagram');
    }

    async publishFacebookDraft(draftId) {
        return this.publishDraft(draftId, 'facebook');
    }
}

export const socialService = new SocialService();
