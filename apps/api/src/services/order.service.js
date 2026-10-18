import crypto from 'node:crypto';
import { db } from '../database/db.js';
export class OrderService {
    createOrder(input, actorId) {
        if (!input.items || input.items.length === 0 || input.items.length > 50) {
            throw new Error('INVALID_INPUT: El pedido debe contener entre 1 y 50 líneas.');
        }
        // Deduplicate variant IDs check
        const variantIdSet = new Set();
        for (const item of input.items) {
            if (!item.variantId || item.quantity <= 0 || item.quantity > 99) {
                throw new Error('INVALID_INPUT: Cantidad inválida por ítem (debe ser 1–99).');
            }
            if (variantIdSet.has(item.variantId)) {
                throw new Error('INVALID_INPUT: No se permiten variantes duplicadas en el pedido.');
            }
            variantIdSet.add(item.variantId);
        }
        const orderId = crypto.randomUUID();
        const now = new Date();
        const reservationExpiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // 15 min TTL
        const nowIso = now.toISOString();
        // Sort variant IDs lexicographically to avoid deadlocks
        const sortedItems = [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
        return db.transaction(() => {
            let subtotalCents = 0;
            const orderLines = [];
            for (const item of sortedItems) {
                // Query variant and ensure associated product is published
                const v = db.queryOne(`SELECT v.*, p.status as product_status, p.name as product_name
           FROM variants v
           JOIN products p ON v.product_id = p.id
           WHERE v.id = ?`, [item.variantId]);
                if (!v) {
                    throw new Error(`NOT_FOUND: Variante ${item.variantId} no encontrada.`);
                }
                if (v.product_status !== 'published') {
                    throw new Error(`CONFLICT: El producto "${v.product_name}" no está publicado para la venta.`);
                }
                const available = v.stock_on_hand - v.stock_reserved;
                if (available < item.quantity) {
                    throw new Error(`OUT_OF_STOCK: Stock insuficiente para SKU ${v.sku}. Disponibles: ${available}, Solicitados: ${item.quantity}.`);
                }
                // Reserve stock
                db.execute(`UPDATE variants
           SET stock_reserved = stock_reserved + ?, version = version + 1
           WHERE id = ?`, [item.quantity, v.id]);
                const lineTotal = v.price_cents * item.quantity;
                subtotalCents += lineTotal;
                orderLines.push({
                    variantId: v.id,
                    sku: v.sku,
                    quantity: item.quantity,
                    unitPriceCents: v.price_cents,
                });
            }
            const shippingCents = Number(input.shippingCents ?? 0);
            if (!Number.isSafeInteger(shippingCents) || shippingCents < 0) {
                throw new Error('INVALID_INPUT: Costo de envío inválido.');
            }
            const totalCents = subtotalCents + shippingCents;
            const actor = db.queryOne(`SELECT id FROM actors WHERE id = ?`, [actorId]);
            if (!actor) {
                db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'customer', ?)`, [actorId, nowIso]);
            }
            // Insert order first to satisfy foreign key
            db.execute(`INSERT INTO orders (id, actor_id, status, subtotal_cents, shipping_cents, total_cents, channel, delivery_zone_id, reservation_expires_at, created_at)
         VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?)`, [orderId, actorId, subtotalCents, shippingCents, totalCents, input.channel, input.deliveryZoneId, reservationExpiresAt, nowIso]);
            // Insert reservations and order items
            for (const line of orderLines) {
                db.execute(`INSERT INTO reservations (id, order_id, variant_id, quantity, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)`, [crypto.randomUUID(), orderId, line.variantId, line.quantity, nowIso]);
                db.execute(`INSERT INTO order_items (id, order_id, variant_id, sku, quantity, price_cents)
           VALUES (?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), orderId, line.variantId, line.sku, line.quantity, line.unitPriceCents]);
            }
            return {
                id: orderId,
                status: 'pending_payment',
                items: orderLines.map((l) => ({
                    variantId: l.variantId,
                    sku: l.sku,
                    quantity: l.quantity,
                    unitPrice: { amountCents: l.unitPriceCents, currency: 'PEN' },
                })),
                subtotal: { amountCents: subtotalCents, currency: 'PEN' },
                shipping: { amountCents: shippingCents, currency: 'PEN' },
                total: { amountCents: totalCents, currency: 'PEN' },
                reservationExpiresAt,
                createdAt: nowIso,
            };
        });
    }
    getOrderById(id, actorId, isAdmin = false) {
        // Release any expired pending orders on lookup
        this.sweepExpiredReservations();
        let sql = `SELECT * FROM orders WHERE id = ?`;
        const params = [id];
        if (!isAdmin) {
            sql += ` AND actor_id = ?`;
            params.push(actorId);
        }
        const row = db.queryOne(sql, params);
        if (!row)
            return null;
        const items = db.query(`SELECT * FROM order_items WHERE order_id = ?`, [row.id]);
        return {
            id: row.id,
            status: row.status,
            items: items.map((i) => ({
                variantId: i.variant_id,
                sku: i.sku,
                quantity: i.quantity,
                unitPrice: { amountCents: i.price_cents, currency: 'PEN' },
            })),
            subtotal: { amountCents: row.subtotal_cents, currency: 'PEN' },
            shipping: { amountCents: row.shipping_cents, currency: 'PEN' },
            total: { amountCents: row.total_cents, currency: 'PEN' },
            reservationExpiresAt: row.reservation_expires_at,
            createdAt: row.created_at,
        };
    }
    adminGetOrders(options) {
        this.sweepExpiredReservations();
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const cursor = options.cursor;
        let sql = `SELECT * FROM orders WHERE 1=1`;
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
        const orders = records.map((r) => {
            const items = db.query(`SELECT * FROM order_items WHERE order_id = ?`, [r.id]);
            return {
                id: r.id,
                status: r.status,
                items: items.map((i) => ({
                    variantId: i.variant_id,
                    sku: i.sku,
                    quantity: i.quantity,
                    unitPrice: { amountCents: i.price_cents, currency: 'PEN' },
                })),
                subtotal: { amountCents: r.subtotal_cents, currency: 'PEN' },
                shipping: { amountCents: r.shipping_cents, currency: 'PEN' },
                total: { amountCents: r.total_cents, currency: 'PEN' },
                reservationExpiresAt: r.reservation_expires_at,
                createdAt: r.created_at,
            };
        });
        const nextCursor = hasMore && records.length > 0 ? records[records.length - 1].created_at : null;
        return { items: orders, nextCursor };
    }
    sweepExpiredReservations() {
        const nowIso = new Date().toISOString();
        const expiredOrders = db.query(`SELECT id FROM orders WHERE status = 'pending_payment' AND reservation_expires_at < ?`, [nowIso]);
        for (const order of expiredOrders) {
            db.transaction(() => {
                // Lock and release reservations
                const reservations = db.query(`SELECT * FROM reservations WHERE order_id = ? AND status = 'active'`, [order.id]);
                for (const res of reservations) {
                    db.execute(`UPDATE variants SET stock_reserved = MAX(0, stock_reserved - ?), version = version + 1 WHERE id = ?`, [res.quantity, res.variant_id]);
                    db.execute(`UPDATE reservations SET status = 'released' WHERE id = ?`, [res.id]);
                }
                db.execute(`UPDATE orders SET status = 'expired' WHERE id = ?`, [order.id]);
            });
        }
    }
}
export const orderService = new OrderService();
