import { limaDate, resolveDeliveryDate } from './services/delivery-date.js';
import { updateShoppingContext, resolveShoppingContext } from './services/shopping-context.service.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { catalogService } from './services/catalog.service.js';
import { orderService } from './services/order.service.js';
import { paymentService } from './services/payment.service.js';
import { proposalService } from './services/proposal.service.js';
import { checkIdempotency, saveIdempotency } from './middleware/idempotency.js';
import { createAdminSession, getAuthContext } from './middleware/auth.js';
import { db } from './database/db.js';
import { agentService, isWithinAngibellScope, extractCatalogSize } from './services/agent.service.js';
import { socialService } from './services/social.service.js';
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

test('Catalog: refuses orders until a published product has a confirmed positive price', async () => {
    const adminId = crypto.randomUUID();
    const product = await catalogService.createProduct({
        name: 'Vestido Sin Precio Confirmado',
        description: 'Prueba de protección contra precio cero',
        variants: [{
            sku: `UNPRICED-${crypto.randomUUID()}`,
            size: 'Por definir',
            color: 'Por definir',
            price: { amountCents: 0, currency: 'PEN' },
            stock: 5,
        }],
    }, adminId);
    const proposal = await proposalService.createProposal({
        kind: 'publish_product',
        productId: product.id,
        expectedVersion: product.version,
    }, adminId);
    await proposalService.confirmProposal(proposal.id, adminId, 'CONFIRM');

    await assert.rejects(() => orderService.createOrder({
        items: [{ variantId: product.variants[0].id, quantity: 1 }],
        channel: 'test',
    }, crypto.randomUUID()), /PRODUCT_PRICE_UNSET/);
});

test('WhatsApp admin tools require admin role and exact Instagram publication confirmation', async () => {
    const denied = await agentService.executeTool('create_social_draft', {}, {
        actorId: crypto.randomUUID(), conversationId: null, userRole: 'customer', text: 'publica'
    });
    assert.match(denied.error, /solo la administradora/);

    const unpricedProposal = await agentService.executeTool('propose_product', {
        name: 'Vestido en espera de precio',
        variants: [{ size: 'S', color: 'Verde', stock: 10 }],
    }, {
        actorId: crypto.randomUUID(), conversationId: null, userRole: 'admin', text: 'Registra este vestido'
    });
    assert.match(unpricedProposal.error, /precio real/);

    const missingConfirmation = await agentService.executeTool('publish_instagram_draft', {
        draftId: crypto.randomUUID()
    }, {
        actorId: crypto.randomUUID(), conversationId: null, userRole: 'admin', text: 'Quiero publicar en Instagram'
    });
    assert.match(missingConfirmation.error, /CONFIRMAR INSTAGRAM/);
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


test('One CONFIRMAR publishes the requested web product and Instagram without multiplying total stock', async () => {
    const actorId = crypto.randomUUID();
    const context = { actorId, userRole: 'admin', text: 'Publica en la web e instagram, el stock es de 10 piezas y el precio 200 soles', storedImageUrls: ['/media/test-dress.jpg'] };
    const proposed = await agentService.executeTool('propose_product', {
        name: 'Vestido prueba confirmación única',
        variants: ['4', '6', '8', '10'].map(size => ({ size, color: 'Verde', priceCents: 20000, stock: 10 }))
    }, context);
    assert.equal(proposed.success, true);
    const row = await db.queryOne('SELECT action_payload FROM admin_proposals WHERE id = $1', [proposed.proposalId]);
    const action = JSON.parse(row.action_payload);
    assert.equal(action.publishInstagram, true);
    const variants = await db.query('SELECT * FROM variants WHERE product_id = $1', [action.productId]);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].stock_on_hand, 10);
    assert.equal(variants[0].size, 'Por confirmar');
    assert.deepEqual(JSON.parse((await db.queryOne('SELECT image_urls FROM products WHERE id = $1', [action.productId])).image_urls), ['/media/test-dress.jpg']);
    const originalPublish = socialService.publishInstagramDraft;
    let published = 0;
    socialService.publishInstagramDraft = async draftId => {
        published++;
        assert.ok(draftId);
        return { status: 'published', mediaId: 'test-media-id' };
    };
    try {
        const outcome = await agentService.processMessage({ ...context, text: 'CONFIRMAR' });
        assert.match(outcome.replyText, /Publicado en la web y en Instagram/);
        assert.equal(published, 1);
        assert.equal((await db.queryOne('SELECT status FROM products WHERE id = $1', [action.productId])).status, 'published');
        const repeated = await agentService.processMessage({ ...context, text: 'CONFIRMAR' });
        assert.match(repeated.replyText, /No hay una publicación pendiente/);
        assert.equal(published, 1);
    } finally {
        socialService.publishInstagramDraft = originalPublish;
    }
});

