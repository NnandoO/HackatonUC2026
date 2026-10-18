import { isMoreCatalogRequest } from './shopping-context.service.js';
import { chatService } from './chat.service.js';
import { db } from '../database/db.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = process.env.MEDIA_DIR || path.resolve(__dirname, '../../../../.state/media');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

const WPP_BASE_URL = process.env.WPPCONNECT_BASE_URL || 'http://127.0.0.1:21465';
const getSecretKey = () => process.env.WPPCONNECT_SECRET_KEY?.trim() || '';
const SESSION_NAME = 'angibell';
const getGroqApiKey = () => process.env.GROQ_API_KEY || '';

const DEBOUNCE_WAIT_MS = 3500;    // Ventana de silencio: espera 3.5s tras el último mensaje
const MAX_BUFFER_WAIT_MS = 10000; // Límite máximo de espera en ráfaga: 10 segundos

export function messageDeduplicationKey(msg) {
  const rawId = typeof msg.id === 'object' ? msg.id?._serialized : msg.id;
  if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
    return String(rawId);
  }

  // WPPConnect 2.10.42 may omit `id` from received-message Socket.IO events.
  // Keep processing those messages and build a stable key from the available fields.
  const sender = String(msg.from || msg.chatId || msg.sender?.id || '').trim();
  const eventTime = msg.clientReceivedTsMillis ?? msg.serverStoreTimeMicros ?? msg.timestamp ?? msg.t;
  const type = String(msg.type || '').trim();
  if (!sender || eventTime === undefined || eventTime === null || !type) return null;

  const body = String(msg.body || msg.content || msg.caption || '');
  const identity = [msg.session || '', sender, String(eventTime), type, body].join('\0');
  return `fallback:${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

export function formatWhatsAppCatalog(chatResult, text) {
  const tools = chatResult.toolExecutionLog || [];
  if (tools.some(entry => entry.tool !== 'search_catalog') || (!isMoreCatalogRequest(text) && !/foto|fotito|imagen|vestid|tallas?|precios?|cat[aá]logo|mu[eé]str/i.test(text))) return null;
  const groups = new Map();
  for (const entry of tools) for (const item of entry.result?.items || []) {
    if (!item.productId) continue;
    let group = groups.get(item.productId);
    if (!group) { group = { name: item.productName, image: item.image, items: new Map() }; groups.set(item.productId, group); }
    group.items.set(item.variantId, item);
  }
  if (!groups.size) return null;
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(text).split(/[^a-z0-9]+/).filter(word => word.length > 3);
  const score = group => normalize(group.name).split(' ').filter(word => words.includes(word)).length;
  const photoRequest = /foto|fotito|imagen/i.test(text) && !/\b(?:sin|no)\s+(?:me\s+)?(?:mandes?\s+|env[ií]es?\s+)?(?:fotos?|imagenes|imágenes)\b/i.test(text);
  const page = tools.find(entry => entry.result?.pageOffset !== undefined)?.result || {};
  const offset = photoRequest ? 0 : Math.max(0, Number(page.pageOffset) || 0);
  const ranked = [...groups.values()].sort((a, b) => page.catalogBrowsing ? a.name.localeCompare(b.name, 'es') : score(b) - score(a));
  const selected = photoRequest ? ranked.slice(0, 1) : ranked.slice(offset, offset + 5);
  if (!selected.length) return { replyText: 'Ya viste todos los modelos de esta búsqueda. ¿Cuál te interesa?', image: null };
  const hasMore = !photoRequest && offset + selected.length < ranked.length;
  let estimated = false;
  const lines = selected.map(group => {
    const items = [...group.items.values()];
    estimated ||= items.some(item => item.stockEstimated);
    const prices = items.map(item => Number(item.priceCents)).filter(price => price > 0);
    const price = prices.length ? `S/ ${(Math.min(...prices) / 100).toFixed(2)}` : 'Precio por confirmar';
    const sizes = [...new Set(items.flatMap(item => item.availableSizes?.length ? item.availableSizes : [item.size]))].sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
    return `*${group.name}* · ${price}\nTallas: ${sizes.join(', ')}.`;
  });
  const replyText = lines.join('\n\n') + (estimated ? '\n\nDisponibilidad estimada; la confirmamos al pedir.' : '') + (hasMore ? '\n\nEscribe “más” para ver otros modelos.' : photoRequest ? '' : selected.length > 1 ? '\n¿Cuál te gusta?' : '');
  return { replyText, image: photoRequest ? selected[0].image || null : null };
}

export class WppConnectService {
  token = null;
  ws = null;
  processedMsgIds = new Set();
  sentByBotIds = new Set();
  sentTextFingerprints = new Map();
  phoneQueues = new Map();
  userBuffers = new Map();

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async resolveAuthorizedAdminPhone(senderPhone, isLid = false) {
    const digits = String(senderPhone || '').replace(/[^0-9]/g, '');
    if (!digits) return null;

    const findActiveAdmin = async (phone) => db.queryOne(
      `SELECT phone FROM authorized_admins WHERE phone = $1 AND active = 1`,
      [phone]
    );

    const directPhone = `+${digits}`;
    const directAdmin = await findActiveAdmin(directPhone);
    if (directAdmin) return directAdmin.phone;
    if (!isLid) return null;

    // WhatsApp may expose an administrator as a LID instead of their phone.
    // Resolve that identifier with WPPConnect, then authorize only if the
    // resulting phone is already present in the explicit admin allowlist.
    const token = await this.getToken();
    if (!token) return null;
    try {
      const baseUrl = WPP_BASE_URL.replace(/\/$/, '');
      const lid = encodeURIComponent(`${digits}@lid`);
      const response = await fetch(`${baseUrl}/api/${SESSION_NAME}/contact/pn-lid/${lid}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const contact = await response.json();
      const resolvedDigits = String(contact?.phoneNumber?.id || '')
        .replace(/[^0-9]/g, '');
      if (!resolvedDigits || contact?.phoneNumber?.server !== 'c.us') return null;
      const resolvedAdmin = await findActiveAdmin(`+${resolvedDigits}`);
      return resolvedAdmin?.phone || null;
    } catch {
      // Fail closed: a failed LID lookup must never grant administrator access.
      return null;
    }
  }

  async isAuthorizedAdmin(senderPhone, isLid = false) {
    return Boolean(await this.resolveAuthorizedAdminPhone(senderPhone, isLid));
  }

  storeAdminImage(mediaData, declaredMimeType = '') {
    if (typeof mediaData !== 'string' || !mediaData.trim()) {
      throw new Error('No se pudo descargar la imagen.');
    }

    const dataUriMatch = mediaData.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
    const mimeType = (dataUriMatch?.[1] || declaredMimeType || '').toLowerCase().split(';')[0];
    const extension = IMAGE_EXTENSIONS.get(mimeType);
    if (!extension) throw new Error('Formato no permitido. Usa JPG, PNG o WebP.');

    const base64 = (dataUriMatch?.[2] || mediaData).replace(/\s/g, '');
    const imageBuffer = Buffer.from(base64, 'base64');
    if (imageBuffer.length < 64) throw new Error('La imagen está vacía o dañada.');
    if (imageBuffer.length > MAX_IMAGE_BYTES) throw new Error('La imagen supera el máximo de 8 MB.');

    fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o750 });
    const filename = `${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), imageBuffer, { mode: 0o640 });

    return {
      analysisUrl: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
      storedUrl: `/media/${filename}`
    };
  }

  async getToken() {
    if (this.token) return this.token;
    const secretKey = getSecretKey();
    if (!secretKey) return null;
    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/${encodeURIComponent(secretKey)}/generate-token`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.token) {
        this.token = data.token;
        return this.token;
      }
    } catch (err) {
      console.error('Error obteniendo token WppConnect:', err);
    }
    return null;
  }

  async getSessionStatus() {
    const token = await this.getToken();
    if (!token) return { status: 'ERROR', message: 'No se pudo obtener token de autenticación' };

    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/status-session`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { status: 'DISCONNECTED', message: err.message };
    }
  }

  async startSession() {
    const token = await this.getToken();
    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/start-session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ waitQrCode: true })
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { status: 'ERROR', message: err.message };
    }
  }

  async getQrCode() {
    const statusData = await this.getSessionStatus();
    if (statusData.status === 'CONNECTED' || statusData.status === 'inChat') {
      return { connected: true, status: 'CONNECTED' };
    }
    if (statusData.qrcode) {
      return { connected: false, qrcode: statusData.qrcode };
    }

    const startData = await this.startSession();
    if (startData.status === 'CONNECTED') {
      return { connected: true, status: 'CONNECTED' };
    }
    if (startData.qrcode) {
      return { connected: false, qrcode: startData.qrcode };
    }

    return { connected: false, qrcode: null, message: 'Inicializando WhatsApp Web... reintenta en 3 segundos' };
  }

  async setOnlinePresence(online = true) {
    const token = await this.getToken();
    if (!token) return;
    try {
      await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/set-online-presence`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ presence: Boolean(online) })
      });
    } catch (err) {
      // Ignorar fallas silenciosas en presencia
    }
  }

  async sendSeen(phone) {
    const token = await this.getToken();
    if (!token) return;
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    try {
      await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/send-seen`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone: cleanPhone })
      });
    } catch (err) {
      // Ignorar si el número es self-chat o no admite vistos
    }
  }

  async setTyping(phone, value = true) {
    const token = await this.getToken();
    if (!token) return;
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    try {
      await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/typing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: cleanPhone,
          value: Boolean(value)
        })
      });
    } catch (err) {
      // Ignorar si el número es self-chat
    }
  }

  async sendMessage(phone, message, isLid = false) {
    const token = await this.getToken();
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const fingerprint = crypto.createHash('sha256').update(String(message).trim()).digest('hex');
    this.sentTextFingerprints.set(fingerprint, Date.now());
    for (const [key, sentAt] of this.sentTextFingerprints) {
      if (Date.now() - sentAt > 600000) this.sentTextFingerprints.delete(key);
    }
    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/send-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: cleanPhone,
          isLid: Boolean(isLid),
          message
        })
      });
      const data = await res.json();
      if (data.response) {
        const msgs = Array.isArray(data.response) ? data.response : [data.response];
        for (const m of msgs) {
          if (m?.id) {
            const sentId = messageDeduplicationKey(m);
            if (sentId) { this.sentByBotIds.add(sentId); this.processedMsgIds.add(sentId); }
          }
        }
      }
      return data;
    } catch (err) {
      console.error(`Error enviando mensaje WhatsApp a ${phone}:`, err);
      return { error: err.message };
    }
  }

  async sendProductImage(phone, imagePath, caption = '', isLid = false) {
    // Catalog images are stored under /media. Restrict downloads to our configured
    // public HTTPS origin so a catalog value cannot make the API fetch arbitrary URLs.
    const publicBase = String(process.env.PUBLIC_MEDIA_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBase.startsWith('https://') || typeof imagePath !== 'string' || !imagePath.startsWith('/media/')) {
      console.warn('[WPP] Imagen de producto omitida: falta origen público HTTPS o ruta /media válida.');
      return { error: 'PUBLIC_MEDIA_URL_NOT_CONFIGURED' };
    }

    try {
      const imageUrl = new URL(imagePath, `${publicBase}/`);
      if (imageUrl.origin !== new URL(publicBase).origin || !imageUrl.pathname.startsWith('/media/')) {
        return { error: 'INVALID_PRODUCT_IMAGE_URL' };
      }
      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
      if (!imageResponse.ok) return { error: `IMAGE_FETCH_${imageResponse.status}` };
      const contentType = (imageResponse.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      if (!extensions[contentType]) return { error: 'UNSUPPORTED_PRODUCT_IMAGE_TYPE' };
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) return { error: 'PRODUCT_IMAGE_SIZE_INVALID' };

      const token = await this.getToken();
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/send-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          isLid: Boolean(isLid),
          filename: `producto.${extensions[contentType]}`,
          caption: String(caption || '').slice(0, 900),
          base64: `data:${contentType};base64,${bytes.toString('base64')}`
        })
      });
      const data = await res.json();
      if (!res.ok || data.error || data.status === 'error') {
        const error = data.error?.message || data.error?.error || data.message || (typeof data.error === 'string' ? data.error : `WPP_HTTP_${res.status}`);
        return { error: String(error) };
      }
      const fingerprint = crypto.createHash('sha256').update(String(caption || '').trim()).digest('hex');
      this.sentTextFingerprints.set(fingerprint, Date.now());
      if (data.response) {
        const messages = Array.isArray(data.response) ? data.response : [data.response];
        for (const message of messages) {
          if (message?.id) {
            const sentId = messageDeduplicationKey(message);
            if (sentId) { this.sentByBotIds.add(sentId); this.processedMsgIds.add(sentId); }
          }
        }
      }
      return data;
    } catch (err) {
      console.error(`[WPP] Error enviando imagen de producto a ${phone}:`, err.message);
      return { error: err.message };
    }
  }

  async downloadMedia(msgId) {
    const token = await this.getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/download-media`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messageId: msgId })
      });
      const data = await res.json();
      if (data) {
        if (typeof data === 'string') return data;
        if (data.base64) return data.base64;
        if (data.response) return data.response;
      }
    } catch (err) {
      console.error(`Error descargando media para ${msgId}:`, err.message);
    }
    return null;
  }

  async transcribeAudio(mediaData) {
    try {
      if (!mediaData) return null;
      let base64 = mediaData;
      if (typeof mediaData === 'string' && mediaData.includes(',')) {
        base64 = mediaData.split(',')[1];
      }
      const audioBuffer = Buffer.from(base64, 'base64');
      if (audioBuffer.length < 50) return null;

      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'es');
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getGroqApiKey()}`
        },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('Error de transcripción Groq Whisper:', res.status, errText);
        return null;
      }

      const data = await res.json();
      return data.text ? data.text.trim() : null;
    } catch (err) {
      console.error('Error en proceso de transcripción de audio:', err.message);
      return null;
    }
  }

  pushToBuffer(senderPhone, text, isSelf, isLid = false, imageUrls = [], storedImageUrls = []) {
    // 1. Enviar 'visto' de inmediato para acuse de recibo natural
    this.sendSeen(senderPhone);

    const now = Date.now();
    let entry = this.userBuffers.get(senderPhone);

    if (!entry) {
      console.log(`📥 [Buffer] Nuevo hilo de mensajes para +${senderPhone} (isLid: ${isLid}). Ventana de silencio iniciada (${DEBOUNCE_WAIT_MS / 1000}s)...`);
      entry = {
        senderPhone,
        isSelf,
        isLid: Boolean(isLid),
        messages: [text],
        imageUrls: [...imageUrls],
        storedImageUrls: [...storedImageUrls],
        firstReceivedAt: now,
        timer: null
      };
      entry.timer = setTimeout(() => this.flushBuffer(senderPhone), DEBOUNCE_WAIT_MS);
      this.userBuffers.set(senderPhone, entry);
    } else {
      entry.messages.push(text);
      entry.imageUrls.push(...imageUrls);
      entry.storedImageUrls.push(...storedImageUrls);
      if (isLid) entry.isLid = true;
      const elapsed = now - entry.firstReceivedAt;
      console.log(`📥 [Buffer] Mensaje acumulado de +${senderPhone} (${entry.messages.length} mensajes). Tiempo en ráfaga: ${elapsed}ms`);

      if (elapsed < MAX_BUFFER_WAIT_MS) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.flushBuffer(senderPhone), DEBOUNCE_WAIT_MS);
      } else {
        console.log(`⏳ [Buffer] Límite de ráfaga alcanzado (${MAX_BUFFER_WAIT_MS / 1000}s) para +${senderPhone}. Procesando en el siguiente tick.`);
      }
    }
  }

  async flushBuffer(senderPhone) {
    const entry = this.userBuffers.get(senderPhone);
    if (!entry) return;
    this.userBuffers.delete(senderPhone);

    const combinedText = entry.messages.join('\n');
    console.log(`\n======================================================`);
    console.log(`🚀 [Buffer Flush] Ráfaga completa lista para responder a +${senderPhone} (isLid: ${entry.isLid}):`);
    console.log(`• Total mensajes unificados: ${entry.messages.length}`);
    console.log(`• Contenido consolidado:\n${combinedText}`);
    console.log(`======================================================`);

    // Procesar en la cola secuencial por número con Anti-Ban
    const prevQueue = this.phoneQueues.get(senderPhone) || Promise.resolve();
    const currentTask = prevQueue.then(async () => {
      await this.processMessageWithHumanizer(
        senderPhone,
        combinedText,
        entry.isSelf,
        entry.isLid,
        entry.imageUrls,
        entry.storedImageUrls
      );
    }).catch(err => {
      console.error(`Error procesando ráfaga unificada de +${senderPhone}:`, err);
    });
    this.phoneQueues.set(senderPhone, currentTask);
  }

  async handleIncomingMessage(msg) {
    if (!msg) return;
    const incomingText = String(msg.body || msg.content || '').trim();
    if (incomingText) {
      const fingerprint = crypto.createHash('sha256').update(incomingText).digest('hex');
      const sentAt = this.sentTextFingerprints.get(fingerprint);
      if (sentAt && Date.now() - sentAt < 600000) return;
    }

    const msgId = messageDeduplicationKey(msg);
    if (!msgId || this.processedMsgIds.has(msgId) || this.sentByBotIds.has(msgId)) {
      return;
    }
    this.processedMsgIds.add(msgId);
    if (this.processedMsgIds.size > 2000) this.processedMsgIds.clear();

    // Ignorar mensajes de grupos (@g.us)
    if (msg.isGroupMsg || (msg.from && msg.from.includes('@g.us')) || (msg.chatId && msg.chatId.includes('@g.us'))) {
      return;
    }

    const senderPhone = (msg.from || '').replace('@c.us', '').replace('@lid', '');
    const isLid = Boolean((msg.from && msg.from.includes('@lid')) || (msg.chatId && msg.chatId.includes('@lid')));

    // Si el mensaje es saliente hacia otra persona (no auto-chat), ignorar
    const isSelf = msg.to === msg.from || (msg.chatId && (msg.chatId.includes('51995992450') || msg.chatId.includes('152875737075771')));
    if (msg.fromMe && !isSelf) {
      return;
    }

    const isImage = msg.type === 'image' || (msg.mimetype && msg.mimetype.startsWith('image/'));
    const isUnsupportedVisual = msg.type === 'video' || msg.type === 'sticker' ||
      (msg.mimetype && msg.mimetype.startsWith('video/'));
    if (isUnsupportedVisual) {
      console.log(`🖼️ [WppConnect] Video/sticker de +${senderPhone} omitido.`);
      return;
    }

    if (isImage) {
      if (!(await this.isAuthorizedAdmin(senderPhone, isLid))) {
        console.log(`🔒 [WppConnect] Imagen de +${senderPhone} ignorada: no es administrador.`);
        return;
      }

      try {
        const mediaData = (typeof msg.body === 'string' && msg.body.startsWith('data:image/'))
          ? msg.body
          : await this.downloadMedia(msgId);
        const stored = this.storeAdminImage(mediaData, msg.mimetype);
        const caption = String(msg.caption || (msg.body?.startsWith?.('data:image/') ? '' : msg.body) || '').trim();
        const text = caption || '[Imagen de producto recibida: analiza la prenda y prepara su registro.]';
        console.log(`🖼️ [WppConnect] Imagen administrativa validada y almacenada como ${path.basename(stored.storedUrl)}.`);
        this.pushToBuffer(senderPhone, text, isSelf, isLid, [stored.analysisUrl], [stored.storedUrl]);
      } catch (err) {
        console.error(`Error procesando imagen administrativa de +${senderPhone}:`, err.message);
        await this.sendMessage(senderPhone, `No pude procesar la foto: ${err.message}`, isLid);
      }
      return;
    }

    // Detección de notas de voz / audio
    const isAudio = msg.type === 'ptt' || msg.type === 'audio' || (msg.mimetype && msg.mimetype.startsWith('audio'));

    let text = '';
    if (isAudio) {
      console.log(`🎙️ [Audio WhatsApp] Nota de voz detectada de +${senderPhone} (msgId: ${msgId}, isLid: ${isLid}). Transcribiendo...`);
      let mediaData = (msg.body && typeof msg.body === 'string' && msg.body.startsWith('data:audio')) ? msg.body : await this.downloadMedia(msgId);
      const transcription = await this.transcribeAudio(mediaData);

      if (transcription) {
        console.log(`🎙️ [Audio WhatsApp Transcrito]: "${transcription}"`);
        text = `[Nota de voz]: "${transcription}"`;
      } else {
        console.log(`🎙️ [Audio WhatsApp]: Inaudible o error en descarga.`);
        text = `[Nota de voz inaudible o en silencio]`;
      }
    } else {
      text = (msg.body || '').trim();
    }

    if (!text) return;

    // Agregar a la cola de buffer / debouncer (evita responder mensaje por mensaje)
    this.pushToBuffer(senderPhone, text, isSelf, isLid);
  }

  async processMessageWithHumanizer(senderPhone, text, isSelf, isLid = false, imageUrls = [], storedImageUrls = []) {
    // 1. Anti-Ban: Pausa de lectura natural humana (1.2s - 2.1s)
    const readPauseMs = 1200 + Math.floor(Math.random() * 900);
    console.log(`⏱️ [Anti-Ban] Pausa de lectura humana: ${readPauseMs}ms...`);
    await this.sleep(readPauseMs);

    // 2. Anti-Ban: Reportar presencia online y visto
    await this.setOnlinePresence(true);
    await this.sendSeen(senderPhone);

    // 3. Detectar rol y usuario
    const adminPhone = await this.resolveAuthorizedAdminPhone(senderPhone, isLid);
    const formattedPhone = adminPhone || `+${senderPhone}`;
    const isAdmin = Boolean(adminPhone);
    const role = isAdmin ? 'admin' : 'customer';

    // Buscar o crear actor y conversación
    let actor = await db.queryOne(`SELECT id, role FROM actors WHERE phone = $1`, [formattedPhone]);
    const nowIso = new Date().toISOString();
    if (!actor) {
      const actorId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO actors (id, role, phone, created_at) VALUES ($1, $2, $3, $4)`,
        [actorId, role, formattedPhone, nowIso]
      );
      actor = { id: actorId, role };
    }

    if (actor.role !== role) {
      await db.execute('UPDATE actors SET role = $1 WHERE id = $2', [role, actor.id]);
    }

    let conv = await db.queryOne(`SELECT id FROM conversations WHERE actor_id = $1 AND channel = 'whatsapp'`, [actor.id]);
    if (!conv) {
      const convId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO conversations (id, actor_id, channel, created_at) VALUES ($1, $2, 'whatsapp', $3)`,
        [convId, actor.id, nowIso]
      );
      conv = { id: convId };
    }

    await db.execute("UPDATE conversations SET shopping_context=(shopping_context::jsonb || jsonb_build_object('whatsappSender',$1::text,'whatsappIsLid',$2::boolean))::text WHERE id=$3", [senderPhone, isLid, conv.id]);

    // 4. Procesar con el Agente de OpenRouter (análisis unificado de la ráfaga)
    console.log(`🤖 [Anti-Ban] Consultando OpenRouter Agent para ráfaga unificada...`);
    const chatResult = await chatService.postMessage(conv.id, actor.id, { text, imageUrls, storedImageUrls }, role);
    const catalogReply = !isAdmin ? formatWhatsAppCatalog(chatResult, text) : null;
    const replyText = catalogReply?.replyText || chatResult.message.text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n[ \t]*-[ \t]*(?=\n|$)/g, '').replace(/\*\*/g, '*').trim();
    if (catalogReply) await db.execute('UPDATE messages SET text = $1 WHERE id = $2', [replyText, chatResult.message.id]);

    // 5. Anti-Ban: Simular indicador "Escribiendo..." proporcional a la respuesta
    const typingMs = Math.min(6000, Math.max(2400, Math.floor(replyText.length * 25 + (Math.random() * 800 - 400))));
    console.log(`✍️ [Anti-Ban] Indicador "Escribiendo..." activo por ${typingMs}ms (${replyText.length} caracteres)...`);

    await this.setTyping(senderPhone, true);
    await this.sleep(typingMs);
    await this.setTyping(senderPhone, false);

    // 6. Anti-Ban: Micropausa de entrega (jitter de 300-600ms)
    const jitterMs = 300 + Math.floor(Math.random() * 300);
    await this.sleep(jitterMs);

    // 7. Envío del mensaje consolidado
    console.log(`[WHATSAPP REAL ENVIANDO RESPUESTA UNIFICADA A +${senderPhone} (isLid=${isLid})]:\n"${replyText.slice(0, 120)}..."\n`);
    if (catalogReply?.image?.startsWith('/media/')) {
      const imageResult = await this.sendProductImage(senderPhone, catalogReply.image, replyText, isLid);
      if (!imageResult?.error) return;
      console.warn(`[WPP] Foto no enviada: ${imageResult.error}`);
      await this.sendMessage(senderPhone, `${replyText}\n\nNo pude adjuntar la foto en este momento.`, isLid);
      return;
    }
    await this.sendMessage(senderPhone, replyText, isLid);
  }

  connectSocketListener() {
    try {
      const baseUrl = new URL(WPP_BASE_URL);
      baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      baseUrl.pathname = '/socket.io/';
      baseUrl.search = new URLSearchParams({ EIO: '4', transport: 'websocket' }).toString();
      const wsUrl = baseUrl.toString();
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('✅ [WppConnect Socket.IO] Conexión en tiempo real activa (latencia <50ms)');
      };

      this.ws.onmessage = async (event) => {
        const raw = String(event.data || '');

        // 1. Handshake inicial
        if (raw.startsWith('0')) {
          this.ws.send('40'); // Unirse al namespace default
          return;
        }

        // 2. Ping-pong de Socket.io
        if (raw === '2') {
          this.ws.send('3'); // Responder pong
          return;
        }

        // 3. Evento recibido
        if (raw.startsWith('42')) {
          try {
            const parsed = JSON.parse(raw.slice(2));
            const eventName = parsed[0];
            const eventData = parsed[1];

            if (eventName === 'received-message' && eventData?.response) {
              await this.handleIncomingMessage(eventData.response);
            } else if (eventName === 'message' && eventData) {
              await this.handleIncomingMessage(eventData);
            }
          } catch (e) {
            // Ignorar paquetes no JSON
          }
        }
      };

      this.ws.onclose = () => {
        console.log('⚠️ [WppConnect Socket.IO] Desconectado. Reconectando en 3s...');
        setTimeout(() => this.connectSocketListener(), 3000);
      };

      this.ws.onerror = (err) => {
        console.error('Error en WppConnect WebSocket:', err.message);
      };

    } catch (err) {
      console.error('Fallo iniciando WppConnect WebSocket:', err);
      setTimeout(() => this.connectSocketListener(), 3000);
    }
  }

  startPolling() {
    this.connectSocketListener();
  }
}

export const wppConnectService = new WppConnectService();
