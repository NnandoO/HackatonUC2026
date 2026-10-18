import { resolveDeliveryDate } from './delivery-date.js';
import { db } from '../database/db.js';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isMoreCatalogRequest(text) {
  const input = normalize(text).replace(/^nota de voz\s*/, '');
  return /^(?:(?:muestrame|muestra|ver|dame|ensename) )?(?:mas|mas modelos|mas opciones|siguientes|otros 5|otras opciones)$/.test(input);
}

export function extractCatalogSize(text) {
  return String(text || '').match(/\btallas?\b\s*[:=]?\s*(\d{1,2}|xxl|xl|xs|s|m|l)\b/i)?.[1]?.toUpperCase();
}

export function updateShoppingContext(previous, text, products, referenceDate = new Date()) {
  const state = { ...previous };
  const input = ` ${normalize(text)} `;
  const priceMatch = String(text).match(/(\d+(?:[.,]\d{1,2})?)\s*soles\b|s\/\.?\s*(\d+(?:[.,]\d{1,2})?)/i);
  const price = priceMatch ? Math.round(Number((priceMatch[1] || priceMatch[2]).replace(',', '.')) * 100) : null;
  const current = products.find(product => product.id === state.productId);
  const named = products.filter(product => input.includes(` ${normalize(product.name)} `)).sort((a, b) => normalize(b.name).length - normalize(a.name).length);
  let chosen = named[0];
  if (price !== null) {
    const priced = products.filter(product => Number(product.price_cents) === price && normalize(product.name).split(' ').filter(word => word.length > 3).some(word => input.includes(` ${word} `)));
    if (current && Number(current.price_cents) === price) chosen = current;
    else if (priced.length === 1) chosen = priced[0];
  } else if (current && chosen && chosen.id !== current.id && normalize(current.name).includes(normalize(chosen.name))) {
    // "ese vestido blanco" must not switch Damita to the cheaper generic model.
    chosen = current;
  }
  if (chosen) {
    if (state.productId !== chosen.id) { delete state.size; delete state.quantity; }
    state.productId = chosen.id;
    state.productName = chosen.name;
  }
  const size = extractCatalogSize(text);
  if (size) state.size = size;
  const quantity = String(text).match(/\b(\d+)\s*(?:piezas|unidades|vestidos)\b/i);
  if (quantity) state.quantity = Number(quantity[1]);
  const requestedDate = resolveDeliveryDate(text, referenceDate);
  if (requestedDate) state.requestedDate = requestedDate;
  return state;
}

export async function resolveShoppingContext(conversationId, text) {
  const conversation = await db.queryOne('SELECT shopping_context FROM conversations WHERE id = $1', [conversationId]);
  let state = {};
  try { state = JSON.parse(conversation?.shopping_context || '{}'); } catch { /* Recover empty state. */ }
  const products = await db.query(`SELECT id,name,price_cents FROM products WHERE status = 'published' AND jsonb_array_length(image_urls::jsonb) > 0`);
  if (!state.productId && conversation) {
    const history = await db.query(`SELECT text,created_at FROM messages WHERE conversation_id = $1 AND role = 'customer' ORDER BY created_at DESC LIMIT 40`, [conversationId]);
    for (const message of history.reverse()) state = updateShoppingContext(state, message.text, products, new Date(message.created_at));
  }
  state = updateShoppingContext(state, text, products);
  if (state.productId && !products.some(product => product.id === state.productId)) state = {};
  const more = isMoreCatalogRequest(text);
  const browsing = more || /otros?\b|otras?\b|mas opciones|catalogo|todos? (?:los )?(?:productos|vestidos|modelos)|\b(?:que|cuales) (?:vestidos|modelos|prendas)\b/i.test(normalize(text));
  if (more) state.catalogOffset = (Number(state.catalogOffset) || 0) + 5;
  else {
    state.catalogOffset = 0;
    if (browsing) {
      state.catalogQuery = String(text).match(/\b(blanc[oa]s?|verdes?|roj[oa]s?|azul(?:es)?|rosad[oa]s?|rosas?|negr[oa]s?|lilas?)\b/i)?.[1] || '';
      state.catalogSize = extractCatalogSize(text) || null;
    }
  }
  if (conversation) await db.execute('UPDATE conversations SET shopping_context = $1 WHERE id = $2', [JSON.stringify(state), conversationId]);
  return { ...state, catalogBrowsing: browsing, lookupProductId: browsing ? null : state.productId || null };
}
