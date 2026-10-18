import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { catalogService } from './services/catalog.service.js';
import { orderService } from './services/order.service.js';
import { paymentService } from './services/payment.service.js';
import { proposalService } from './services/proposal.service.js';
import { checkIdempotency, saveIdempotency } from './middleware/idempotency.js';
import { db } from './database/db.js';
import { agentService, isWithinAngibellScope } from './services/agent.service.js';
import { salesService } from './services/sales.service.js';
import { verifyMetaSignature } from './server.js';
import { socialService } from './services/social.service.js';

test('WhatsApp HTTP webhook requires a valid Meta signature', () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account' });
    const secret = 'test-app-secret';
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    assert.equal(verifyMetaSignature(body, signature, secret), true);
    assert.equal(verifyMetaSignature(`${body} `, signature, secret), false);
    assert.equal(verifyMetaSignature(body, signature, ''), false);
    assert.equal(verifyMetaSignature(body, 'sha256=invalid', secret), false);
});

test('Chat scope guard rejects unrelated questions and preserves commerce follow-ups', () => {
    assert.equal(isWithinAngibellScope('¿Cómo programo una API en Python?'), false);
    assert.equal(isWithinAngibellScope('[Nota de voz]: "¿Quién es el presidente del Perú?"'), false);
    assert.equal(isWithinAngibellScope('¿Tienen vestidos en talla 8?'), true);
    assert.equal(isWithinAngibellScope('Quiero uno rojo', [
        { role: 'assistant', text: 'Tenemos vestidos de fiesta en talla 8.' }
    ]), true);
    assert.equal(isWithinAngibellScope('8', [
        { role: 'assistant', text: '¿Qué talla buscas para el vestido?' }
    ]), true);
    assert.equal(isWithinAngibellScope('¿Cómo programo una API en Python?', [
        { role: 'assistant', text: 'Tenemos vestidos de fiesta en talla 8.' }
    ]), false);
});
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

test('Sales advisor: validation is required before reserving stock or creating a payment', async () => {
    const customerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'customer', ?)`, [customerId, new Date().toISOString()]);
    db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'admin', ?)`, [adminId, new Date().toISOString()]);
    const product = catalogService.createProduct({
        name: 'Vestido Venta Validada', description: 'Prueba de validación comercial', imageUrls: [],
        variants: [{ sku: `SALE-${crypto.randomUUID()}`, size: '8', color: 'Rosa',
            price: { amountCents: 12000, currency: 'PEN' }, stock: 3 }]
    }, adminId);
    const publish = proposalService.createProposal({ kind: 'publish_product', productId: product.id,
        expectedVersion: product.version }, adminId);
    proposalService.confirmProposal(publish.id, adminId, 'CONFIRM');
    const variantId = product.variants[0].id;
    const request = salesService.createRequest({ items: [{ variantId, quantity: 1 }],
        deliveryMethod: 'delivery', deliveryZone: 'El Tambo', deliveryAddress: 'Jr. Prueba 123',
        requestedDate: 'domingo' }, customerId);
    assert.equal(request.status, 'pending');
    assert.equal(db.queryOne(`SELECT stock_reserved FROM variants WHERE id = ?`, [variantId]).stock_reserved, 0);
    assert.equal(db.queryOne(`SELECT COUNT(*) AS count FROM orders WHERE actor_id = ?`, [customerId]).count, 0);
    assert.throws(() => salesService.approveRequest(request.id, customerId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 }), /FORBIDDEN/);
    assert.throws(() => salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01' }), /INVALID_INPUT/);
    const inventedApproval = await agentService.executeTool('approve_sale',
        { requestId: request.id, deliveryDate: '2099-01-01', shippingCents: 1000 },
        { actorId: adminId, conversationId: null, userRole: 'admin', text: 'Aprueba esa venta' });
    assert.match(inventedApproval.error, /escribe/);
    assert.equal(db.queryOne(`SELECT status FROM sales_requests WHERE id = ?`, [request.id]).status, 'pending');
    const approved = salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.totalCents, 13000);
    assert.equal(db.queryOne(`SELECT stock_reserved FROM variants WHERE id = ?`, [variantId]).stock_reserved, 1);
    assert.throws(() => salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 }), /CONFLICT/);
});

function createSocialDraftForTest() {
    const id = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.execute(`INSERT INTO products (id, name, description, image_urls, status, version, created_at, updated_at)
      VALUES (?, 'Prenda Meta test', 'Test', '[]', 'published', 1, ?, ?)`, [productId, now, now]);
    db.execute(`INSERT INTO social_drafts (id, product_id, caption, image_urls, status, mode, created_at)
      VALUES (?, ?, 'Publicación de prueba', '["https://cdn.example.test/prenda.jpg"]', 'prepared', 'simulated', ?)`,
      [id, productId, now]);
    return id;
}

