import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import module from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

// Register hook so Node v22+/v26 can import extensionless TypeScript modules from web/src/lib/*
if (typeof module.registerHooks === 'function') {
    module.registerHooks({
        resolve(specifier, context, nextResolve) {
            try {
                return nextResolve(specifier, context);
            } catch (err) {
                if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
                    const parentDir = path.dirname(fileURLToPath(context.parentURL));
                    const candidateTs = path.resolve(parentDir, `${specifier}.ts`);
                    if (fs.existsSync(candidateTs)) {
                        return nextResolve(pathToFileURL(candidateTs).href, context);
                    }
                }
                throw err;
            }
        }
    });
}

import { db } from './database/db.js';
import { runSeed } from './seed.js';
import { createServer } from './server.js';
import { agentService } from './services/agent.service.js';
import { catalogService } from './services/catalog.service.js';
import { orderService } from './services/order.service.js';
import { salesService } from './services/sales.service.js';
import { socialService } from './services/social.service.js';

let server;
let baseUrl;
let webDb;
let webFlow;
let webPublic;
const ADMIN_SERVICE_KEY = 'qa_test_admin_service_key_360';

async function resetAllTables() {
    await db.execute(`
        TRUNCATE TABLE
            webhook_inbox,
            idempotency,
            messages,
            meta_facebook_connection,
            meta_pending_pages,
            meta_oauth_states,
            social_publications,
            social_drafts,
            audit_events,
            admin_proposals,
            payments,
            reservations,
            order_items,
            sales_requests,
            orders,
            conversations,
            authorized_admins,
            sessions,
            actors,
            publications,
            variants,
            products
        RESTART IDENTITY CASCADE
    `);
}

before(async () => {
    process.env.ANGIBELL_ADMIN_SERVICE_KEY = ADMIN_SERVICE_KEY;
    await db.init();
    await resetAllTables();

    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    process.env.ANGIBELL_API_URL = baseUrl;

    webDb = await import(pathToFileURL(path.join(repoRoot, 'web/src/lib/db.ts')).href);
    webFlow = await import(pathToFileURL(path.join(repoRoot, 'web/src/lib/flow.ts')).href);
    webPublic = await import(pathToFileURL(path.join(repoRoot, 'web/src/lib/public.ts')).href);
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await db.close();
});

test('1. Migración de esquema y base limpia (sin mocks ni ERPNext)', async () => {
    await resetAllTables();
    const seedResult = await runSeed();
    assert.ok(seedResult.adminToken.startsWith('ang_admin_'));
    assert.ok(seedResult.actorId);

    const tables = await db.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
    );
    const tableNames = tables.map((t) => t.table_name);
    const expectedTables = [
        'actors',
        'admin_proposals',
        'audit_events',
        'authorized_admins',
        'conversations',
        'idempotency',
        'messages',
        'meta_facebook_connection',
        'meta_oauth_states',
        'meta_pending_pages',
        'order_items',
        'orders',
        'payments',
        'products',
        'publications',
        'reservations',
        'sales_requests',
        'sessions',
        'social_drafts',
        'social_publications',
        'variants',
        'webhook_inbox',
    ];
    for (const expected of expectedTables) {
        assert.ok(tableNames.includes(expected), `Falta la tabla esperada en PostgreSQL: ${expected}`);
    }
    assert.ok(!tableNames.includes('settings'), 'La tabla settings de ERPNext no debe existir');

    const productCount = await db.queryOne(`SELECT COUNT(*) AS count FROM products`);
    assert.equal(productCount.count, 0, 'runSeed() no debe sembrar productos mock');
});

