import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { orderService } from './order.service.js';
import { paymentService } from './payment.service.js';

export class SalesService {
  createRequest(input, actorId, conversationId = null) {
    const items = input.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      throw new Error('INVALID_INPUT: Selecciona entre 1 y 20 prendas.');
    }
    const method = input.deliveryMethod;
    if (!['pickup', 'delivery'].includes(method)) {
      throw new Error('INVALID_INPUT: Indica recojo o delivery.');
    }
    const zone = String(input.deliveryZone || '').trim().slice(0, 120);
    const address = String(input.deliveryAddress || '').trim().slice(0, 300);
    if (method === 'delivery' && (!zone || !address)) {
      throw new Error('INVALID_INPUT: Para delivery necesito distrito/zona y dirección.');
    }
    const requestedDate = String(input.requestedDate || '').trim().slice(0, 80);
    const seen = new Set();
    let subtotalCents = 0;
    const checked = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.variantId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || seen.has(item.variantId)) {
        throw new Error('INVALID_INPUT: Variante o cantidad inválida.');
      }
      seen.add(item.variantId);
      const variant = db.queryOne(`SELECT v.id, v.sku, v.price_cents, v.stock_on_hand, v.stock_reserved, p.name
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = ? AND p.status = 'published'`, [item.variantId]);
      if (!variant) throw new Error('NOT_FOUND: Prenda no disponible en catálogo.');
      if (variant.stock_on_hand - variant.stock_reserved < quantity) {
        throw new Error(`OUT_OF_STOCK: Stock insuficiente para ${variant.sku}.`);
      }
      subtotalCents += variant.price_cents * quantity;
      checked.push({ variantId: variant.id, sku: variant.sku, name: variant.name, quantity, priceCents: variant.price_cents });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.execute(`INSERT INTO sales_requests
      (id, actor_id, conversation_id, items_json, subtotal_cents, delivery_method, delivery_zone, delivery_address, requested_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, actorId, conversationId, JSON.stringify(checked), subtotalCents, method, zone, address, requestedDate, now]);
    return { id, status: 'pending', items: checked, subtotalCents, deliveryMethod: method, deliveryZone: zone,
      requestedDate, shippingStatus: 'pending_validation', deliveryDateStatus: 'pending_validation' };
  }

  listPending(limit = 20) {
    return db.query(`SELECT s.*, a.phone AS customer_phone FROM sales_requests s
      JOIN actors a ON a.id = s.actor_id WHERE s.status = 'pending' ORDER BY s.created_at ASC LIMIT ?`,
      [Math.min(Math.max(Number(limit) || 20, 1), 50)]).map(row => ({
        id: row.id, customerPhone: row.customer_phone, items: JSON.parse(row.items_json),
        subtotalCents: row.subtotal_cents, deliveryMethod: row.delivery_method,
        deliveryZone: row.delivery_zone, deliveryAddress: row.delivery_address,
        requestedDate: row.requested_date, createdAt: row.created_at
      }));
  }

  approveRequest(id, adminActorId, approval) {
    const shippingCents = Number(approval.shippingCents);
    const deliveryDate = String(approval.deliveryDate || '').trim();
    const parsedDate = new Date(`${deliveryDate}T12:00:00Z`);
    const todayLima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!Number.isSafeInteger(shippingCents) || shippingCents < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ||
        !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== deliveryDate ||
        deliveryDate < todayLima) {
      throw new Error('INVALID_INPUT: Confirma costo de envío en céntimos y fecha futura YYYY-MM-DD.');
    }
    const admin = db.queryOne(`SELECT id FROM actors WHERE id = ? AND role = 'admin'`, [adminActorId]);
    if (!admin) throw new Error('FORBIDDEN: Solo la administradora puede aprobar ventas.');
    const request = db.queryOne(`SELECT * FROM sales_requests WHERE id = ?`, [id]);
    if (!request) throw new Error('NOT_FOUND: Solicitud de venta no encontrada.');
    if (request.status !== 'pending') throw new Error('CONFLICT: Solicitud ya revisada.');
    if (request.delivery_method === 'pickup' && shippingCents !== 0) {
      throw new Error('INVALID_INPUT: El recojo debe tener envío S/ 0.');
    }
    const requestedItems = JSON.parse(request.items_json);
    for (const item of requestedItems) {
      const current = db.queryOne(`SELECT price_cents FROM variants WHERE id = ?`, [item.variantId]);
      if (!current || current.price_cents !== item.priceCents) {
        throw new Error('CONFLICT: Cambió el precio del catálogo. Prepara una nueva solicitud para validación.');
      }
    }
    const items = requestedItems.map(({ variantId, quantity }) => ({ variantId, quantity }));
    const order = orderService.createOrder({ items, channel: request.conversation_id ? 'whatsapp' : 'web',
      deliveryZoneId: request.delivery_method === 'pickup' ? 'pickup' : request.delivery_zone,
      shippingCents }, request.actor_id);
    const payment = paymentService.createPayment(order.id, request.actor_id, 'simulated');
    const now = new Date().toISOString();
    db.execute(`UPDATE sales_requests SET status = 'approved', approved_date = ?, shipping_cents = ?, order_id = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'`, [deliveryDate, shippingCents, order.id, now, id]);
    db.execute(`INSERT INTO audit_events (id, actor_id, action, entity_id, request_id, changes, created_at)
      VALUES (?, ?, 'approve_sale', ?, ?, ?, ?)`,
      [crypto.randomUUID(), adminActorId, id, crypto.randomUUID(), JSON.stringify({ orderId: order.id, deliveryDate, shippingCents }), now]);
    return { id, status: 'approved', orderId: order.id, totalCents: order.total.amountCents,
      deliveryDate, shippingCents, checkoutUrl: payment.checkoutUrl };
  }

  rejectRequest(id, adminActorId, reason) {
    const admin = db.queryOne(`SELECT id FROM actors WHERE id = ? AND role = 'admin'`, [adminActorId]);
    if (!admin) throw new Error('FORBIDDEN: Solo la administradora puede rechazar ventas.');
    const request = db.queryOne(`SELECT id, status FROM sales_requests WHERE id = ?`, [id]);
    if (!request) throw new Error('NOT_FOUND: Solicitud de venta no encontrada.');
    if (request.status !== 'pending') throw new Error('CONFLICT: Solicitud ya revisada.');
    const reviewedReason = String(reason || '').trim().slice(0, 300);
    if (!reviewedReason) throw new Error('INVALID_INPUT: Indica el motivo del rechazo.');
    const now = new Date().toISOString();
    db.execute(`UPDATE sales_requests SET status = 'rejected', reviewed_at = ? WHERE id = ? AND status = 'pending'`, [now, id]);
    db.execute(`INSERT INTO audit_events (id, actor_id, action, entity_id, request_id, changes, created_at)
      VALUES (?, ?, 'reject_sale', ?, ?, ?, ?)`,
      [crypto.randomUUID(), adminActorId, id, crypto.randomUUID(), JSON.stringify({ reason: reviewedReason }), now]);
    return { id, status: 'rejected', reason: reviewedReason };
  }

  async notifyAdmin(request) {
    const adminPhone = process.env.SALES_ADMIN_PHONE || '51995992450';
    const { wppConnectService } = await import('./wppconnect.service.js');
    const summary = request.items.map(item => `${item.name} (${item.sku}) ×${item.quantity}`).join(', ');
    return wppConnectService.sendMessage(adminPhone,
      `🛍️ Nueva solicitud de venta ${request.id}\n${summary}\nSubtotal: S/ ${(request.subtotalCents / 100).toFixed(2)}\n` +
      `${request.deliveryMethod === 'delivery' ? `Delivery: ${request.deliveryZone}` : 'Recojo'}\n` +
      `Fecha solicitada: ${request.requestedDate || 'sin indicar'}\nRevisa fecha, envío y stock antes de aprobar.`);
  }

  async notifyCustomer(id) {
    const row = db.queryOne(`SELECT s.*, a.phone FROM sales_requests s JOIN actors a ON a.id = s.actor_id WHERE s.id = ?`, [id]);
    if (!row || row.status !== 'approved' || row.notification_sent_at || !row.phone) return { sent: false };
    const { wppConnectService } = await import('./wppconnect.service.js');
    const totalCents = row.subtotal_cents + row.shipping_cents;
    const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const payment = db.queryOne(`SELECT checkout_url FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`, [row.order_id]);
    const checkoutLink = baseUrl && payment?.checkout_url ? `${baseUrl}${payment.checkout_url}` : '';
    const message = `✅ Tu solicitud ${id} fue aprobada.\nFecha confirmada: ${row.approved_date}.\n` +
      `Delivery/recojo: ${row.delivery_method === 'delivery' ? row.delivery_zone : 'recojo'}.\n` +
      `Envío: S/ ${(row.shipping_cents / 100).toFixed(2)}. Total: S/ ${(totalCents / 100).toFixed(2)}.\n` +
      (checkoutLink ? `Enlace de pago de prueba: ${checkoutLink}` : 'Te enviaremos el enlace de pago por separado.');
    const result = await wppConnectService.sendMessage(row.phone, message);
    if (result?.error) return { sent: false, error: result.error };
    db.execute(`UPDATE sales_requests SET notification_sent_at = ? WHERE id = ? AND notification_sent_at IS NULL`,
      [new Date().toISOString(), id]);
    return { sent: true };
  }
}

export const salesService = new SalesService();
