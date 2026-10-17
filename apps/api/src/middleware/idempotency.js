import crypto from 'node:crypto';
import { db } from '../database/db.js';
export function checkIdempotency(actorId, route, key, bodyRaw) {
    const bodyHash = crypto.createHash('sha256').update(bodyRaw).digest('hex');
    const existing = db.queryOne(`SELECT * FROM idempotency WHERE actor_id = ? AND route = ? AND key = ? AND expires_at > ?`, [actorId, route, key, new Date().toISOString()]);
    if (!existing) {
        return null;
    }
    if (existing.body_hash !== bodyHash) {
        return 'CONFLICT';
    }
    return {
        responseCode: existing.response_code,
        responseBody: existing.response_body,
    };
}
export function saveIdempotency(actorId, route, key, bodyRaw, statusCode, responseBody) {
    const bodyHash = crypto.createHash('sha256').update(bodyRaw).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    db.execute(`INSERT OR REPLACE INTO idempotency (actor_id, route, key, body_hash, response_code, response_body, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [actorId, route, key, bodyHash, statusCode, responseBody, expiresAt, new Date().toISOString()]);
}
