import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { catalogService } from './services/catalog.service.js';
import { orderService } from './services/order.service.js';
import { paymentService } from './services/payment.service.js';
import { proposalService } from './services/proposal.service.js';
import { checkIdempotency, saveIdempotency } from './middleware/idempotency.js';
import { createAdminSession } from './middleware/auth.js';
import { db } from './database/db.js';
import { agentService, isWithinAngibellScope } from './services/agent.service.js';
import { salesService } from './services/sales.service.js';
import { createServer, verifyMetaSignature } from './server.js';
import { runSeed } from './seed.js';

before(async () => {
    await db.init();
});

after(async () => {
    await db.close();
});

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

test('Seed: creates admin session and does not seed mock products', async () => {
    await db.execute(`DELETE FROM products WHERE name IN ('Vestido de Fiesta Princesa Valery', 'Conjunto Elegante Camila', 'Vestido Casual Primavera Isabella')`);
    const result = await runSeed();
    assert.ok(result.adminToken.startsWith('ang_admin_'));
    const mockCheck = await db.query(
        `SELECT id FROM products WHERE name IN ('Vestido de Fiesta Princesa Valery', 'Conjunto Elegante Camila', 'Vestido Casual Primavera Isabella')`
    );
    assert.equal(mockCheck.length, 0);
});

test('Catalog: creates draft with slug, supports status transition, and requires proposal to publish', async () => {
    const actorId = crypto.randomUUID();
    const sku = `TEST-SKU-${crypto.randomUUID().slice(0, 8)}`;
    const prod = await catalogService.createProduct({
        name: 'Vestido Test Unitario',
        description: 'Vestido de prueba para test suite',
        imageUrls: ['https://example.com/test.jpg'],
        variants: [
            { sku, size: '6', color: 'Rojo', price: { amountCents: 10000, currency: 'PEN' }, stock: 5 }
        ]
    }, actorId);
    assert.equal(prod.status, 'draft');
    assert.ok(prod.slug.startsWith('vestido-test-unitario'));
    assert.equal(prod.variants.length, 1);
    assert.equal(prod.variants[0]?.available, 5);
    assert.equal(prod.variants[0]?.stockOnHand, 5);
    // Must not appear in public catalog while draft
    const publicList = await catalogService.getProducts({});
    assert.ok(!publicList.items.some(p => p.id === prod.id));
    // Create and confirm proposal
    const prop = await proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actorId);
    const confirmed = await proposalService.confirmProposal(prop.id, actorId, 'CONFIRM');
    assert.equal(confirmed.product?.status, 'published');
    // Now appears in public catalog and can be retrieved by slug
    const publicListAfter = await catalogService.getProducts({ limit: 100 });
    assert.ok(publicListAfter.items.some(p => p.id === prod.id));
    const bySlug = await catalogService.getProductBySlug(prod.slug);
    assert.equal(bySlug?.id, prod.id);
});

test('Order: transactional stock reservation and out-of-stock guard (including concurrent requests)', async () => {
    const actor1 = crypto.randomUUID();
    const actor2 = crypto.randomUUID();
    const sku = `LAST-UNIT-${crypto.randomUUID().slice(0, 8)}`;
    // Create a product with only 1 unit
    const prod = await catalogService.createProduct({
        name: 'Vestido Última Unidad',
        description: 'Solo queda una unidad para probar concurrencia',
        imageUrls: [],
        variants: [
            { sku, size: '8', color: 'Azul', price: { amountCents: 15000, currency: 'PEN' }, stock: 1 }
        ]
    }, actor1);
    const prop = await proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actor1);
    await proposalService.confirmProposal(prop.id, actor1, 'CONFIRM');
    const variantId = prod.variants[0].id;
    // Two concurrent buyers attempt to order the 1 unit simultaneously
    const results = await Promise.allSettled([
        orderService.createOrder({
            items: [{ variantId, quantity: 1 }],
            deliveryZoneId: 'pickup',
            channel: 'web'
        }, actor1),
        orderService.createOrder({
            items: [{ variantId, quantity: 1 }],
            deliveryZoneId: 'pickup',
            channel: 'web'
        }, actor2),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason.message, /OUT_OF_STOCK/);
    const order1 = fulfilled[0].value;
    assert.equal(order1.status, 'pending_payment');
    assert.equal(order1.total.amountCents, 15000);
});