test('2. Flujo WhatsApp Admin → Web: propose_product + confirm_proposal publica en tienda web y crea 1 social_draft', async () => {
    const adminActorId = crypto.randomUUID();
    await db.execute(
        `INSERT INTO actors (id, role, phone, created_at) VALUES ($1, 'admin', '+51995992450', $2)`,
        [adminActorId, new Date().toISOString()]
    );

    const proposeRes = await agentService.executeTool(
        'propose_product',
        {
            name: 'Vestido Princesa Huancayo QA',
            description: 'Vestido de tul bordado a mano para fiesta infantil',
            imageUrls: ['https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=800'],
            variants: [
                { size: '6', color: 'Palo Rosa', priceCents: 13500, stock: 4 },
                { size: '8', color: 'Palo Rosa', priceCents: 14500, stock: 2 },
            ],
        },
        { actorId: adminActorId, conversationId: null, userRole: 'admin' }
    );

    assert.equal(proposeRes.success, true);
    assert.ok(proposeRes.proposalId);

    // Antes de confirmar, no debe aparecer como publicado en la tienda web
    const beforeConfirm = await webDb.listProducts({ status: 'publicado' });
    assert.equal(beforeConfirm.some((p) => p.name === 'Vestido Princesa Huancayo QA'), false);

    // Confirmar propuesta desde el bot administrativo
    const confirmRes = await agentService.executeTool(
        'confirm_proposal',
        { proposalId: proposeRes.proposalId },
        { actorId: adminActorId, conversationId: null, userRole: 'admin' }
    );
    assert.equal(confirmRes.success, true);
    assert.equal(confirmRes.status, 'confirmed');
    assert.equal(confirmRes.product?.status, 'published');
    assert.ok(confirmRes.socialDraft?.id);

    // Verificar con las funciones reales de web/src/lib/db.ts contra el servidor HTTP
    const publishedProducts = await webDb.listProducts({ status: 'publicado' });
    const webProduct = publishedProducts.find((p) => p.id === confirmRes.product.id);
    assert.ok(webProduct, 'El producto confirmado por WhatsApp debe aparecer inmediatamente en listProducts({ status: "publicado" })');
    assert.equal(webProduct.status, 'publicado');
    assert.equal(webProduct.source, 'whatsapp');
    assert.equal(webProduct.priceCents, 13500);
    assert.equal(webProduct.variants.length, 2);

    const bySlug = await webDb.getProductBySlug(webProduct.slug);
    assert.ok(bySlug, 'getProductBySlug debe encontrar el producto recién publicado');
    assert.equal(bySlug.id, webProduct.id);
    assert.equal(bySlug.variants[0].stockDeclared, 4);

    // Verificar que existe exactamente 1 social_draft para este producto (incluso si se reintenta confirmar)
    await agentService.executeTool(
        'confirm_proposal',
        { proposalId: proposeRes.proposalId },
        { actorId: adminActorId, conversationId: null, userRole: 'admin' }
    );
    const draftsCount = await db.queryOne(
        `SELECT COUNT(*) AS count FROM social_drafts WHERE product_id = $1`,
        [webProduct.id]
    );
    assert.equal(draftsCount.count, 1, 'Debe generarse exactamente 1 social_draft sin duplicados');
});

test('3. Flujo Panel Web → Catálogo y Bot: createProduct, approveProduct, rejectProduct, addProductImages, stock y publications', async () => {
    // 3.1 Crear producto pendiente desde web/src/lib/db.ts
    const createdPending = await webDb.createProduct({
        name: 'Conjunto Gala Imperial QA',
        description: 'Conjunto de dos piezas en raso',
        priceCents: 16000,
        compareAtCents: 19000,
        category: 'Gala',
        colors: ['Champagne'],
        imageUrls: ['/media/gala-1.jpg'],
        variants: [
            { size: '10', color: 'Champagne', stock: 5 },
        ],
        status: 'pendiente',
        source: 'paperclip',
    });
    assert.equal(createdPending.status, 'pendiente');
    assert.equal(createdPending.variants.length, 1);

    // 3.2 Crear otro producto y rechazarlo desde el panel
    const toReject = await webDb.createProduct({
        name: 'Modelo Descartado QA',
        description: 'No debe salir en tienda ni bot',
        priceCents: 9900,
        variants: [{ size: '4', color: 'Gris', stock: 3 }],
        status: 'pendiente',
    });
    const rejected = await webFlow.rejectProduct(toReject.id);
    assert.equal(rejected.status, 'rechazado');

    // 3.3 Adjuntar imagen adicional con addProductImages (PATCH /v1/admin/products/:id)
    await webDb.addProductImages(createdPending.id, ['/media/gala-2.jpg']);
    const afterImages = await webDb.getProductById(createdPending.id);
    assert.ok(afterImages);
    assert.deepEqual(afterImages.imageUrls, ['/media/gala-1.jpg', '/media/gala-2.jpg']);

    // 3.4 Aprobar el producto desde el panel web
    const approvedOutcome = await webFlow.approveProduct(createdPending.id);
    assert.equal(approvedOutcome.product.status, 'publicado');

    // Verificar que al aprobar también se creó su social_draft con las 2 imágenes
    const draft = await db.queryOne(
        `SELECT * FROM social_drafts WHERE product_id = $1`,
        [createdPending.id]
    );
    assert.ok(draft, 'Aprobar en panel web debe asegurar social_draft en PostgreSQL');
    assert.deepEqual(JSON.parse(draft.image_urls), ['/media/gala-1.jpg', '/media/gala-2.jpg']);

    // 3.5 Ajustar stock desde el almacén manual del panel web
    const variantId = approvedOutcome.product.variants[0].id;
    await webDb.setVariantDeclaredStock(variantId, 9);

    // 3.6 Registrar y listar publicaciones del panel (#registro)
    await webDb.recordPublication(
        createdPending.id,
        { name: createdPending.name, source: 'paperclip' },
        `Publicación QA registrada: ${createdPending.name}`
    );
    const publications = await webDb.listPublications(20);
    const matchedPub = publications.find((p) => p.productId === createdPending.id);
    assert.ok(matchedPub, 'listPublications debe devolver la publicación registrada');
    assert.equal(matchedPub.productName, 'Conjunto Gala Imperial QA');
    assert.match(matchedPub.note, /Publicación QA registrada/);

    // 3.7 Verificar que search_catalog del bot de WhatsApp ve el producto aprobado con stock=9 y NO ve el rechazado
    const botSearchApproved = await agentService.executeTool(
        'search_catalog',
        { query: 'Imperial' },
        { actorId: 'bot-customer-qa', conversationId: null, userRole: 'customer' }
    );
    assert.equal(botSearchApproved.count, 1);
    assert.equal(botSearchApproved.items[0].productId, createdPending.id);
    assert.equal(botSearchApproved.items[0].availableStock, 9);

    const botSearchRejected = await agentService.executeTool(
        'search_catalog',
        { query: 'Descartado' },
        { actorId: 'bot-customer-qa', conversationId: null, userRole: 'customer' }
    );
    assert.equal(botSearchRejected.count, 0, 'El bot no debe mostrar productos rechazados');
});

