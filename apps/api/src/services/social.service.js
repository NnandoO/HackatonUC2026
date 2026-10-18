import fs from 'node:fs';
import { db } from '../database/db.js';

function getMetaConfig() {
    const tokenFile = process.env.META_ACCESS_TOKEN_FILE;
    const accessToken = tokenFile && fs.existsSync(tokenFile)
        ? fs.readFileSync(tokenFile, 'utf8').trim()
        : '';
    const instagramUserId = process.env.META_INSTAGRAM_USER_ID || '';
    const apiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';

    if (!accessToken || !instagramUserId) {
        throw new Error('META_NOT_CONFIGURED: falta token o identificador de Instagram.');
    }
    return { accessToken, instagramUserId, apiVersion };
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

async function graphRequest(pathname, body) {
    const { accessToken, apiVersion } = getMetaConfig();
    const response = await fetch(`https://graph.instagram.com/${apiVersion}/${pathname}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(body),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
        const message = payload.error?.message || `HTTP ${response.status}`;
        throw new Error(`META_API_ERROR: ${message}`);
    }
    return payload;
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
        const drafts = records.map((r) => ({
            id: r.id,
            productId: r.product_id,
            caption: r.caption,
            imageUrls: JSON.parse(r.image_urls || '[]'),
            status: 'prepared',
            mode: 'simulated',
        }));
        const nextCursor = hasMore && records.length > 0 ? records[records.length - 1].created_at : null;
        return { items: drafts, nextCursor };
    }

    async publishInstagramDraft(draftId) {
        const draft = db.queryOne(`SELECT * FROM social_drafts WHERE id = ?`, [draftId]);
        if (!draft) throw new Error('NOT_FOUND: Borrador social no encontrado.');

        const imageUrls = JSON.parse(draft.image_urls || '[]');
        const imageUrl = resolvePublicImageUrl(imageUrls[0]);

        const { instagramUserId } = getMetaConfig();
        const container = await graphRequest(`${instagramUserId}/media`, {
            image_url: imageUrl,
            caption: draft.caption,
        });
        if (!container.id) throw new Error('META_API_ERROR: Meta no devolvió el contenedor.');

        const published = await graphRequest(`${instagramUserId}/media_publish`, {
            creation_id: container.id,
        });
        if (!published.id) throw new Error('META_API_ERROR: Meta no confirmó la publicación.');

        return { draftId, provider: 'instagram', mediaId: published.id, status: 'published' };
    }
}
export const socialService = new SocialService();