test('Idempotency: returns cached response or 409 conflict on altered body', async () => {
    const actorId = crypto.randomUUID();
    const route = '/v1/orders';
    const key = crypto.randomUUID();
    const originalBody = JSON.stringify({ item: 'Vestido Rosa', qty: 1 });
    const alteredBody = JSON.stringify({ item: 'Vestido Azul', qty: 2 });
    // Save response
    await saveIdempotency(actorId, route, key, originalBody, 201, JSON.stringify({ orderId: 'ord-123' }));
    // Replay same body -> returns cached
    const cached = await checkIdempotency(actorId, route, key, originalBody);
    assert.notEqual(cached, null);
    assert.notEqual(cached, 'CONFLICT');
    assert.equal(cached.responseCode, 201);
    // Altered body with same key -> CONFLICT
    const conflict = await checkIdempotency(actorId, route, key, alteredBody);
    assert.equal(conflict, 'CONFLICT');
});

test('Payment & Webhook: stock settlement upon valid payment (including nested data.order_id)', async () => {
    const actorId = crypto.randomUUID();
    const sku = `PAY-TEST-${crypto.randomUUID().slice(0, 8)}`;
    const prod = await catalogService.createProduct({
        name: 'Vestido Para Pago',
        description: 'Prueba de deducción definitiva tras webhook Culqi',
        imageUrls: [],
        variants: [
            { sku, size: '10', color: 'Blanco', price: { amountCents: 8000, currency: 'PEN' }, stock: 3 }
        ]
    }, actorId);
    const prop = await proposalService.createProposal({
        kind: 'publish_product',
        productId: prod.id,
        expectedVersion: prod.version
    }, actorId);
    await proposalService.confirmProposal(prop.id, actorId, 'CONFIRM');
    const variantId = prod.variants[0].id;
    const order = await orderService.createOrder({
        items: [{ variantId, quantity: 2 }],
        deliveryZoneId: 'pickup',
        channel: 'web'
    }, actorId);
    const payment = await paymentService.createPayment(order.id, actorId, 'simulated');
    assert.equal(payment.status, 'pending');
    // Trigger Culqi webhook using simulated checkout payload shape (data.order_id)
    const outcome = await paymentService.processCulqiWebhook({
        id: `culqi_evt_${crypto.randomUUID().slice(0, 8)}`,
        type: 'order.status.changed',
        data: {
            order_id: order.id,
            state: 'paid',
            metadata: { orderId: order.id }
        }
    });
    assert.equal(outcome.received, true);
    assert.equal(outcome.status, 'order_paid_and_stock_deducted');
    // Verify order is paid
    const paidOrder = await orderService.getOrderById(order.id, actorId);
    assert.equal(paidOrder?.status, 'paid');
    // Check remaining stock: was 3, ordered 2 -> 1 remaining on hand
    const updatedVariant = await db.queryOne(`SELECT * FROM variants WHERE id = $1`, [variantId]);
    assert.equal(updatedVariant.stock_on_hand, 1);
    assert.equal(updatedVariant.stock_reserved, 0);
});