test('4. Stock concurrente: múltiples createOrder simultáneos respetan SELECT ... FOR UPDATE sin sobreventa', async () => {
    const prod = await webDb.createProduct({
        name: 'Vestido Edición Limitada Concurrencia QA',
        description: 'Solo 2 unidades disponibles',
        priceCents: 15000,
        variants: [{ size: '8', color: 'Rojo Rubí', stock: 2 }],
        status: 'publicado',
        publish: true,
    });
    const variantId = prod.variants[0].id;

    // 5 compradores concurrentes intentan reservar 1 unidad cada uno (stock disponible = 2)
    const buyers = Array.from({ length: 5 }, () => crypto.randomUUID());
    const outcomes = await Promise.allSettled(
        buyers.map((actorId) =>
            orderService.createOrder(
                {
                    items: [{ variantId, quantity: 1 }],
                    deliveryZoneId: 'pickup',
                    channel: 'web',
                },
                actorId
            )
        )
    );

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    assert.equal(fulfilled.length, 2, 'Exactamente 2 pedidos deben reservar las 2 unidades disponibles');
    assert.equal(rejected.length, 3, 'Los 3 pedidos restantes deben ser rechazados por falta de stock');
    for (const r of rejected) {
        assert.match(r.reason.message, /OUT_OF_STOCK/);
    }

    const variantRow = await db.queryOne(`SELECT stock_on_hand, stock_reserved FROM variants WHERE id = $1`, [variantId]);
    assert.equal(variantRow.stock_on_hand, 2);
    assert.equal(variantRow.stock_reserved, 2);

    // La tienda web debe reflejar inmediatamente 0 unidades disponibles (agotado)
    const inStore = await webDb.getProductBySlug(prod.slug);
    assert.ok(inStore);
    const pubView = webPublic.toPublicProduct(inStore);
    assert.equal(pubView.totalStock, 0);
    assert.equal(pubView.agotado, true);
});