test('Catalog lookup finds white dresses by plural query and returns exact price and size', async () => {
    const actorId = crypto.randomUUID();
    const product = await catalogService.createProduct({
        name: 'Vestido Blanco Catálogo QA', description: 'Inventario provisional de demostración',
        imageUrls: ['/media/vestido-blanco-qa.jpg'],
        variants: [{ size: '10', color: 'Blanco', price: { amountCents: 12500, currency: 'PEN' }, stock: 3 }]
    }, actorId);
    const proposal = await proposalService.createProposal({ kind: 'publish_product', productId: product.id, expectedVersion: product.version }, actorId);
    await proposalService.confirmProposal(proposal.id, actorId, 'CONFIRM');
    const result = await agentService.executeTool('search_catalog', { query: 'vestidos blancos', size: '10' }, { userRole: 'customer' });
    const item = result.items.find(item => item.productId === product.id);
    assert.ok(item);
    assert.equal(item.priceSoles, '125.00');
    assert.equal(item.size, '10');
    assert.equal(item.stockEstimated, true);
});


test('Seed keeps only the owner phone as administrator and revokes other administrator sessions', async () => {
    const removed = await createAdminSession('+51933023008');
    await runSeed();
    const active = await db.query('SELECT phone FROM authorized_admins WHERE active = 1');
    assert.deepEqual(active.map(row => row.phone), ['+51995992450']);
    assert.equal((await db.queryOne('SELECT role FROM actors WHERE id = $1', [removed.actorId])).role, 'customer');
    const auth = await getAuthContext({ method: 'GET', headers: { authorization: `Bearer ${removed.token}` } });
    assert.equal(auth.role, 'customer');
});


test('Catalog size parsing never reads the plural word tallas as size S', () => {
    assert.equal(extractCatalogSize('[Nota de voz]: "Hola, quiero precios sobre vestidos blancos, en qué tallas tienes y ya, es nuevo."'), undefined);
    assert.equal(extractCatalogSize('¿Qué tallas tienes?'), undefined);
    assert.equal(extractCatalogSize('Quiero talla S'), 'S');
    assert.equal(extractCatalogSize('¿Tienes vestidos en talla 10?'), '10');
    assert.equal(extractCatalogSize('tallas 12'), '12');
    assert.equal(extractCatalogSize('talla: xl'), 'XL');
});

test('A voice question asking available tallas queries all sizes instead of filtering size S', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Tenemos opciones con precio y tallas.' } }] }), { status: 200 });
    try {
        const result = await agentService.processMessage({
            conversationId: crypto.randomUUID(), actorId: crypto.randomUUID(), userRole: 'customer',
            text: '[Nota de voz]: "Hola, quiero precios sobre vestidos blancos, en qué tallas tienes y ya, es nuevo."'
        });
        const lookup = result.toolExecutionLog.find(entry => entry.tool === 'search_catalog');
        assert.ok(lookup.result.count > 0);
        assert.equal(lookup.result.requestedSize, null);
        assert.ok(lookup.result.items.some(item => item.size === '10' && item.priceCents === 12500));
    } finally { globalThis.fetch = originalFetch; }
});


test('Shopping focus keeps Damita for pronouns, size and delivery, and changes only for another chosen model', () => {
    const products = [{ id: 'damita', name: 'Vestido Blanco Damita', price_cents: 15000 }, { id: 'blanco', name: 'Vestido Blanco', price_cents: 12500 }, { id: 'verde', name: 'Vestido Verde', price_cents: 20000 }];
    let state = updateShoppingContext({}, '¿En qué tallas viene el vestido blanco, damita?', products);
    assert.equal(state.productId, 'damita');
    state = updateShoppingContext(state, 'Quiero uno en talla 10, ¿está disponible todavía?', products);
    assert.equal(state.productId, 'damita');
    assert.equal(state.size, '10');
    state = updateShoppingContext(state, 'Lo quiero con delivery para mañana', products);
    state = updateShoppingContext(state, 'el vestido blanco de 150 soles', products);
    assert.equal(state.productId, 'damita');
    assert.equal(state.size, '10');
    state = updateShoppingContext(state, 'Prefiero el vestido verde', products);
    assert.equal(state.productId, 'verde');
    assert.equal(state.size, undefined);
});

