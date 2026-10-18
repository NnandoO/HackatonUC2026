import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './database/db.js';
import { messageDeduplicationKey, WppConnectService, formatWhatsAppCatalog } from './services/wppconnect.service.js';

test('WPPConnect messages without id receive a stable deduplication key', () => {
  const message = {
    session: 'angibell',
    from: '51900000000@c.us',
    clientReceivedTsMillis: 1792344000123,
    type: 'chat',
    body: 'hola',
  };

  const key = messageDeduplicationKey(message);
  assert.ok(key?.startsWith('fallback:'));
  assert.equal(messageDeduplicationKey({ ...message }), key);
  assert.notEqual(messageDeduplicationKey({ ...message, body: 'buenas' }), key);
});

test('WPPConnect preserves native message ids and rejects unidentifiable events', () => {
  assert.equal(messageDeduplicationKey({ id: { _serialized: 'native-id' } }), 'native-id');
  assert.equal(messageDeduplicationKey({ type: 'chat' }), null);
});

test('WPPConnect authorizes an administrator LID only after resolving it to an allowlisted phone', async () => {
  const service = new WppConnectService();
  const originalQueryOne = db.queryOne;
  const originalFetch = globalThis.fetch;
  service.getToken = async () => 'test-token';
  const checkedPhones = [];
  db.queryOne = async (_sql, [phone]) => {
    checkedPhones.push(phone);
    return phone === '+51995992450' ? { phone } : null;
  };
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /contact\/pn-lid\/152875737075771%40lid$/);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(JSON.stringify({
      phoneNumber: { id: '51995992450', server: 'c.us' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    assert.equal(await service.isAuthorizedAdmin('152875737075771', true), true);
    assert.deepEqual(checkedPhones, ['+152875737075771', '+51995992450']);
  } finally {
    db.queryOne = originalQueryOne;
    globalThis.fetch = originalFetch;
  }
});

test('WPPConnect fails closed when an LID resolves to a non-admin phone', async () => {
  const service = new WppConnectService();
  const originalQueryOne = db.queryOne;
  const originalFetch = globalThis.fetch;
  service.getToken = async () => 'test-token';
  db.queryOne = async (_sql, [phone]) => phone === '+51933023008' ? { phone } : null;
  globalThis.fetch = async () => new Response(JSON.stringify({
    phoneNumber: { id: '51937730623', server: 'c.us' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    assert.equal(await service.isAuthorizedAdmin('109604042215613', true), false);
  } finally {
    db.queryOne = originalQueryOne;
    globalThis.fetch = originalFetch;
  }
});


test('WPPConnect ignores echoed outbound text even when the gateway changes its message id and sender', async () => {
  const service = new WppConnectService();
  service.getToken = async () => 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ response: { id: { _serialized: 'outgoing-id' } } }), { status: 200 });
  try {
    await service.sendMessage('51900000000', 'Respuesta comercial de prueba');
    assert.ok(service.sentByBotIds.has('outgoing-id'));
    await service.handleIncomingMessage({ id: 'different-echo-id', from: '12345@lid', type: 'chat', body: 'Respuesta comercial de prueba' });
    assert.equal(service.processedMsgIds.has('different-echo-id'), false);
    assert.equal(service.userBuffers.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});


test('WhatsApp lists every matching product without unsolicited photos and sends a photo only when requested', () => {
  const items = ['Vestido Blanco', 'Vestido Blanco Damita', 'Vestido Blanco Hojitas'].flatMap((name, n) => [4, 6, 8].map(size => ({ productId: `p${n}`, variantId: `p${n}-${size}`, productName: name, image: `/media/p${n}.jpg`, size: String(size), priceCents: 12500, stockEstimated: true })));
  const result = { toolExecutionLog: [{ tool: 'search_catalog', result: { items } }] };
  const general = formatWhatsAppCatalog(result, 'Qué precios y tallas de vestidos blancos tienes?');
  assert.equal((general.replyText.match(/Tallas:/g) || []).length, 3);
  assert.equal(general.image, null);
  assert.ok(!general.replyText.includes('**'));
  const photo = formatWhatsAppCatalog(result, 'Mándame una fotito del vestido blanco damita');
  assert.equal(photo.image, '/media/p1.jpg');
  assert.equal((photo.replyText.match(/Tallas:/g) || []).length, 1);
  assert.match(photo.replyText, /Tallas: 4, 6, 8/);
});

test('WhatsApp image sending preserves LID and returns a readable provider error', async () => {
  const service = new WppConnectService();
  service.getToken = async () => 'test-token';
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.PUBLIC_MEDIA_BASE_URL;
  process.env.PUBLIC_MEDIA_BASE_URL = 'https://angibell.soryntel.com';
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
    const payload = JSON.parse(options.body);
    assert.equal(payload.isLid, true);
    assert.equal(payload.phone, '123456');
    assert.ok(payload.base64.startsWith('data:image/jpeg;base64,'));
    return new Response(JSON.stringify({ error: { message: 'prepRawMedia unavailable' } }), { status: 500 });
  };
  try {
    assert.deepEqual(await service.sendProductImage('123456', '/media/test.jpg', 'Prueba', true), { error: 'prepRawMedia unavailable' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.PUBLIC_MEDIA_BASE_URL;
    else process.env.PUBLIC_MEDIA_BASE_URL = previousBase;
  }
});


test('A selected size never hides the other available sizes in the catalog reply', () => {
  const result = { toolExecutionLog: [{ tool: 'search_catalog', result: { items: [{ productId: 'damita', variantId: 'size10', productName: 'Vestido Blanco Damita', image: '/media/damita.jpg', size: '10', availableSizes: ['4', '6', '8', '10', '12'], priceCents: 15000 }] } }] };
  const reply = formatWhatsAppCatalog(result, '¿Qué tallas tiene el vestido?');
  assert.match(reply.replyText, /Tallas: 4, 6, 8, 10, 12/);
  assert.equal(reply.image, null);
  assert.equal(formatWhatsAppCatalog(result, 'Muestra el vestido sin foto').image, null);
});

test('Catalog pages show five products and more advances without repetition', () => {
  const items = Array.from({ length: 12 }, (_, n) => ({ productId: `p${n}`, variantId: `v${n}`, productName: `Vestido ${String(n + 1).padStart(2, '0')}`, size: '10', availableSizes: ['4', '6', '10'], priceCents: 12500, image: `/media/p${n}.jpg` }));
  const page = (offset, text) => formatWhatsAppCatalog({ toolExecutionLog: [{ tool: 'search_catalog', result: { items, pageOffset: offset, catalogBrowsing: true } }] }, text);
  const first = page(0, 'Muéstrame el catálogo');
  const second = page(5, 'más');
  const last = page(10, 'más');
  assert.equal((first.replyText.match(/Tallas:/g) || []).length, 5);
  assert.match(first.replyText, /Escribe “más”/);
  assert.match(second.replyText, /Vestido 06/);
  assert.ok(!second.replyText.includes('Vestido 01'));
  assert.equal((last.replyText.match(/Tallas:/g) || []).length, 2);
  assert.ok(!last.replyText.includes('Escribe “más”'));
  assert.equal(first.image, null);
  assert.equal(second.image, null);
});
