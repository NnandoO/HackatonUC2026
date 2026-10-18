import crypto from 'node:crypto';
import { db } from '../database/db.js';

export async function checkIdempotency(actorId, route, key, bodyRaw) {
    const bodyHash = crypto.createHash('sha256').update(bodyRaw).digest('hex');
    const existing = await db.queryOne(
        `SELECT * FROM idempotency WHERE actor_id = $1 AND route = $2 AND key = $3 AND expires_at > $4`,
        [actorId, route, key, new Date().toISOString()]
    );
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

export async function saveIdempotency(actorId, route, key, bodyRaw, statusCode, responseBody) {
    const bodyHash = crypto.createHash('sha256').update(bodyRaw).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const nowIso = new Date().toISOString();
    await db.execute(
        `INSERT INTO idempotency (actor_id, route, key, body_hash, response_code, response_body, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (actor_id, route, key) DO UPDATE SET
           body_hash = EXCLUDED.body_hash,
           response_code = EXCLUDED.response_code,
           response_body = EXCLUDED.response_body,
           expires_at = EXCLUDED.expires_at,
           created_at = EXCLUDED.created_at`,
        [actorId, route, key, bodyHash, statusCode, responseBody, expiresAt, nowIso]
    );
}