test('Shopping focus survives unrelated turns and is persisted in the conversation', async () => {
    const actorId = crypto.randomUUID(), conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute("INSERT INTO actors(id,role,created_at) VALUES($1,'customer',$2)", [actorId, now]);
    await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at) VALUES($1,$2,'whatsapp',$3)", [conversationId, actorId, now]);
    const selected = await resolveShoppingContext(conversationId, 'Vestido Blanco Catálogo QA');
    assert.ok(selected.productId);
    await resolveShoppingContext(conversationId, 'Quiero uno en talla 10');
    for (let i = 0; i < 10; i++) await resolveShoppingContext(conversationId, 'Lo quiero con delivery para mañana');
    const restored = JSON.parse((await db.queryOne('SELECT shopping_context FROM conversations WHERE id=$1', [conversationId])).shopping_context);
    assert.equal(restored.productId, selected.productId);
    assert.equal(restored.size, '10');
    const wrongVariant = await db.queryOne('SELECT id FROM variants WHERE product_id <> $1 LIMIT 1', [selected.productId]);
    const blocked = await agentService.executeTool('create_order', { items: [{ variantId: wrongVariant.id, quantity: 1 }] }, { userRole: 'customer', actorId, conversationId, selectedProductId: selected.productId, selectedSize: '10' });
    assert.match(blocked.error, /no corresponde al producto/);
});

test('Public catalog hides products without photos while keeping their data available to administration', async () => {
    const actorId = crypto.randomUUID();
    const product = await catalogService.createProduct({ name: 'Sin fotografía QA', variants: [{ size: '10', color: 'Blanco', price: { amountCents: 10000, currency: 'PEN' }, stock: 2 }] }, actorId);
    const proposal = await proposalService.createProposal({ kind: 'publish_product', productId: product.id, expectedVersion: product.version }, actorId);
    await proposalService.confirmProposal(proposal.id, actorId, 'CONFIRM');
    assert.equal((await catalogService.getProducts({ limit: 200 })).items.some(item => item.id === product.id), false);
    assert.ok(await catalogService.getProductById(product.id));
    const result = await agentService.executeTool('search_catalog', { query: 'Sin fotografía QA' }, { userRole: 'customer' });
    assert.equal(result.count, 0);
});


test('Delivery dates use the current Lima calendar and reject obsolete requested dates', async () => {
    const reference = new Date('2026-10-19T02:00:00Z');
    assert.equal(limaDate(reference), '2026-10-18');
    assert.equal(resolveDeliveryDate('lo quiero para mañana', reference), '2026-10-19');
    assert.equal(resolveDeliveryDate('pasado mañana', reference), '2026-10-20');
    assert.equal(resolveDeliveryDate('2023/10/31', reference), '2023-10-31');
    assert.equal(resolveDeliveryDate('31/02/2026', reference), null);
    const state = updateShoppingContext({}, 'Lo quiero con delivery para mañana', [], reference);
    assert.equal(state.requestedDate, '2026-10-19');
    await assert.rejects(() => salesService.createRequest({ items: [{ variantId: 'unused', quantity: 1 }], deliveryMethod: 'pickup', requestedDate: '2023-10-31' }, crypto.randomUUID()), /no puede estar en el pasado/);
});

test('A query for one size still reports every stocked size of the matching product', async () => {
    const actorId = crypto.randomUUID();
    const product = await catalogService.createProduct({ name: 'Prenda tallas completas QA', imageUrls: ['/media/sizes-qa.jpg'], variants: ['4', '6', '10'].map(size => ({ size, color: 'Blanco', price: { amountCents: 15000, currency: 'PEN' }, stock: 2 })) }, actorId);
    const proposal = await proposalService.createProposal({ kind: 'publish_product', productId: product.id, expectedVersion: product.version }, actorId);
    await proposalService.confirmProposal(proposal.id, actorId, 'CONFIRM');
    const result = await agentService.executeTool('search_catalog', { size: '10' }, { userRole: 'customer', catalogProductId: product.id });
    assert.equal(result.count, 1);
    assert.deepEqual([...result.items[0].availableSizes].sort(), ['10', '4', '6']);
});

test('Requesting the complete catalog removes the focused-product filter', async () => {
    const actorId = crypto.randomUUID(), conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute("INSERT INTO actors(id,role,created_at) VALUES($1,'customer',$2)", [actorId, now]);
    await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at) VALUES($1,$2,'whatsapp',$3)", [conversationId, actorId, now]);
    const chosen = await resolveShoppingContext(conversationId, 'Prenda tallas completas QA');
    assert.ok(chosen.productId);
    const context = await resolveShoppingContext(conversationId, 'Muestra el catálogo completo');
    assert.equal(context.lookupProductId, null);
});

