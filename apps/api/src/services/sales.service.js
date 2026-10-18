import { limaDate, resolveDeliveryDate } from './delivery-date.js';
import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { orderService } from './order.service.js';
import { paymentService } from './payment.service.js';

export class SalesService {
  async createRequest(input, actorId, conversationId = null) {
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
    const rawRequestedDate = String(input.requestedDate || '').trim().slice(0, 80);
    const requestedDate = rawRequestedDate ? resolveDeliveryDate(rawRequestedDate) : '';
    if (rawRequestedDate && (!requestedDate || requestedDate < limaDate())) {
      throw new Error('INVALID_INPUT: La fecha solicitada debe ser válida y no puede estar en el pasado.');
    }
    const seen = new Set();
    let subtotalCents = 0;
    const checked = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.variantId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || seen.has(item.variantId)) {
        throw new Error('INVALID_INPUT: Variante o cantidad inválida.');
      }
      seen.add(item.variantId);
      const variant = await db.queryOne(
        `SELECT v.id, v.sku, v.price_cents, v.stock_on_hand, v.stock_reserved, p.name
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = $1 AND p.status = 'published'`,
        [item.variantId]
      );
      if (!variant) throw new Error('NOT_FOUND: Prenda no disponible en catálogo.');
      if (variant.stock_on_hand - variant.stock_reserved < quantity) {
        throw new Error(`OUT_OF_STOCK: Stock insuficiente para ${variant.sku}.`);
      }
      subtotalCents += variant.price_cents * quantity;
      checked.push({ variantId: variant.id, sku: variant.sku, name: variant.name, quantity, priceCents: variant.price_cents });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
      [actorId, now]
    );
    await db.execute(
      `INSERT INTO sales_requests
       (id, actor_id, conversation_id, items_json, subtotal_cents, delivery_method, delivery_zone, delivery_address, requested_date, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
      [id, actorId, conversationId, JSON.stringify(checked), subtotalCents, method, zone, address, requestedDate, now]
    );
    return {
      id,
      status: 'pending',
      items: checked,
      subtotalCents,
      deliveryMethod: method,
      deliveryZone: zone,
      requestedDate,
      shippingStatus: 'pending_validation',
      deliveryDateStatus: 'pending_validation'
    };
  }

  async listPending(limit = 20) {
    const rows = await db.query(
      `SELECT s.*, a.phone AS customer_phone FROM sales_requests s
       JOIN actors a ON a.id = s.actor_id WHERE s.status = 'pending' ORDER BY s.created_at ASC LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 20, 1), 50)]
    );
    return rows.map(row => ({
      id: row.id,
      customerPhone: row.customer_phone,
      items: JSON.parse(row.items_json),
      subtotalCents: row.subtotal_cents,
      deliveryMethod: row.delivery_method,
      deliveryZone: row.delivery_zone,
      deliveryAddress: row.delivery_address,
      requestedDate: row.requested_date,
      createdAt: row.created_at
    }));
  }

  async approveRequest(id, adminActorId, approval, requestId = crypto.randomUUID()) {
    const shippingCents = Number(approval.shippingCents);
    const deliveryDate = String(approval.deliveryDate || '').trim();
    const parsedDate = new Date(`${deliveryDate}T12:00:00Z`);
    const todayLima = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    if (!Number.isSafeInteger(shippingCents) || shippingCents < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ||
        !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== deliveryDate ||
        deliveryDate < todayLima) {
      throw new Error('INVALID_INPUT: Confirma costo de envío en céntimos y fecha futura YYYY-MM-DD.');
    }
    const admin = await db.queryOne(`SELECT id FROM actors WHERE id = $1 AND role = 'admin'`, [adminActorId]);
    if (!admin) throw new Error('FORBIDDEN: Solo la administradora puede aprobar ventas.');
    const request = await db.queryOne(`SELECT * FROM sales_requests WHERE id = $1`, [id]);
    if (!request) throw new Error('NOT_FOUND: Solicitud de venta no encontrada.');
    if (request.status !== 'pending') throw new Error('CONFLICT: Solicitud ya revisada.');
    if (request.delivery_method === 'pickup' && shippingCents !== 0) {
      throw new Error('INVALID_INPUT: El recojo debe tener envío S/ 0.');
    }
    const requestedItems = JSON.parse(request.items_json);
    for (const item of requestedItems) {
      const current = await db.queryOne(`SELECT price_cents FROM variants WHERE id = $1`, [item.variantId]);
      if (!current || current.price_cents !== item.priceCents) {
        throw new Error('CONFLICT: Cambió el precio del catálogo. Prepara una nueva solicitud para validación.');
      }
    }
    return db.transaction(async () => {
      const currentRequest = await db.queryOne(
        `SELECT * FROM sales_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [id]
      );
      if (!currentRequest) throw new Error('CONFLICT: Solicitud ya revisada.');
      const currentItems = JSON.parse(currentRequest.items_json);
      for (const item of currentItems) {
        const current = await db.queryOne(`SELECT price_cents FROM variants WHERE id = $1`, [item.variantId]);
        if (!current || current.price_cents !== item.priceCents) {
          throw new Error('CONFLICT: Cambió el precio del catálogo. Prepara una nueva solicitud para validación.');
        }
      }
      const items = currentItems.map(({ variantId, quantity }) => ({ variantId, quantity }));
      const order = await orderService.createOrder({
        items,
        channel: currentRequest.conversation_id ? 'whatsapp' : 'web',
        deliveryZoneId: currentRequest.delivery_method === 'pickup' ? 'pickup' : currentRequest.delivery_zone,
        shippingCents,
      }, currentRequest.actor_id, { withinTransaction: true });
      const payment = await paymentService.createPayment(order.id, currentRequest.actor_id, 'simulated', { withinTransaction: true });
      const now = new Date().toISOString();
      const updated = await db.execute(
        `UPDATE sales_requests SET status = 'approved', approved_date = $1, shipping_cents = $2, order_id = $3, reviewed_at = $4
         WHERE id = $5 AND status = 'pending'`,
        [deliveryDate, shippingCents, order.id, now, id]
      );
      if (updated.changes !== 1) throw new Error('CONFLICT: Solicitud ya revisada.');
      await db.execute(
        `INSERT INTO audit_events (id, actor_id, action, entity_id, request_id, changes, created_at)
         VALUES ($1, $2, 'approve_sale', $3, $4, $5, $6)`,
        [crypto.randomUUID(), adminActorId, id, requestId, JSON.stringify({ orderId: order.id, deliveryDate, shippingCents }), now]
      );
      return {
        id,
        status: 'approved',
        orderId: order.id,
        totalCents: order.total.amountCents,
        deliveryDate,
        shippingCents,
        checkoutUrl: payment.checkoutUrl
      };
    });
  }

  async rejectRequest(id, adminActorId, reason, requestId = crypto.randomUUID()) {
    const admin = await db.queryOne(`SELECT id FROM actors WHERE id = $1 AND role = 'admin'`, [adminActorId]);
    if (!admin) throw new Error('FORBIDDEN: Solo la administradora puede rechazar ventas.');
    const reviewedReason = String(reason || '').trim().slice(0, 300);
    if (!reviewedReason) throw new Error('INVALID_INPUT: Indica el motivo del rechazo.');
    return db.transaction(async () => {
      const request = await db.queryOne(`SELECT id, status FROM sales_requests WHERE id = $1 FOR UPDATE`, [id]);
      if (!request) throw new Error('NOT_FOUND: Solicitud de venta no encontrada.');
      if (request.status !== 'pending') throw new Error('CONFLICT: Solicitud ya revisada.');
      const now = new Date().toISOString();
      const updated = await db.execute(
        `UPDATE sales_requests SET status = 'rejected', reviewed_at = $1 WHERE id = $2 AND status = 'pending'`,
        [now, id]
      );
      if (updated.changes !== 1) throw new Error('CONFLICT: Solicitud ya revisada.');
      await db.execute(
        `INSERT INTO audit_events (id, actor_id, action, entity_id, request_id, changes, created_at)
         VALUES ($1, $2, 'reject_sale', $3, $4, $5, $6)`,
        [crypto.randomUUID(), adminActorId, id, requestId, JSON.stringify({ reason: reviewedReason }), now]
      );
      return { id, status: 'rejected', reason: reviewedReason };
    });
  }

  async prepareAdminConfirmation(id, adminActorId, conversationId = null) {
    const admin = await db.queryOne("SELECT id FROM actors WHERE id=$1 AND role='admin'", [adminActorId]);
    if (!admin) throw new Error('FORBIDDEN: Solo la administradora puede revisar ventas.');
    const row = await db.queryOne("SELECT * FROM sales_requests WHERE id=$1 AND status='pending'", [id]);
    if (!row) throw new Error('NOT_FOUND: No hay una solicitud pendiente.');
    const date = resolveDeliveryDate(row.requested_date);
    if (!date || date < limaDate()) throw new Error('INVALID_INPUT: El cliente debe indicar una fecha de entrega vigente.');
    let shippingCents = row.delivery_method === 'pickup' ? 0 : row.shipping_cents;
    if (shippingCents === null || shippingCents === undefined) {
      const normalizeZone = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^el\s+/, '').trim();
      const previous = await db.query("SELECT delivery_zone,shipping_cents FROM sales_requests WHERE status='approved' AND delivery_method='delivery' AND shipping_cents IS NOT NULL ORDER BY reviewed_at DESC LIMIT 100");
      shippingCents = previous.find(item => normalizeZone(item.delivery_zone) === normalizeZone(row.delivery_zone))?.shipping_cents;
    }
    if (!Number.isSafeInteger(shippingCents) || shippingCents < 0) throw new Error('DELIVERY_RATE_MISSING: No hay tarifa validada para esa zona.');
    const action = { kind: 'sale', requestId: id, deliveryDate: date, shippingCents, subtotalCents: row.subtotal_cents, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() };
    if (!conversationId) {
      const conv = await db.queryOne("SELECT id FROM conversations WHERE actor_id=$1 AND channel='whatsapp' ORDER BY created_at DESC LIMIT 1", [adminActorId]);
      conversationId = conv?.id;
      if (!conversationId) {
        conversationId = crypto.randomUUID();
        await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at) VALUES($1,$2,'whatsapp',$3)", [conversationId, adminActorId, new Date().toISOString()]);
      }
    }
    await db.execute("UPDATE conversations SET shopping_context=(shopping_context::jsonb || jsonb_build_object('pendingAdminAction',$1::jsonb))::text WHERE id=$2", [JSON.stringify(action), conversationId]);
    const items = JSON.parse(row.items_json);
    const money = cents => `S/ ${(cents / 100).toFixed(2)}`;
    const replyText = items.map(item => `${item.name} ×${item.quantity}`).join('\n') +
      `\n${row.delivery_method === 'delivery' ? `Delivery: ${row.delivery_zone} · ${row.delivery_address}` : 'Recojo en tienda'}` +
      `\nFecha: ${date}\nPrendas: ${money(row.subtotal_cents)} · Envío: ${money(shippingCents)}\nTotal: ${money(row.subtotal_cents + shippingCents)}\n\nResponde CONFIRMAR.`;
    return { action, replyText };
  }

  async confirmPreparedSale(conversationId, adminActorId) {
    const conv = await db.queryOne('SELECT shopping_context FROM conversations WHERE id=$1 AND actor_id=$2', [conversationId, adminActorId]);
    const action = JSON.parse(conv?.shopping_context || '{}').pendingAdminAction;
    if (action?.kind !== 'sale' || new Date(action.expiresAt) < new Date()) throw new Error('INVALID_INPUT: Consulta las solicitudes pendientes para confirmar su resumen vigente.');
    const approval = await this.approveRequest(action.requestId, adminActorId, action);
    await db.execute("UPDATE conversations SET shopping_context=(shopping_context::jsonb - 'pendingAdminAction' || jsonb_build_object('lastConfirmedSale',$1::text))::text WHERE id=$2", [approval.id, conversationId]);
    approval.customerNotification = await this.notifyCustomer(approval.id);
    return { ...approval, replyText: `Solicitud aprobada. Total: S/ ${(approval.totalCents / 100).toFixed(2)}. Fecha: ${approval.deliveryDate}.` + (approval.customerNotification.sent ? ' Cliente avisado con su enlace de pago de prueba.' : ' El aviso al cliente está pendiente de envío.') };
  }

  async notifyAdmin(request) {
    if (process.env.WHATSAPP_BRIDGE_ENABLED !== 'true') {
      return { sent: false, reason: 'whatsapp_bridge_disabled' };
    }
    const adminPhone = process.env.SALES_ADMIN_PHONE || '51995992450';
    const { wppConnectService } = await import('./wppconnect.service.js');
    const admin = await db.queryOne('SELECT actor_id FROM authorized_admins WHERE phone=$1 AND active=1', [adminPhone.startsWith('+') ? adminPhone : `+${adminPhone}`]);
    if (!admin) throw new Error('FORBIDDEN: No hay administradora autorizada.');
    let preview;
    try { preview = await this.prepareAdminConfirmation(request.id, admin.actor_id); }
    catch (error) { return wppConnectService.sendMessage(adminPhone, `Nueva solicitud pendiente. ${error.message}`); }
    return wppConnectService.sendMessage(adminPhone, `🛍️ Nueva solicitud\n${preview.replyText}`);
  }

  async notifyCustomer(id) {
    if (process.env.WHATSAPP_BRIDGE_ENABLED !== 'true') {
      return { sent: false, reason: 'whatsapp_bridge_disabled' };
    }
    const row = await db.queryOne(
      `SELECT s.*, a.phone, c.shopping_context FROM sales_requests s JOIN actors a ON a.id = s.actor_id LEFT JOIN conversations c ON c.id=s.conversation_id WHERE s.id = $1`,
      [id]
    );
    if (!row || row.status !== 'approved' || row.notification_sent_at || !row.phone) return { sent: false };
    const { wppConnectService } = await import('./wppconnect.service.js');
    const totalCents = row.subtotal_cents + row.shipping_cents;
    const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const payment = await db.queryOne(
      `SELECT checkout_url FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [row.order_id]
    );
    const checkoutLink = baseUrl && payment?.checkout_url ? `${baseUrl}${payment.checkout_url}` : '';
    const message = `✅ Tu solicitud ${id} fue aprobada.\nFecha confirmada: ${row.approved_date}.\n` +
      `Delivery/recojo: ${row.delivery_method === 'delivery' ? row.delivery_zone : 'recojo'}.\n` +
      `Envío: S/ ${(row.shipping_cents / 100).toFixed(2)}. Total: S/ ${(totalCents / 100).toFixed(2)}.\n` +
      (checkoutLink ? `Enlace de pago de prueba: ${checkoutLink}` : 'Te enviaremos el enlace de pago por separado.');
    const transport = JSON.parse(row.shopping_context || '{}');
    const result = await wppConnectService.sendMessage(transport.whatsappSender || row.phone, message, Boolean(transport.whatsappIsLid));
    if (result?.error) return { sent: false, error: result.error };
    await db.execute(
      `UPDATE sales_requests SET notification_sent_at = $1 WHERE id = $2 AND notification_sent_at IS NULL`,
      [new Date().toISOString(), id]
    );
    return { sent: true };
  }
}

export const salesService = new SalesService();