test('Sales advisor: validation is required before reserving stock or creating a payment', async () => {
    const customerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    await db.execute(`INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2)`, [customerId, new Date().toISOString()]);
    await db.execute(`INSERT INTO actors (id, role, created_at) VALUES ($1, 'admin', $2)`, [adminId, new Date().toISOString()]);
    const product = await catalogService.createProduct({
        name: 'Vestido Venta Validada',
        description: 'Prueba de validación comercial',
        imageUrls: [],
        variants: [{
            sku: `SALE-${crypto.randomUUID()}`,
            size: '8',
            color: 'Rosa',
            price: { amountCents: 12000, currency: 'PEN' },
            stock: 3
        }]
    }, adminId);
    const publish = await proposalService.createProposal({
        kind: 'publish_product',
        productId: product.id,
        expectedVersion: product.version
    }, adminId);
    await proposalService.confirmProposal(publish.id, adminId, 'CONFIRM');
    const variantId = product.variants[0].id;
    const request = await salesService.createRequest({
        items: [{ variantId, quantity: 1 }],
        deliveryMethod: 'delivery',
        deliveryZone: 'El Tambo',
        deliveryAddress: 'Jr. Prueba 123',
        requestedDate: 'domingo'
    }, customerId);
    assert.equal(request.status, 'pending');
    assert.equal((await db.queryOne(`SELECT stock_reserved FROM variants WHERE id = $1`, [variantId])).stock_reserved, 0);
    assert.equal((await db.queryOne(`SELECT COUNT(*) AS count FROM orders WHERE actor_id = $1`, [customerId])).count, 0);
    await assert.rejects(() => salesService.approveRequest(request.id, customerId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 }), /FORBIDDEN/);
    await assert.rejects(() => salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01' }), /INVALID_INPUT/);
    const inventedApproval = await agentService.executeTool('approve_sale',
        { requestId: request.id, deliveryDate: '2099-01-01', shippingCents: 1000 },
        { actorId: adminId, conversationId: null, userRole: 'admin', text: 'Aprueba esa venta' });
    assert.match(inventedApproval.error, /escribe/);
    assert.equal((await db.queryOne(`SELECT status FROM sales_requests WHERE id = $1`, [request.id])).status, 'pending');
    const approved = await salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.totalCents, 13000);
    assert.equal((await db.queryOne(`SELECT stock_reserved FROM variants WHERE id = $1`, [variantId])).stock_reserved, 1);
    await assert.rejects(() => salesService.approveRequest(request.id, adminId,
        { deliveryDate: '2099-01-01', shippingCents: 1000 }), /CONFLICT/);
});

test('HTTP Server: /v1/health, auto-SKU creation, status PATCH, slug lookup, and publications endpoints', async () => {
    const admin = await createAdminSession('+51995992450');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        // 1. Health check
        const healthRes = await fetch(`${baseUrl}/v1/health`);
        assert.equal(healthRes.status, 200);
        const healthBody = await healthRes.json();
        assert.equal(healthBody.status, 'ok');
        assert.equal(healthBody.db, 'connected');

        // 2. Create product without explicit SKU
        const createRes = await fetch(`${baseUrl}/v1/admin/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${admin.token}`,
            },
            body: JSON.stringify({
                name: 'Vestido Gala Aurora',
                description: 'Tul bordado',
                category: 'Fiesta',
                colors: ['Dorado', 'Champagne'],
                priceCents: 14500,
                compareAtCents: 18000,
                source: 'paperclip',
                variants: [
                    { size: '6', color: 'Dorado', price: { amountCents: 14500, currency: 'PEN' }, stock: 4 }
                ]
            })
        });
        assert.equal(createRes.status, 201);
        const created = await createRes.json();
        assert.ok(created.slug.startsWith('vestido-gala-aurora'));
        assert.ok(created.variants[0].sku.startsWith('ANG-'));
        assert.equal(created.status, 'draft');

        // 3. Approve via PATCH /v1/admin/products/:id/status
        const patchRes = await fetch(`${baseUrl}/v1/admin/products/${created.id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${admin.token}`,
            },
            body: JSON.stringify({ status: 'published' }),
        });
        assert.equal(patchRes.status, 200);
        const published = await patchRes.json();
        assert.equal(published.status, 'published');

        // 4. Fetch by slug on public endpoint
        const getSlugRes = await fetch(`${baseUrl}/v1/products/${created.slug}`);
        assert.equal(getSlugRes.status, 200);
        const bySlug = await getSlugRes.json();
        assert.equal(bySlug.id, created.id);

        // 5. Record and list publications
        const postPubRes = await fetch(`${baseUrl}/v1/admin/publications`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${admin.token}`,
            },
            body: JSON.stringify({
                productId: created.id,
                payload: { title: created.name },
                note: 'Aprobado en panel',
            })
        });
        assert.equal(postPubRes.status, 201);

        const listPubRes = await fetch(`${baseUrl}/v1/admin/publications?limit=10`, {
            headers: { 'Authorization': `Bearer ${admin.token}` }
        });
        assert.equal(listPubRes.status, 200);
        const listPubBody = await listPubRes.json();
        assert.ok(Array.isArray(listPubBody.items));
        assert.ok(listPubBody.items.some(p => p.product_id === created.id));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
