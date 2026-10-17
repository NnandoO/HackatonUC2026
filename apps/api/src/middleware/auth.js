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
export function getAuthContext(req) {
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req);
    const token = authHeader?.replace(/^Bearer\s+/i, '') || cookies['angibell_session'];
    if (!token) {
        // Generate an ephemeral customer session if none provided
        const actorId = crypto.randomUUID();
        db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'customer', ?)`, [actorId, new Date().toISOString()]);
        return { actorId, role: 'customer' };
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = db.queryOne(`SELECT s.*, a.role, a.phone
     FROM sessions s
     JOIN actors a ON s.actor_id = a.id
     WHERE s.token_hash = ? AND s.expires_at > ?`, [tokenHash, new Date().toISOString()]);
    if (session) {
        return {
            actorId: session.actor_id,
            role: session.role,
            phone: session.phone || undefined,
        };
    }
    // Fallback to customer
    const actorId = crypto.randomUUID();
    db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'customer', ?)`, [actorId, new Date().toISOString()]);
    return { actorId, role: 'customer' };
}
export function createCustomerSession(actorId) {
    const id = actorId || crypto.randomUUID();
    const token = `ang_cust_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    db.transaction(() => {
        const existing = db.queryOne(`SELECT id FROM actors WHERE id = ?`, [id]);
        if (!existing) {
            db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'customer', ?)`, [id, now.toISOString()]);
        }
        db.execute(`INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES (?, ?, ?, ?)`, [tokenHash, id, expiresAt, now.toISOString()]);
    });
    return { token, expiresAt, actorId: id };
}
export function createAdminSession(phone = '+51999888777') {
    const actorId = crypto.randomUUID();
    const token = `ang_admin_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    db.transaction(() => {
        const existing = db.queryOne(`SELECT * FROM authorized_admins WHERE phone = ?`, [phone]);
        if (!existing) {
            db.execute(`INSERT INTO actors (id, role, phone, created_at) VALUES (?, 'admin', ?, ?)`, [actorId, phone, now.toISOString()]);
            db.execute(`INSERT INTO authorized_admins (actor_id, phone, active) VALUES (?, ?, 1)`, [actorId, phone]);
            db.execute(`INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES (?, ?, ?, ?)`, [tokenHash, actorId, expiresAt, now.toISOString()]);
        } else {
            db.execute(`INSERT INTO sessions (token_hash, actor_id, expires_at, created_at) VALUES (?, ?, ?, ?)`, [tokenHash, existing.actor_id, expiresAt, now.toISOString()]);
        }
    });
    return { token, expiresAt, actorId };
}