test('More preserves catalog filters and advances its persisted page', async () => {
    const actorId = crypto.randomUUID(), conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute("INSERT INTO actors(id,role,created_at) VALUES($1,'customer',$2)", [actorId, now]);
    await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at) VALUES($1,$2,'whatsapp',$3)", [conversationId, actorId, now]);
    const first = await resolveShoppingContext(conversationId, '¿Qué vestidos blancos tienes?');
    assert.equal(first.catalogOffset, 0);
    assert.equal(first.catalogQuery, 'blancos');
    const second = await resolveShoppingContext(conversationId, 'más');
    assert.equal(second.catalogOffset, 5);
    assert.equal(second.catalogQuery, 'blancos');
    assert.equal(second.lookupProductId, null);
    assert.equal((await resolveShoppingContext(conversationId, 'muéstrame más')).catalogOffset, 10);
    assert.equal((await resolveShoppingContext(conversationId, 'Muéstrame el catálogo completo')).catalogOffset, 0);
    assert.equal(isWithinAngibellScope('más', [{ role: 'assistant', text: 'Tenemos vestidos blancos. Escribe más para ver otros modelos.' }]), true);
});

test('Administrator approves a prepared sale by saying only CONFIRMAR, including a voice note', async () => {
    const admin = await createAdminSession('+51995992450');
    const conversationId = crypto.randomUUID();
    await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at) VALUES($1,$2,'whatsapp',$3)", [conversationId, admin.actorId, new Date().toISOString()]);
    const variant = await db.queryOne("SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE p.name='Prenda tallas completas QA' AND v.size='4'");
    const request = await salesService.createRequest({ items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'pickup', requestedDate: '2099-01-02' }, crypto.randomUUID());
    const preview = await salesService.prepareAdminConfirmation(request.id, admin.actorId, conversationId);
    assert.match(preview.replyText, /Responde CONFIRMAR/);
    assert.equal(preview.action.shippingCents, 0);
    const reply = await agentService.processMessage({ conversationId, actorId: admin.actorId, userRole: 'admin', text: '[Nota de voz]: "Confirmar"' });
    assert.match(reply.replyText, /Solicitud aprobada/);
    assert.equal((await db.queryOne('SELECT status FROM sales_requests WHERE id=$1', [request.id])).status, 'approved');
    const repeat = await agentService.processMessage({ conversationId, actorId: admin.actorId, userRole: 'admin', text: 'CONFIRMAR' });
    assert.match(repeat.replyText, /ya está aprobada/);
});

test('Delivery confirmation reuses a previously approved tariff for the same normalized zone', async () => {
    const admin = await createAdminSession('+51995992450');
    const variant = await db.queryOne("SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE p.name='Prenda tallas completas QA' AND v.size='6'");
    const request = await salesService.createRequest({ items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'delivery', deliveryZone: 'Tambo', deliveryAddress: 'Dirección de prueba', requestedDate: '2099-01-02' }, crypto.randomUUID());
    const preview = await salesService.prepareAdminConfirmation(request.id, admin.actorId);
    assert.equal(preview.action.shippingCents, 1000);
    assert.match(preview.replyText, /Total: S\/ 160.00/);
    assert.match(preview.replyText, /Fecha: 2099-01-02/);
});

test('Approved-sale notification keeps the customer WhatsApp LID transport', async () => {
    const row = await db.queryOne("SELECT * FROM sales_requests WHERE status='approved' AND delivery_method='pickup' ORDER BY created_at DESC LIMIT 1");
    const conversationId = crypto.randomUUID();
    await db.execute("UPDATE actors SET phone='+123456789012345' WHERE id=$1", [row.actor_id]);
    await db.execute("INSERT INTO conversations(id,actor_id,channel,created_at,shopping_context) VALUES($1,$2,'whatsapp',$3,$4)", [conversationId, row.actor_id, new Date().toISOString(), JSON.stringify({ whatsappSender: '123456789012345', whatsappIsLid: true })]);
    await db.execute('UPDATE sales_requests SET conversation_id=$1,notification_sent_at=NULL WHERE id=$2', [conversationId, row.id]);
    const { wppConnectService } = await import('./services/wppconnect.service.js');
    const originalSend = wppConnectService.sendMessage;
    const originalEnabled = process.env.WHATSAPP_BRIDGE_ENABLED;
    let target;
    process.env.WHATSAPP_BRIDGE_ENABLED = 'true';
    wppConnectService.sendMessage = async (phone, text, isLid) => { target = { phone, text, isLid }; return {}; };
    try {
        const result = await salesService.notifyCustomer(row.id);
        assert.equal(result.sent, true);
        assert.equal(target.phone, '123456789012345');
        assert.equal(target.isLid, true);
        assert.match(target.text, /fue aprobada/);
    } finally {
        wppConnectService.sendMessage = originalSend;
        if (originalEnabled === undefined) delete process.env.WHATSAPP_BRIDGE_ENABLED;
        else process.env.WHATSAPP_BRIDGE_ENABLED = originalEnabled;
    }
});
