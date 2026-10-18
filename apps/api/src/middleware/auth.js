import crypto from 'node:crypto';
import { db } from '../database/db.js';

export function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header)
        return {};
    const cookies = {};
    for (const part of header.split(';')) {
        const [k, v] = part.split('=').map((s) => s?.trim());
        if (k && v)
            cookies[k] = decodeURIComponent(v);
    }
    return cookies;
}

export async function getAuthContext(req) {
    const configuredServiceKey = process.env.ANGIBELL_ADMIN_SERVICE_KEY || '';
    const providedServiceKey = req.headers['x-angibell-admin-key'] || '';
    if (configuredServiceKey && typeof providedServiceKey === 'string') {
        const expected = Buffer.from(configuredServiceKey);
        const provided = Buffer.from(providedServiceKey);
        if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
            const actorId = 'web-panel-service';
            await db.execute(
                `INSERT INTO actors (id, role, created_at) VALUES ($1, 'admin', $2) ON CONFLICT (id) DO NOTHING`,
                [actorId, new Date().toISOString()]
            );
            return { actorId, role: 'admin' };
        }
    }

    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req);
    const token = authHeader?.replace(/^Bearer\s+/i, '') || cookies['angibell_session'];
    const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method?.toUpperCase() || 'GET');

    if (!token) {
        const actorId = crypto.randomUUID();
        if (!isReadOnly) {
            await db.execute(
                `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
                [actorId, new Date().toISOString()]
            );
        }
        return { actorId, role: 'customer' };
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await db.queryOne(
        `SELECT s.*, a.role, a.phone
         FROM sessions s
         JOIN actors a ON s.actor_id = a.id
         WHERE s.token_hash = $1 AND s.expires_at > $2`,
        [tokenHash, new Date().toISOString()]
    );

    if (session) {
        if (session.role === 'admin') {
            const authorized = await db.queryOne(
                `SELECT phone FROM authorized_admins WHERE actor_id = $1 AND active = 1`,
                [session.actor_id]
            );
            if (!authorized) {
                const actorId = crypto.randomUUID();
                if (!isReadOnly) {
                    await db.execute(
                        `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
                        [actorId, new Date().toISOString()]
                    );
                }
                return { actorId, role: 'customer' };
            }
        }
        return {
            actorId: session.actor_id,
            role: session.role,
            phone: session.phone || undefined,
        };
    }

    // Fallback to customer
    const actorId = crypto.randomUUID();
    if (!isReadOnly) {
        await db.execute(
            `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
            [actorId, new Date().toISOString()]
        );
    }
    return { actorId, role: 'customer' };
}

export async function createCustomerSession(actorId) {
    const id = actorId || crypto.randomUUID();
    const token = `ang_cust_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    await db.transaction(async () => {
        await db.execute(
            `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
            [id, now.toISOString()]
        );
        await db.execute(
            `INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
            [tokenHash, id, expiresAt, now.toISOString()]
        );
    });
    return { token, expiresAt, actorId: id };
}

export async function createAdminSession(phone = '+51995992450') {
    const newActorId = crypto.randomUUID();
    const token = `ang_admin_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    let finalActorId = newActorId;
    await db.transaction(async () => {
        const existing = await db.queryOne(`SELECT * FROM authorized_admins WHERE phone = $1`, [phone]);
        if (!existing) {
            await db.execute(
                `INSERT INTO actors (id, role, phone, created_at) VALUES ($1, 'admin', $2, $3)`,
                [newActorId, phone, now.toISOString()]
            );
            await db.execute(
                `INSERT INTO authorized_admins (actor_id, phone, active) VALUES ($1, $2, 1)`,
                [newActorId, phone]
            );
            await db.execute(
                `INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
                [tokenHash, newActorId, expiresAt, now.toISOString()]
            );
        } else {
            finalActorId = existing.actor_id;
            await db.execute(
                `INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
                [tokenHash, existing.actor_id, expiresAt, now.toISOString()]
            );
        }
    });
    return { token, expiresAt, actorId: finalActorId };
}
