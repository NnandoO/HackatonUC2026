import { db } from '../database/db.js';
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
}
export const socialService = new SocialService();