test('5. Pedidos, Solicitudes de Venta y Pagos Culqi: sales_request → aprobación admin → webhook Culqi → descuento real en web', async () => {
    const customerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(`INSERT INTO actors (id, role, phone, created_at) VALUES ($1, 'customer', '+51911222333', $2)`, [customerId, nowIso]);
    await db.execute(`INSERT INTO actors (id, role, phone, created_at) VALUES ($1, 'admin', '+51995992450', $2)`, [adminId, nowIso]);

    const prod = await webDb.createProduct({
        name: 'Vestido Comunión Celestial QA',
        description: 'Encaje francés blanco perla',
        priceCents: 18000,
        variants: [{ size: '10', color: 'Blanco Perla', stock: 5 }],
        status: 'publicado',
        publish: true,
    });
    const variantId = prod.variants[0].id;

    // 5.1 Cliente solicita compra mediante herramienta del agente (create_order -> sales_request)
    const createOrderTool = await agentService.executeTool(
        'create_order',
        {
            items: [{ variantId, quantity: 2 }],
            deliveryMethod: 'delivery',
            deliveryZone: 'El Tambo',
            deliveryAddress: 'Av. Real 456',
            requestedDate: 'sábado',
        },
        { actorId: customerId, conversationId: null, userRole: 'customer' }
    );
    assert.equal(createOrderTool.success, true);
    assert.equal(createOrderTool.status, 'pending_admin_validation');

    // Antes de aprobar, el stock en tienda sigue siendo 5
    const beforeApprove = await webDb.getProductBySlug(prod.slug);
    assert.equal(beforeApprove.variants[0].stockDeclared, 5);

    // 5.2 Administradora aprueba la solicitud de venta (reserva 2 unidades y crea pago simulado)
    const approval = await salesService.approveRequest(createOrderTool.requestId, adminId, {
        deliveryDate: '2099-12-15',
        shippingCents: 1500,
    });
    assert.equal(approval.status, 'approved');
    assert.ok(approval.orderId);
    assert.equal(approval.totalCents, 2 * 18000 + 1500);
    assert.match(approval.checkoutUrl, /\/checkout\/simulated\?/);

    // Al aprobarse la venta, las 2 unidades quedan reservadas -> tienda web muestra 3 disponibles
    const afterApprove = await webDb.getProductBySlug(prod.slug);
    assert.equal(afterApprove.variants[0].stockDeclared, 3);

    // 5.3 Procesar webhook de Culqi vía HTTP POST /v1/webhooks/culqi con formato simulado data.order_id
    const webhookRes = await fetch(`${baseUrl}/v1/webhooks/culqi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: `evt_qa_${crypto.randomUUID().slice(0, 8)}`,
            type: 'order.status.changed',
            data: {
                order_id: approval.orderId,
                state: 'paid',
                metadata: { orderId: approval.orderId },
            },
        }),
    });
    assert.equal(webhookRes.status, 202);
    const webhookBody = await webhookRes.json();
    assert.equal(webhookBody.status, 'order_paid_and_stock_deducted');

    // 5.4 Verificar que el pedido pasó a paid y que el stock físico (stock_on_hand) bajó a 3 y reservado a 0
    const orderAfter = await orderService.getOrderById(approval.orderId, customerId);
    assert.equal(orderAfter.status, 'paid');

    const variantDb = await db.queryOne(`SELECT stock_on_hand, stock_reserved FROM variants WHERE id = $1`, [variantId]);
    assert.equal(variantDb.stock_on_hand, 3);
    assert.equal(variantDb.stock_reserved, 0);

    // 5.5 Verificar que listProducts en web refleja inmediatamente el stock descontado (3)
    const storeList = await webDb.listProducts({ status: 'publicado' });
    const storeProd = storeList.find((p) => p.id === prod.id);
    assert.ok(storeProd);
    assert.equal(storeProd.variants[0].stockDeclared, 3);
});

test('6. OAuth de Meta y Salud (/v1/health con PostgreSQL)', async () => {
    process.env.META_APP_ID = '1234567890';
    process.env.META_APP_SECRET = 'meta_secret_qa_test';
    process.env.META_OAUTH_REDIRECT_URI = `${baseUrl}/v1/admin/meta/facebook/oauth/callback`;
    process.env.META_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const oauthStart = await socialService.beginFacebookOAuth();
    assert.ok(oauthStart.authorizationUrl.startsWith('https://www.facebook.com/'));

    const parsedAuthUrl = new URL(oauthStart.authorizationUrl);
    const state = parsedAuthUrl.searchParams.get('state');
    assert.ok(state, 'beginFacebookOAuth debe incluir parámetro state');

    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    const savedState = await db.queryOne(
        `SELECT * FROM meta_oauth_states WHERE state_hash = $1`,
        [stateHash]
    );
    assert.ok(savedState, 'El hash del estado OAuth debe guardarse en meta_oauth_states en PostgreSQL');

    const connStatus = await socialService.getConnectionStatus();
    assert.equal(connStatus.facebook, false);
    assert.equal(connStatus.facebookOAuthConfigured, true);

    const healthRes = await fetch(`${baseUrl}/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.db, 'connected');
});