test('Meta publishers: Facebook photo publish is idempotent after success', async () => {
    const originalFetch = globalThis.fetch;
    const savedEnv = Object.fromEntries(['META_FACEBOOK_PAGE_TOKEN_FILE', 'META_FACEBOOK_PAGE_ID', 'META_GRAPH_API_VERSION']
        .map((key) => [key, process.env[key]]));
    const tokenPath = `/tmp/angibell-meta-token-${crypto.randomUUID()}`;
    const draftId = createSocialDraftForTest();
    try {
        process.env.META_FACEBOOK_PAGE_TOKEN_FILE = tokenPath;
        process.env.META_FACEBOOK_PAGE_ID = 'page-test-123';
        process.env.META_GRAPH_API_VERSION = 'v26.0';
        fs.writeFileSync(tokenPath, 'test-page-token', { mode: 0o600 });
        let calls = 0;
        globalThis.fetch = async (url, options) => {
            calls += 1;
            assert.match(String(url), /graph\.facebook\.com\/v26\.0\/page-test-123\/photos$/);
            assert.equal(options.method, 'POST');
            assert.match(String(options.body), /caption=Publicaci%C3%B3n/);
            return { ok: true, json: async () => ({ id: 'photo-123', post_id: 'page_456' }) };
        };
        const first = await socialService.publishFacebookDraft(draftId);
        const replay = await socialService.publishFacebookDraft(draftId);
        assert.equal(first.mediaId, 'page_456');
        assert.equal(first.status, 'published');
        assert.equal(replay.alreadyPublished, true);
        assert.equal(calls, 1);
    } finally {
        fs.rmSync(tokenPath, { force: true });
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('Meta publisher: Instagram creates and then publishes a media container', async () => {
    const originalFetch = globalThis.fetch;
    const savedEnv = Object.fromEntries(['META_ACCESS_TOKEN_FILE', 'META_INSTAGRAM_USER_ID', 'META_GRAPH_API_VERSION']
        .map((key) => [key, process.env[key]]));
    const tokenPath = `/tmp/angibell-meta-token-${crypto.randomUUID()}`;
    const draftId = createSocialDraftForTest();
    try {
        process.env.META_ACCESS_TOKEN_FILE = tokenPath;
        process.env.META_INSTAGRAM_USER_ID = 'ig-test-123';
        process.env.META_GRAPH_API_VERSION = 'v26.0';
        fs.writeFileSync(tokenPath, 'test-instagram-token', { mode: 0o600 });
        const paths = [];
        globalThis.fetch = async (url) => {
            paths.push(String(url));
            return { ok: true, json: async () => paths.length === 1 ? { id: 'container-123' } : { id: 'ig-media-456' } };
        };
        const result = await socialService.publishInstagramDraft(draftId);
        assert.equal(result.mediaId, 'ig-media-456');
        assert.equal(paths.length, 2);
        assert.match(paths[0], /graph\.instagram\.com\/v26\.0\/ig-test-123\/media$/);
        assert.match(paths[1], /graph\.instagram\.com\/v26\.0\/ig-test-123\/media_publish$/);
    } finally {
        fs.rmSync(tokenPath, { force: true });
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('Meta publisher: ambiguous network failure blocks duplicate publishing', async () => {
    const originalFetch = globalThis.fetch;
    const savedEnv = Object.fromEntries(['META_FACEBOOK_PAGE_TOKEN_FILE', 'META_FACEBOOK_PAGE_ID']
        .map((key) => [key, process.env[key]]));
    const tokenPath = `/tmp/angibell-meta-token-${crypto.randomUUID()}`;
    const draftId = createSocialDraftForTest();
    try {
        process.env.META_FACEBOOK_PAGE_TOKEN_FILE = tokenPath;
        process.env.META_FACEBOOK_PAGE_ID = 'page-test-789';
        fs.writeFileSync(tokenPath, 'test-page-token', { mode: 0o600 });
        let calls = 0;
        globalThis.fetch = async () => { calls += 1; throw new TypeError('network unavailable'); };
        await assert.rejects(socialService.publishFacebookDraft(draftId), /network unavailable/);
        await assert.rejects(socialService.publishFacebookDraft(draftId), /PUBLICATION_UNCERTAIN/);
        assert.equal(calls, 1);
    } finally {
        fs.rmSync(tokenPath, { force: true });
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
