import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { orderService } from './order.service.js';

export class PaymentService {
    async createPayment(orderId, actorId, mode = 'simulated', options = {}) {
        // Sweep any expired reservations first
        if (!options.withinTransaction) {
            await orderService.sweepExpiredReservations();
        }
        const order = await db.queryOne(`SELECT * FROM orders WHERE id = $1 AND actor_id = $2`, [orderId, actorId]);
        if (!order) {
            throw new Error('NOT_FOUND: Pedido no encontrado.');
        }
        if (order.status !== 'pending_payment') {
            throw new Error(`CONFLICT: El pedido no admite pago (estado actual: ${order.status}).`);
        }
        const existingPayment = await db.queryOne(
            `SELECT * FROM payments WHERE order_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
            [orderId]
        );
        if (existingPayment) {
            return {
                id: existingPayment.id,
                orderId: existingPayment.order_id,
                status: existingPayment.status,
                mode: existingPayment.mode,
                amount: { amountCents: existingPayment.amount_cents, currency: 'PEN' },
                checkoutUrl: existingPayment.checkout_url,
                expiresAt: existingPayment.expires_at,
            };
        }
        const paymentId = crypto.randomUUID();
        const providerRef = `culqi_sim_${crypto.randomUUID().slice(0, 12)}`;
        const checkoutUrl = `/checkout/${mode}?paymentId=${paymentId}&orderId=${orderId}&amount=${order.total_cents}`;
        const nowIso = new Date().toISOString();
        await db.execute(
            `INSERT INTO payments (id, order_id, status, mode, amount_cents, provider_reference, checkout_url, expires_at, created_at)
             VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)`,
            [paymentId, orderId, mode, order.total_cents, providerRef, checkoutUrl, order.reservation_expires_at, nowIso]
        );
        return {
            id: paymentId,
            orderId,
            status: 'pending',
            mode,
            amount: { amountCents: order.total_cents, currency: 'PEN' },
            checkoutUrl,
            expiresAt: order.reservation_expires_at,
        };
    }

    async getPaymentByOrderId(orderId) {
        const p = await db.queryOne(
            `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [orderId]
        );
        if (!p)
            return null;
        return {
            id: p.id,
            orderId: p.order_id,
            status: p.status,
            mode: p.mode,
            amount: { amountCents: p.amount_cents, currency: 'PEN' },
            checkoutUrl: p.checkout_url,
            expiresAt: p.expires_at,
        };
    }

    async processCulqiWebhook(payload) {
        const eventId = payload.id || payload.eventId || crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        return db.transaction(async () => {
            // Check webhook deduplication
            const existing = await db.queryOne(
                `SELECT * FROM webhook_inbox WHERE provider = 'culqi' AND event_id = $1`,
                [eventId]
            );
            if (existing) {
                return { received: true, status: 'already_processed' };
            }
            await db.execute(
                `INSERT INTO webhook_inbox (provider, mode, event_id, payload_hash, status, created_at)
                 VALUES ('culqi', 'simulated', $1, $2, 'processed', $3)
                 ON CONFLICT (provider, mode, event_id) DO NOTHING`,
                [eventId, payloadHash, new Date().toISOString()]
            );
            const orderId = payload.orderId || payload.data?.orderId || payload.data?.order_id || payload.data?.metadata?.orderId || payload.metadata?.orderId;
            if (!orderId) {
                return { received: true, status: 'ignored_no_order' };
            }
            const order = await db.queryOne(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
            if (!order) {
                return { received: true, status: 'order_not_found' };
            }
            const paidAmount = Number(payload.amount || payload.data?.amount || order.total_cents);
            if (paidAmount !== order.total_cents) {
                return { received: true, status: 'amount_mismatch_incident' };
            }
            const now = new Date();
            if (new Date(order.reservation_expires_at) < now || order.status === 'expired') {
                // Late payment after expiration: record incident for human reconciliation, DO NOT mark paid or decrease stock
                const auditId = crypto.randomUUID();
                await db.execute(
                    `INSERT INTO audit_events (id, actor_id, action, entity_id, proposal_id, request_id, changes, created_at)
                     VALUES ($1, $2, 'late_payment_reconciliation_required', $3, NULL, $4, $5, $6)`,
                    [auditId, order.actor_id, order.id, crypto.randomUUID(), JSON.stringify({ paidAmount, expiredAt: order.reservation_expires_at }), now.toISOString()]
                );
                return { received: true, status: 'late_payment_reconciliation_required' };
            }
            // Valid payment before expiration: consume reservations and deduct stock
            const reservations = await db.query(
                `SELECT * FROM reservations WHERE order_id = $1 AND status = 'active' FOR UPDATE`,
                [order.id]
            );
            for (const res of reservations) {
                await db.execute(
                    `UPDATE variants
                     SET stock_on_hand = GREATEST(0, stock_on_hand - $1),
                         stock_reserved = GREATEST(0, stock_reserved - $2),
                         version = version + 1
                     WHERE id = $3`,
                    [res.quantity, res.quantity, res.variant_id]
                );
                await db.execute(`UPDATE reservations SET status = 'consumed' WHERE id = $1`, [res.id]);
            }
            await db.execute(`UPDATE orders SET status = 'paid' WHERE id = $1`, [order.id]);
            await db.execute(`UPDATE payments SET status = 'succeeded' WHERE order_id = $1 AND status = 'pending'`, [order.id]);
            return { received: true, status: 'order_paid_and_stock_deducted' };
        });
    }
}

export const paymentService = new PaymentService();
