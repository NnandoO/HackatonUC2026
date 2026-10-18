import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from './database/db.js';
import { catalogService } from './services/catalog.service.js';
import { proposalService } from './services/proposal.service.js';
import { orderService } from './services/order.service.js';
import { paymentService } from './services/payment.service.js';
import { chatService } from './services/chat.service.js';
import { socialService } from './services/social.service.js';
import { salesService } from './services/sales.service.js';
import { wppConnectService } from './services/wppconnect.service.js';
import { getAuthContext, createCustomerSession } from './middleware/auth.js';
import { checkIdempotency, saveIdempotency } from './middleware/idempotency.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_DIR = process.env.MEDIA_DIR || path.resolve(__dirname, '../../../.state/media');
const MEDIA_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
};

export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
    if (!appSecret || typeof signatureHeader !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
    const provided = Buffer.from(signatureHeader.slice(7), 'hex');
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export function sendJson(res, statusCode, data, requestId) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Request-Id, X-Angibell-Admin-Key',
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
    });
    res.end(body);
}

export function sendError(res, statusCode, code, message, requestId, fields) {
    sendJson(res, statusCode, {
        error: {
            code,
            message,
            requestId,
            ...(fields ? { fields } : {}),
        },
    }, requestId);
}

async function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 2 * 1024 * 1024) {
                req.destroy();
                reject(new Error('Payload too large'));
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

export function createServer() {
    return http.createServer(async (req, res) => {
        const requestId = crypto.randomUUID();

        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Request-Id, X-Angibell-Admin-Key',
            });
            res.end();
            return;
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = parsedUrl.pathname;
        const query = Object.fromEntries(parsedUrl.searchParams.entries());
        const method = req.method?.toUpperCase();

        try {
            // Fotos cargadas por el administrador o web.
            const mediaMatch = pathname.match(/^\/media\/([a-z0-9_-]+\.(?:jpg|jpeg|png|webp|avif|gif))$/i);
            if (method === 'GET' && mediaMatch) {
                const filename = mediaMatch[1];
                const mediaPath = path.join(MEDIA_DIR, filename);
                if (!fs.existsSync(mediaPath)) {
                    return sendError(res, 404, 'NOT_FOUND', 'Imagen no encontrada.', requestId);
                }
                const extension = path.extname(filename).slice(1).toLowerCase();
                res.writeHead(200, {
                    'Content-Type': MEDIA_TYPES[extension] || 'application/octet-stream',
                    'Content-Length': fs.statSync(mediaPath).size,
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'X-Content-Type-Options': 'nosniff'
                });
                fs.createReadStream(mediaPath).pipe(res);
                return;
            }

            // 0. GET / or /simulator -> Servir Simulador Web WhatsApp
            if (method === 'GET' && (pathname === '/' || pathname === '/simulator')) {
                const htmlPath = path.resolve(__dirname, 'simulator.html');
                if (fs.existsSync(htmlPath)) {
                    const html = fs.readFileSync(htmlPath, 'utf-8');
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(html);
                    return;
                }
            }

            // 0.05 GET /api/qr-status -> Estado y QR de WppConnect
            if (method === 'GET' && pathname === '/api/qr-status') {
                const qrData = await wppConnectService.getQrCode();
                return sendJson(res, 200, qrData, requestId);
            }

            // 0.06 GET /qr -> Página interactiva para escanear QR de WhatsApp
            if (method === 'GET' && pathname === '/qr') {
                const qrHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vincular WhatsApp Real — ANGIBELL 360</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c1317; color: #e9edef; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #111b21; border: 1px solid #2a3942; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; margin-bottom: 8px; color: #25d366; }
    p { font-size: 13.5px; color: #8696a0; line-height: 1.5; margin-bottom: 24px; }
    .qr-box { background: white; padding: 16px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; width: 280px; height: 280px; margin-bottom: 20px; }
    .qr-img { width: 100%; height: 100%; display: block; object-fit: contain; }
    .steps { text-align: left; background: #202c33; padding: 16px 20px; border-radius: 10px; font-size: 13px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px; }
    .steps ol { padding-left: 20px; margin: 0; }
    .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .status-badge.waiting { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-badge.connected { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
    .btn-reload { background: #202c33; border: 1px solid #2a3942; color: #fff; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .btn-reload:hover { background: #2a3942; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📱 Conectar tu WhatsApp Real</h1>
    <p>Escanea este código QR desde tu WhatsApp para que el agente responda a tus clientes y procese tus órdenes de voz/texto en vivo.</p>

    <div class="steps">
      <ol>
        <li>Abre WhatsApp en tu teléfono.</li>
        <li>Toca <strong>Menú (⋮)</strong> en Android o <strong>Ajustes (⚙️)</strong> en iPhone.</li>
        <li>Selecciona <strong>Dispositivos vinculados</strong>.</li>
        <li>Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara hacia esta pantalla.</li>
      </ol>
    </div>

    <div class="qr-box" id="qrContainer">
      <div style="color: #64748b; font-size: 13px;">Generando código QR...</div>
    </div>

    <div>
      <span class="status-badge waiting" id="statusBadge">Esperando escaneo...</span>
    </div>

    <div style="margin-top: 20px;">
      <button class="btn-reload" onclick="checkStatus()">Actualizar QR ⟳</button>
      <a href="/simulator" style="color: #25d366; text-decoration: none; font-size: 12px; margin-left: 15px;">Ir al Simulador Web →</a>
    </div>
  </div>

  <script>
    async function checkStatus() {
      try {
        const res = await fetch('/api/qr-status');
        const data = await res.json();
        const container = document.getElementById('qrContainer');
        const badge = document.getElementById('statusBadge');

        if (data.connected || data.status === 'CONNECTED') {
          container.innerHTML = '<div style="font-size: 48px; color: #22c55e;">✅<br><span style="font-size: 15px; font-weight: bold; color: #1e293b;">¡WhatsApp Conectado!</span></div>';
          badge.className = 'status-badge connected';
          badge.innerText = '¡Conexión Activa!';
          return;
        }

        if (data.qrcode) {
          const src = data.qrcode.startsWith('data:') ? data.qrcode : ('data:image/png;base64,' + data.qrcode);
          container.innerHTML = '<img class="qr-img" src="' + src + '" alt="QR Code">';
          badge.className = 'status-badge waiting';
          badge.innerText = 'Código QR listo para escanear';
        } else {
          container.innerHTML = '<div style="color: #64748b; font-size: 13px;">' + (data.message || 'Cargando QR...') + '</div>';
        }
      } catch (err) {
        console.error('Error cargando QR:', err);
      }
    }

    checkStatus();
    setInterval(checkStatus, 3000);
  </script>
</body>
</html>`;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(qrHtml);
                return;
            }

            // 1. GET /v1/health
            if (method === 'GET' && pathname === '/v1/health') {
                const probe = await db.queryOne('SELECT 1 as ok');
                return sendJson(res, 200, {
                    status: probe?.ok === 1 ? 'ok' : 'error',
                    db: probe?.ok === 1 ? 'connected' : 'disconnected',
                    mode: 'simulated',
                    service: 'ANGIBELL 360 Core API',
                    version: '1.0.0',
                }, requestId);
            }

            // 0.1 GET /checkout/simulated -> Pasarela de pago Culqi Simulada
            if (method === 'GET' && pathname === '/checkout/simulated') {
                const orderId = query.orderId || '';
                const order = await db.queryOne(`SELECT * FROM orders WHERE id = $1`, [orderId]);
                const totalFormatted = order ? (order.total_cents / 100).toFixed(2) : '120.00';
                const status = order ? order.status : 'pending_payment';

                const checkoutHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Culqi Checkout — ANGIBELL 360</title>
  <style>
    body { font-family: sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 360px; text-align: center; }
    .culqi-logo { color: #00b4d8; font-weight: bold; font-size: 24px; margin-bottom: 20px; }
    .amount { font-size: 32px; font-weight: bold; color: #1e293b; margin: 15px 0; }
    .btn { background: #00b4d8; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 16px; font-weight: bold; width: 100%; cursor: pointer; }
    .btn:hover { background: #0096c7; }
    .badge { background: #e2e8f0; padding: 4px 8px; border-radius: 6px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="culqi-logo">culqi</div>
    <h3>Pasarela Segura — Angibell 360</h3>
    <p>Pedido: <span class="badge">${orderId.slice(0, 8)}...</span></p>
    <div class="amount">S/ ${totalFormatted}</div>
    <p style="color: #64748b; font-size: 13px; margin-bottom: 20px;">Estado: <strong>${status}</strong></p>
    ${status === 'paid' ? '<div style="color: #16a34a; font-weight: bold;">✅ ¡Este pedido ya fue pagado con éxito!</div>' : `
      <button class="btn" onclick="pagar()">Pagar con Yape / Tarjeta (Simular)</button>
    `}
  </div>
  <script>
    async function pagar() {
      const res = await fetch('/v1/webhooks/culqi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order.status.changed',
          data: {
            order_id: '${orderId}',
            state: 'paid',
            metadata: { orderId: '${orderId}' }
          }
        })
      });
      alert('¡Pago procesado exitosamente en Culqi! Stock consumido.');
      window.location.reload();
    }
  </script>
</body>
</html>`;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(checkoutHtml);
                return;
            }

            // Meta redirects the browser here; state is single-use and validated by the service.
            if (method === 'GET' && pathname === '/v1/admin/meta/facebook/oauth/callback') {
                const returnUrl = new URL(process.env.META_PANEL_RETURN_URL || 'http://localhost:3002/panel');
                const redirect = (status) => {
                    returnUrl.searchParams.set('facebook', status);
                    res.writeHead(303, { Location: returnUrl.toString(), 'Cache-Control': 'no-store' });
                    res.end();
                };
                const { code, state, error: oauthError } = query;
                if (oauthError || !code || !state) return redirect('cancelled');
                try {
                    await socialService.completeFacebookOAuth(code, state);
                    return redirect('choose-page');
                } catch (error) {
                    console.error(`[${requestId}] Meta OAuth callback failed:`, error.message);
                    return redirect('failed');
                }
            }

            const auth = await getAuthContext(req);

            // 2. POST /v1/sessions
            if (method === 'POST' && pathname === '/v1/sessions') {
                const session = await createCustomerSession(auth.actorId);
                res.setHeader('Set-Cookie', `angibell_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
                return sendJson(res, 201, {
                    token: session.token,
                    expiresAt: session.expiresAt,
                }, requestId);
            }

            // 3. GET /v1/products
            if (method === 'GET' && pathname === '/v1/products') {
                const result = await catalogService.getProducts(query);
                return sendJson(res, 200, result, requestId);
            }

            // 4. GET /v1/products/:idOrSlug
            const prodMatch = pathname.match(/^\/v1\/products\/([a-zA-Z0-9_-]+)$/);
            if (method === 'GET' && prodMatch && prodMatch[1]) {
                const prod = await catalogService.getProductById(prodMatch[1]);
                if (!prod || prod.status !== 'published') {
                    return sendError(res, 404, 'NOT_FOUND', 'Producto no encontrado o no disponible.', requestId);
                }
                return sendJson(res, 200, prod, requestId);
            }

            // 5. POST /v1/admin/products
            if (method === 'POST' && pathname === '/v1/admin/products') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const bodyRaw = await readBody(req);
                const input = JSON.parse(bodyRaw || '{}');
                const prod = await catalogService.createProduct(input, auth.actorId);
                return sendJson(res, 201, prod, requestId);
            }

            // 6. GET /v1/admin/products
            if (method === 'GET' && pathname === '/v1/admin/products') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const result = await catalogService.adminGetProducts(query);
                return sendJson(res, 200, result, requestId);
            }

            // 6.1 GET /v1/admin/products/:id & PATCH /v1/admin/products/:id
            const adminProdMatch = pathname.match(/^\/v1\/admin\/products\/([a-zA-Z0-9_-]+)$/);
            if ((method === 'GET' || method === 'PATCH') && adminProdMatch && adminProdMatch[1]) {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                if (method === 'GET') {
                    const prod = await catalogService.getProductById(adminProdMatch[1]);
                    if (!prod) {
                        return sendError(res, 404, 'NOT_FOUND', 'Producto no encontrado.', requestId);
                    }
                    return sendJson(res, 200, prod, requestId);
                }
                const bodyRaw = await readBody(req);
                const input = JSON.parse(bodyRaw || '{}');
                const updated = await catalogService.updateProduct(adminProdMatch[1], input, auth.actorId);
                return sendJson(res, 200, updated, requestId);
            }

            // 6.2 PATCH /v1/admin/products/:id/status
            const prodStatusMatch = pathname.match(/^\/v1\/admin\/products\/([a-zA-Z0-9_-]+)\/status$/);
            if (method === 'PATCH' && prodStatusMatch && prodStatusMatch[1]) {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const bodyRaw = await readBody(req);
                const input = JSON.parse(bodyRaw || '{}');
                const prod = await catalogService.setProductStatus(prodStatusMatch[1], input.status, auth.actorId);
                return sendJson(res, 200, prod, requestId);
            }

            // 6.3 GET /v1/admin/publications & POST /v1/admin/publications
            if (pathname === '/v1/admin/publications') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                if (method === 'GET') {
                    const items = await catalogService.listPublications(query.limit);
                    return sendJson(res, 200, { items }, requestId);
                }
                if (method === 'POST') {
                    const bodyRaw = await readBody(req);
                    const input = JSON.parse(bodyRaw || '{}');
                    const pub = await catalogService.recordPublication(
                        input.productId || input.product_id || null,
                        input.payload ?? input,
                        input.note || ''
                    );
                    return sendJson(res, 201, pub, requestId);
                }
            }

            if (method === 'PATCH' && pathname === '/v1/admin/stock') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administradora.', requestId);
                }
                const input = JSON.parse(await readBody(req) || '{}');
                if (!Array.isArray(input.updates) || input.updates.length < 1 || input.updates.length > 200) {
                    return sendError(res, 400, 'INVALID_INPUT', 'updates debe contener entre 1 y 200 variantes.', requestId);
                }
                const now = new Date().toISOString();
                await db.transaction(async () => {
                    await db.execute(
                        `INSERT INTO actors (id, role, created_at) VALUES ($1, 'admin', $2) ON CONFLICT (id) DO NOTHING`,
                        [auth.actorId, now]
                    );
                    for (const update of input.updates) {
                        const variantId = String(update.variantId || '');
                        const stock = Number(update.stock);
                        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(variantId) || !Number.isSafeInteger(stock) || stock < 0 || stock > 100000) {
                            throw new Error('INVALID_INPUT: Cada ajuste necesita variantId y stock entero válido.');
                        }
                        const variant = await db.queryOne(`SELECT id, stock_reserved FROM variants WHERE id = $1 FOR UPDATE`, [variantId]);
                        if (!variant) throw new Error(`NOT_FOUND: Variante ${variantId} no encontrada.`);
                        if (stock < variant.stock_reserved) {
                            throw new Error(`CONFLICT: El stock no puede quedar por debajo de las unidades reservadas (${variant.stock_reserved}).`);
                        }
                        await db.execute(`UPDATE variants SET stock_on_hand = $1, version = version + 1 WHERE id = $2`, [stock, variantId]);
                        await db.execute(
                            `INSERT INTO audit_events (id, actor_id, action, entity_id, request_id, changes, created_at)
                             VALUES ($1, $2, 'set_stock', $3, $4, $5, $6)`,
                            [crypto.randomUUID(), auth.actorId, variantId, requestId, JSON.stringify({ stockOnHand: stock }), now]
                        );
                    }
                });
                return sendJson(res, 200, { ok: true, actualizadas: input.updates.length }, requestId);
            }

            // 7. POST /v1/admin/proposals
            if (method === 'POST' && pathname === '/v1/admin/proposals') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const bodyRaw = await readBody(req);
                const action = JSON.parse(bodyRaw || '{}');
                const proposal = await proposalService.createProposal(action, auth.actorId);
                return sendJson(res, 201, proposal, requestId);
            }

            // 8. POST /v1/admin/proposals/:id/confirm
            const confirmMatch = pathname.match(/^\/v1\/admin\/proposals\/([a-zA-Z0-9_-]+)\/confirm$/);
            if (method === 'POST' && confirmMatch && confirmMatch[1]) {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const bodyRaw = await readBody(req);
                const body = JSON.parse(bodyRaw || '{}');
                const result = await proposalService.confirmProposal(confirmMatch[1], auth.actorId, body.confirmation);
                return sendJson(res, 200, result, requestId);
            }

            // 9. POST /v1/orders (Idempotency required)
            if (method === 'POST' && pathname === '/v1/orders') {
                const idempotencyKey = req.headers['idempotency-key'];
                if (!idempotencyKey) {
                    return sendError(res, 400, 'INVALID_INPUT', 'Falta encabezado Idempotency-Key.', requestId);
                }
                const bodyRaw = await readBody(req);
                const cached = await checkIdempotency(auth.actorId, pathname, idempotencyKey, bodyRaw);
                if (cached === 'CONFLICT') {
                    return sendError(res, 409, 'CONFLICT', 'Idempotency-Key reutilizada con cuerpo distinto.', requestId);
                }
                if (cached) {
                    return sendJson(res, cached.responseCode, JSON.parse(cached.responseBody), requestId);
                }
                const input = JSON.parse(bodyRaw || '{}');
                const order = await orderService.createOrder(input, auth.actorId);
                await saveIdempotency(auth.actorId, pathname, idempotencyKey, bodyRaw, 201, JSON.stringify(order));
                return sendJson(res, 201, order, requestId);
            }

            // 10. GET /v1/orders/:id
            const orderMatch = pathname.match(/^\/v1\/orders\/([a-zA-Z0-9_-]+)$/);
            if (method === 'GET' && orderMatch && orderMatch[1]) {
                const order = await orderService.getOrderById(orderMatch[1], auth.actorId, auth.role === 'admin');
                if (!order) {
                    return sendError(res, 404, 'NOT_FOUND', 'Pedido no encontrado.', requestId);
                }
                return sendJson(res, 200, order, requestId);
            }

            // 11. GET /v1/admin/orders
            if (method === 'GET' && pathname === '/v1/admin/orders') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const orders = await orderService.adminGetOrders(query);
                return sendJson(res, 200, orders, requestId);
            }

            if (method === 'GET' && pathname === '/v1/admin/sales-requests') {
                if (auth.role !== 'admin') return sendError(res, 403, 'FORBIDDEN', 'Solo administradora.', requestId);
                return sendJson(res, 200, { items: await salesService.listPending(query.limit) }, requestId);
            }

            const saleApproveMatch = pathname.match(/^\/v1\/admin\/sales-requests\/([a-zA-Z0-9_-]+)\/approve$/);
            if (method === 'POST' && saleApproveMatch) {
                if (auth.role !== 'admin') return sendError(res, 403, 'FORBIDDEN', 'Solo administradora.', requestId);
                const input = JSON.parse(await readBody(req) || '{}');
                const result = await salesService.approveRequest(saleApproveMatch[1], auth.actorId, input, requestId);
                result.customerNotification = await salesService.notifyCustomer(result.id);
                return sendJson(res, 200, result, requestId);
            }

            const saleRejectMatch = pathname.match(/^\/v1\/admin\/sales-requests\/([a-zA-Z0-9_-]+)\/reject$/);
            if (method === 'POST' && saleRejectMatch) {
                if (auth.role !== 'admin') return sendError(res, 403, 'FORBIDDEN', 'Solo administradora.', requestId);
                const input = JSON.parse(await readBody(req) || '{}');
                return sendJson(res, 200, await salesService.rejectRequest(saleRejectMatch[1], auth.actorId, input.reason, requestId), requestId);
            }

            // 12. POST /v1/orders/:id/payments
            const payMatch = pathname.match(/^\/v1\/orders\/([a-zA-Z0-9_-]+)\/payments$/);
            if (method === 'POST' && payMatch && payMatch[1]) {
                const payment = await paymentService.createPayment(payMatch[1], auth.actorId, 'simulated');
                return sendJson(res, 201, payment, requestId);
            }

            // 13. GET /v1/orders/:id/payment
            const getPayMatch = pathname.match(/^\/v1\/orders\/([a-zA-Z0-9_-]+)\/payment$/);
            if (method === 'GET' && getPayMatch && getPayMatch[1]) {
                const payment = await paymentService.getPaymentByOrderId(getPayMatch[1]);
                if (!payment) {
                    return sendError(res, 404, 'NOT_FOUND', 'No hay pagos asociados para este pedido.', requestId);
                }
                return sendJson(res, 200, payment, requestId);
            }

            // 14. POST /v1/conversations
            if (method === 'POST' && pathname === '/v1/conversations') {
                const bodyRaw = await readBody(req);
                const body = JSON.parse(bodyRaw || '{}');
                const conv = await chatService.createConversation(auth.actorId, body.channel || 'web');
                return sendJson(res, 201, conv, requestId);
            }

            // 15. POST /v1/conversations/:id/messages
            const msgMatch = pathname.match(/^\/v1\/conversations\/([a-zA-Z0-9_-]+)\/messages$/);
            if (method === 'POST' && msgMatch && msgMatch[1]) {
                const bodyRaw = await readBody(req);
                const input = JSON.parse(bodyRaw || '{}');
                const result = await chatService.postMessage(msgMatch[1], auth.actorId, input, auth.role);
                return sendJson(res, 201, result, requestId);
            }

            // 16. GET /v1/admin/social-drafts
            if (method === 'GET' && pathname === '/v1/admin/social-drafts') {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const drafts = await socialService.getSocialDrafts(query);
                return sendJson(res, 200, drafts, requestId);
            }

            // 16.0 Facebook Page connection (OAuth callback is proxied by the authenticated web app).
            if (pathname.startsWith('/v1/admin/meta/facebook') && auth.role !== 'admin') {
                return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
            }
            if (method === 'POST' && pathname === '/v1/admin/meta/facebook/connect') {
                return sendJson(res, 200, await socialService.beginFacebookOAuth(), requestId);
            }
            if (method === 'GET' && pathname === '/v1/admin/meta/facebook/pages') {
                return sendJson(res, 200, { pages: await socialService.listFacebookPages() }, requestId);
            }
            if (method === 'POST' && pathname === '/v1/admin/meta/facebook/pages/select') {
                const body = JSON.parse((await readBody(req)) || '{}');
                return sendJson(res, 200, await socialService.selectFacebookPage(body.pageId), requestId);
            }
            if (method === 'DELETE' && pathname === '/v1/admin/meta/facebook') {
                return sendJson(res, 200, await socialService.disconnectFacebook(), requestId);
            }

            // 16.1 POST /v1/admin/social-drafts/:id/publish-instagram
            const publishInstagramMatch = pathname.match(/^\/v1\/admin\/social-drafts\/([a-zA-Z0-9_-]+)\/publish-instagram$/);
            if (method === 'POST' && publishInstagramMatch && publishInstagramMatch[1]) {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const result = await socialService.publishInstagramDraft(publishInstagramMatch[1]);
                return sendJson(res, 200, result, requestId);
            }

            // 16.2 POST /v1/admin/social-drafts/:id/publish-facebook
            const publishFacebookMatch = pathname.match(/^\/v1\/admin\/social-drafts\/([a-zA-Z0-9_-]+)\/publish-facebook$/);
            if (method === 'POST' && publishFacebookMatch && publishFacebookMatch[1]) {
                if (auth.role !== 'admin') {
                    return sendError(res, 403, 'FORBIDDEN', 'Acceso denegado: requiere rol de administrador.', requestId);
                }
                const result = await socialService.publishFacebookDraft(publishFacebookMatch[1]);
                return sendJson(res, 200, result, requestId);
            }

            // 17. Webhooks
            if (method === 'GET' && pathname === '/v1/webhooks/whatsapp') {
                const verifyToken = query['hub.verify_token'];
                const challenge = query['hub.challenge'];
                if (process.env.WHATSAPP_VERIFY_TOKEN && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(challenge || 'ok');
                    return;
                }
                return sendError(res, 403, 'FORBIDDEN', 'Desafío de WhatsApp rechazado: token inválido.', requestId);
            }

            if (method === 'POST' && pathname === '/v1/webhooks/whatsapp') {
                const bodyRaw = await readBody(req);
                if (!verifyMetaSignature(bodyRaw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET)) {
                    return sendError(res, 403, 'FORBIDDEN', 'Firma de Meta inválida o no configurada.', requestId);
                }
                const payload = JSON.parse(bodyRaw || '{}');

                if (payload.object !== 'whatsapp_business_account') {
                    return sendError(res, 400, 'INVALID_INPUT', 'Evento de WhatsApp inválido.', requestId);
                }

                let from = '+51912345678';
                let text = '';
                let imageUrls = [];

                // Caso A: Formato oficial Meta WhatsApp Cloud API
                if (payload.object === 'whatsapp_business_account' && payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
                    const waMsg = payload.entry[0].changes[0].value.messages[0];
                    from = `+${waMsg.from}`;
                    text = waMsg.text?.body || '';
                    if (waMsg.type === 'image' && waMsg.image?.id) {
                        imageUrls.push(`https://meta-media-proxy.angibell.pe/${waMsg.image.id}`);
                    }
                }
                else return sendJson(res, 200, { received: true, status: 'ignored' }, requestId);

                // Identificar rol: ¿Es el teléfono de la administradora?
                const isAdmin = Boolean(await db.queryOne(`SELECT phone FROM authorized_admins WHERE phone = $1 AND active = 1`, [from]));
                const role = isAdmin ? 'admin' : 'customer';

                // Buscar o registrar actor
                let actor = await db.queryOne(`SELECT id, role FROM actors WHERE phone = $1`, [from]);
                const nowIso = new Date().toISOString();
                if (!actor) {
                    const actorId = crypto.randomUUID();
                    await db.execute(`INSERT INTO actors (id, role, phone, created_at) VALUES ($1, $2, $3, $4)`, [actorId, role, from, nowIso]);
                    if (isAdmin) {
                        await db.execute(
                            `INSERT INTO authorized_admins (actor_id, phone, active) VALUES ($1, $2, 1) ON CONFLICT (phone) DO NOTHING`,
                            [actorId, from]
                        );
                    }
                    actor = { id: actorId, role };
                }

                // Buscar o crear conversación de WhatsApp
                let conv = await db.queryOne(`SELECT id FROM conversations WHERE actor_id = $1 AND channel = 'whatsapp'`, [actor.id]);
                if (!conv) {
                    const convId = crypto.randomUUID();
                    await db.execute(`INSERT INTO conversations (id, actor_id, channel, created_at) VALUES ($1, $2, 'whatsapp', $3)`, [convId, actor.id, nowIso]);
                    conv = { id: convId };
                }

                // Procesar mensaje a través del Agente IA OpenRouter
                const chatResult = await chatService.postMessage(conv.id, actor.id, {
                    text,
                    imageUrls
                }, role);

                return sendJson(res, 200, {
                    received: true,
                    from,
                    role,
                    conversationId: conv.id,
                    replyText: chatResult.message.text,
                    proposal: chatResult.proposal,
                    orderId: chatResult.orderId,
                    handoff: chatResult.handoff,
                    toolExecutionLog: chatResult.toolExecutionLog
                }, requestId);
            }

            if (method === 'POST' && pathname === '/v1/webhooks/culqi') {
                const bodyRaw = await readBody(req);
                const payload = JSON.parse(bodyRaw || '{}');
                const outcome = await paymentService.processCulqiWebhook(payload);
                return sendJson(res, 202, outcome, requestId);
            }

            // 404 Default
            return sendError(res, 404, 'NOT_FOUND', `Ruta ${method} ${pathname} no encontrada.`, requestId);
        }
        catch (err) {
            const msg = err.message || String(err);
            if (msg.startsWith('INVALID_INPUT:')) {
                return sendError(res, 400, 'INVALID_INPUT', msg.replace('INVALID_INPUT:', '').trim(), requestId);
            }
            if (msg.startsWith('FORBIDDEN:')) {
                return sendError(res, 403, 'FORBIDDEN', msg.replace('FORBIDDEN:', '').trim(), requestId);
            }
            if (msg.startsWith('NOT_FOUND:')) {
                return sendError(res, 404, 'NOT_FOUND', msg.replace('NOT_FOUND:', '').trim(), requestId);
            }
            if (msg.startsWith('CONFLICT:')) {
                return sendError(res, 409, 'CONFLICT', msg.replace('CONFLICT:', '').trim(), requestId);
            }
            if (msg.startsWith('PUBLICATION_UNCERTAIN:')) {
                return sendError(res, 409, 'PUBLICATION_UNCERTAIN', msg.replace('PUBLICATION_UNCERTAIN:', '').trim(), requestId);
            }
            if (msg.startsWith('META_NOT_CONFIGURED:')) {
                return sendError(res, 503, 'META_NOT_CONFIGURED', msg.replace('META_NOT_CONFIGURED:', '').trim(), requestId);
            }
            if (msg.startsWith('META_PUBLISH_DISABLED:')) {
                return sendError(res, 403, 'META_PUBLISH_DISABLED', msg.replace('META_PUBLISH_DISABLED:', '').trim(), requestId);
            }
            if (msg.startsWith('MEDIA_NOT_PUBLIC:')) {
                return sendError(res, 503, 'MEDIA_NOT_PUBLIC', msg.replace('MEDIA_NOT_PUBLIC:', '').trim(), requestId);
            }
            if (msg.startsWith('META_API_ERROR:')) {
                return sendError(res, 502, 'META_API_ERROR', msg.replace('META_API_ERROR:', '').trim(), requestId);
            }
            if (msg.startsWith('OUT_OF_STOCK:')) {
                return sendError(res, 409, 'OUT_OF_STOCK', msg.replace('OUT_OF_STOCK:', '').trim(), requestId);
            }
            if (msg.startsWith('EXPIRED:')) {
                return sendError(res, 410, 'EXPIRED', msg.replace('EXPIRED:', '').trim(), requestId);
            }
            return sendError(res, 500, 'PROVIDER_UNAVAILABLE', `Error interno: ${msg}`, requestId);
        }
    });
}
