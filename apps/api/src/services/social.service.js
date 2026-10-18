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

function getCredentials(provider) {
    const apiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
    if (provider === 'instagram') {
        const accessToken = readSecretFile(process.env.META_ACCESS_TOKEN_FILE);
        const accountId = process.env.META_INSTAGRAM_USER_ID || '';
        if (!accessToken || !accountId) {
            throw new Error('META_NOT_CONFIGURED: falta el token de Instagram o META_INSTAGRAM_USER_ID.');
        }
        return { accessToken, accountId, host: 'graph.instagram.com', apiVersion };
    }
    const accessToken = readSecretFile(process.env.META_FACEBOOK_PAGE_TOKEN_FILE);
    const accountId = process.env.META_FACEBOOK_PAGE_ID || '';
    if (!accessToken || !accountId) {
        throw new Error('META_NOT_CONFIGURED: falta el token de la Página o META_FACEBOOK_PAGE_ID.');
    }
    return { accessToken, accountId, host: 'graph.facebook.com', apiVersion };
}

export function resolvePublicImageUrl(imageUrl) {
    if (/^https:\/\//i.test(imageUrl || '')) return imageUrl;
    const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBaseUrl || !/^https:\/\//i.test(publicBaseUrl)) {
        throw new Error('MEDIA_NOT_PUBLIC: configura PUBLIC_BASE_URL con la URL HTTPS pública del backend.');
    }
    if (!String(imageUrl || '').startsWith('/media/')) {
        throw new Error('INVALID_INPUT: la imagen del producto no tiene una ruta publicable.');
    }
    return `${publicBaseUrl}${imageUrl}`;
}

async function graphRequest(provider, pathname, body) {
    const { accessToken, host, apiVersion } = getCredentials(provider);
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

function beginPublication(draftId, provider) {
    const existing = db.queryOne(
        `SELECT * FROM social_publications WHERE draft_id = ? AND provider = ?`,
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
        db.execute(`UPDATE social_publications SET status = 'publishing', error = NULL, attempts = attempts + 1, updated_at = ? WHERE id = ?`, [now, existing.id]);
        return { alreadyPublished: false, record: { ...existing, status: 'publishing', attempts: existing.attempts + 1 } };
    }
    const id = crypto.randomUUID();
    db.execute(`INSERT INTO social_publications (id, draft_id, provider, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'publishing', 1, ?, ?)`, [id, draftId, provider, now, now]);
    return { alreadyPublished: false, record: { id, draft_id: draftId, provider, status: 'publishing', attempts: 1 } };
}

function finishPublication(id, status, remoteId = null, errorMessage = null) {
    const now = new Date().toISOString();
    db.execute(`UPDATE social_publications SET status = ?, remote_id = ?, error = ?, updated_at = ? WHERE id = ?`,
        [status, remoteId, errorMessage, now, id]);
}

export class SocialService {
    getSocialDrafts(options) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const cursor = options.cursor;
        let sql = `SELECT * FROM social_drafts WHERE 1=1`;
        const params = [];
        if (cursor) {
            sql += ` AND created_at < ?`;
            params.push(cursor);
        }
        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit + 1);
        const rows = db.query(sql, params);
        const hasMore = rows.length > limit;
        const records = hasMore ? rows.slice(0, limit) : rows;
        const drafts = records.map((r) => {
            const publications = db.query(`SELECT provider, status, remote_id, error, updated_at FROM social_publications WHERE draft_id = ?`, [r.id]);
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
        });
        const nextCursor = hasMore && records.length > 0 ? records[records.length - 1].created_at : null;
        return { items: drafts, nextCursor, connections: this.getConnectionStatus() };
    }

    getConnectionStatus() {
        return {
            facebook: Boolean(readSecretFile(process.env.META_FACEBOOK_PAGE_TOKEN_FILE) && process.env.META_FACEBOOK_PAGE_ID),
            instagram: Boolean(readSecretFile(process.env.META_ACCESS_TOKEN_FILE) && process.env.META_INSTAGRAM_USER_ID),
            publicMedia: /^https:\/\//i.test(process.env.PUBLIC_BASE_URL || ''),
        };
    }

    async publishDraft(draftId, provider) {
        if (!['facebook', 'instagram'].includes(provider)) throw new Error('INVALID_INPUT: red social no admitida.');
        const draft = db.queryOne(`SELECT * FROM social_drafts WHERE id = ?`, [draftId]);
        if (!draft) throw new Error('NOT_FOUND: Borrador social no encontrado.');

        const { alreadyPublished, record } = beginPublication(draftId, provider);
        if (alreadyPublished) {
            return { draftId, provider, mediaId: record.remote_id, status: 'published', alreadyPublished: true };
        }

        try {
            const imageUrls = JSON.parse(draft.image_urls || '[]');
            const imageUrl = resolvePublicImageUrl(imageUrls[0]);
            const { accountId } = getCredentials(provider);
            let published;
            if (provider === 'instagram') {
                const container = await graphRequest(provider, `${accountId}/media`, {
                    image_url: imageUrl,
                    caption: draft.caption,
                });
                if (!container.id) throw new Error('META_API_ERROR: Meta no devolvió el contenedor.');
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
            finishPublication(record.id, 'published', published.post_id || published.id);
            return { draftId, provider, mediaId: published.post_id || published.id, status: 'published' };
        } catch (error) {
            const uncertain = error?.metaRequestSent && !error?.metaResponseReceived;
            finishPublication(record.id, uncertain ? 'unknown' : 'failed', null,
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
