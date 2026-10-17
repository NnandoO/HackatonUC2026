import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { catalogService } from './services/catalog.service.js';
import { orderService } from './services/order.service.js';
import { paymentService } from './services/payment.service.js';
import { proposalService } from './services/proposal.service.js';
import { checkIdempotency, saveIdempotency } from './middleware/idempotency.js';
import { db } from './database/db.js';
test('Catalog: creates draft and requires proposal to publish', () => {
    const actorId = crypto.randomUUID();
    const prod = catalogService.createProduct({
        name: 'Vestido Test Unitario',
        description: 'Vestido de prueba para test suite',
        imageUrls: ['https://example.com/test.jpg'],
        variants: [
            { sku: 'TEST-SKU-1', size: '6', color: 'Rojo', price: { amountCents: 10000, currency: 'PEN' }, stock: 5 }
        ]
    }, actorId);
    assert.equal(prod.status, 'draft');
    assert.equal(prod.variants.length, 1);
    assert.equal(prod.variants[0]?.available, 5);
    // Must not appear in public catalog while draft
    const publicList = catalogService.getProducts({});
    assert.ok(!publicList.items.some(p => p.id === prod.id));
    // Create and confirm proposal
    const prop = proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actorId);
    const confirmed = proposalService.confirmProposal(prop.id, actorId, 'CONFIRM');
    assert.equal(confirmed.product?.status, 'published');
    // Now appears in public catalog
    const publicListAfter = catalogService.getProducts({});
    assert.ok(publicListAfter.items.some(p => p.id === prod.id));
});
test('Order: transactional stock reservation and out-of-stock guard', () => {
    const actor1 = crypto.randomUUID();
    const actor2 = crypto.randomUUID();
    // Create a product with only 1 unit
    const prod = catalogService.createProduct({
        name: 'Vestido Última Unidad',
        description: 'Solo queda una unidad para probar concurrencia',
        imageUrls: [],
        variants: [
            { sku: 'LAST-UNIT-SKU', size: '8', color: 'Azul', price: { amountCents: 15000, currency: 'PEN' }, stock: 1 }
        ]
    }, actor1);
    const prop = proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actor1);
    proposalService.confirmProposal(prop.id, actor1, 'CONFIRM');
    const variantId = prod.variants[0].id;
    // Buyer 1 orders the 1 unit
    const order1 = orderService.createOrder({
        items: [{ variantId, quantity: 1 }],
        deliveryZoneId: 'pickup',
        channel: 'web'
    }, actor1);
    assert.equal(order1.status, 'pending_payment');
    assert.equal(order1.total.amountCents, 15000);
    // Buyer 2 attempts to order the same unit -> OUT_OF_STOCK
    assert.throws(() => {
        orderService.createOrder({
            items: [{ variantId, quantity: 1 }],
            deliveryZoneId: 'pickup',
            channel: 'web'
        }, actor2);
    }, /OUT_OF_STOCK/);
});
test('Idempotency: returns cached response or 409 conflict on altered body', () => {
    const actorId = crypto.randomUUID();
    const route = '/v1/orders';
    const key = crypto.randomUUID();
    const originalBody = JSON.stringify({ item: 'Vestido Rosa', qty: 1 });
    const alteredBody = JSON.stringify({ item: 'Vestido Azul', qty: 2 });
    // Save response
    saveIdempotency(actorId, route, key, originalBody, 201, JSON.stringify({ orderId: 'ord-123' }));
    // Replay same body -> returns cached
    const cached = checkIdempotency(actorId, route, key, originalBody);
    assert.notEqual(cached, null);
    assert.notEqual(cached, 'CONFLICT');
    assert.equal(cached.responseCode, 201);
    // Altered body with same key -> CONFLICT
    const conflict = checkIdempotency(actorId, route, key, alteredBody);
    assert.equal(conflict, 'CONFLICT');
});
test('Payment & Webhook: stock settlement upon valid payment', () => {
    const actorId = crypto.randomUUID();
    const prod = catalogService.createProduct({
        name: 'Vestido Para Pago',
        description: 'Prueba de deducción definitiva tras webhook Culqi',
        imageUrls: [],
        variants: [
            { sku: 'PAY-TEST-SKU', size: '10', color: 'Blanco', price: { amountCents: 8000, currency: 'PEN' }, stock: 3 }
        ]
    }, actorId);
    const prop = proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actorId);
    proposalService.confirmProposal(prop.id, actorId, 'CONFIRM');
    const variantId = prod.variants[0].id;
    const order = orderService.createOrder({
        items: [{ variantId, quantity: 2 }],
        deliveryZoneId: 'pickup',
        channel: 'web'
    }, actorId);
    const payment = paymentService.createPayment(order.id, actorId, 'simulated');
    assert.equal(payment.status, 'pending');
    // Trigger Culqi webhook
    const outcome = paymentService.processCulqiWebhook({
        id: `culqi_evt_${crypto.randomUUID().slice(0, 8)}`,
        orderId: order.id,
        amount: order.total.amountCents
    });
    assert.equal(outcome.received, true);
    assert.equal(outcome.status, 'order_paid_and_stock_deducted');
    // Verify order is paid
    const paidOrder = orderService.getOrderById(order.id, actorId);
    assert.equal(paidOrder?.status, 'paid');
    // Check remaining stock: was 3, ordered 2 -> 1 remaining on hand
    const updatedVariant = db.queryOne(`SELECT * FROM variants WHERE id = ?`, [variantId]);
    assert.equal(updatedVariant.stock_on_hand, 1);
    assert.equal(updatedVariant.stock_reserved, 0);
});
