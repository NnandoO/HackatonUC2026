import { chatService } from './chat.service.js';
import { db } from '../database/db.js';
import crypto from 'node:crypto';

const WPP_BASE_URL = process.env.WPPCONNECT_BASE_URL || 'http://127.0.0.1:21465';
const SECRET_KEY = process.env.WPPCONNECT_SECRET_KEY || 'f3d03d5856e6ab6b5a200ec5448bf7ba9a354870fafc74fc';
const SESSION_NAME = 'angibell';
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'REDACTED_GROQ_KEY';

const DEBOUNCE_WAIT_MS = 3500;    // Ventana de silencio: espera 3.5s tras el último mensaje
const MAX_BUFFER_WAIT_MS = 10000; // Límite máximo de espera en ráfaga: 10 segundos

export class WppConnectService {
  token = null;
  ws = null;
  processedMsgIds = new Set();
  sentByBotIds = new Set();
  phoneQueues = new Map();
  userBuffers = new Map();

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getToken() {
    if (this.token) return this.token;
    try {
      const res = await fetch(`${WPP_BASE_URL}/api/${SESSION_NAME}/${SECRET_KEY}/generate-token`, {
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
            this.sentByBotIds.add(m.id);
            this.processedMsgIds.add(m.id);
          }
        }
      }
      return data;
    } catch (err) {
      console.error(`Error enviando mensaje WhatsApp a ${phone}:`, err);
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
          'Authorization': `Bearer ${GROQ_API_KEY}`
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

  pushToBuffer(senderPhone, text, isSelf, isLid = false) {
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
        firstReceivedAt: now,
        timer: null
      };
      entry.timer = setTimeout(() => this.flushBuffer(senderPhone), DEBOUNCE_WAIT_MS);
      this.userBuffers.set(senderPhone, entry);
    } else {
      entry.messages.push(text);
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
      await this.processMessageWithHumanizer(senderPhone, combinedText, entry.isSelf, entry.isLid);
    }).catch(err => {
      console.error(`Error procesando ráfaga unificada de +${senderPhone}:`, err);
    });
    this.phoneQueues.set(senderPhone, currentTask);
  }

  async handleIncomingMessage(msg) {
    if (!msg) return;

    const msgId = typeof msg.id === 'object' ? msg.id._serialized : msg.id;
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

    // Omitir imágenes y videos según requerimiento expreso ("imágenes no")
    const isImageOrVideo = msg.type === 'image' || msg.type === 'video' || msg.type === 'sticker' ||
      (msg.mimetype && (msg.mimetype.startsWith('image') || msg.mimetype.startsWith('video')));
    if (isImageOrVideo) {
      console.log(`🖼️ [WppConnect] Imagen/video recibido de +${senderPhone} omitido (soporte visual no activo).`);
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

  async processMessageWithHumanizer(senderPhone, text, isSelf, isLid = false) {
    // 1. Anti-Ban: Pausa de lectura natural humana (1.2s - 2.1s)
    const readPauseMs = 1200 + Math.floor(Math.random() * 900);
    console.log(`⏱️ [Anti-Ban] Pausa de lectura humana: ${readPauseMs}ms...`);
    await this.sleep(readPauseMs);

    // 2. Anti-Ban: Reportar presencia online y visto
    await this.setOnlinePresence(true);
    await this.sendSeen(senderPhone);

    // 3. Detectar rol y usuario
    const formattedPhone = `+${senderPhone}`;
    const isAdmin = formattedPhone === '+51995992450' || formattedPhone === '+51999888777' || Boolean(db.queryOne(`SELECT * FROM authorized_admins WHERE phone = ? AND active = 1`, [formattedPhone]));
    const role = isAdmin ? 'admin' : 'customer';

    // Buscar o crear actor y conversación
    let actor = db.queryOne(`SELECT id, role FROM actors WHERE phone = ?`, [formattedPhone]);
    const nowIso = new Date().toISOString();
    if (!actor) {
      const actorId = crypto.randomUUID();
      db.execute(`INSERT INTO actors (id, role, phone, created_at) VALUES (?, ?, ?, ?)`, [actorId, role, formattedPhone, nowIso]);
      actor = { id: actorId, role };
    }

    let conv = db.queryOne(`SELECT id FROM conversations WHERE actor_id = ? AND channel = 'whatsapp'`, [actor.id]);
    if (!conv) {
      const convId = crypto.randomUUID();
      db.execute(`INSERT INTO conversations (id, actor_id, channel, created_at) VALUES (?, ?, 'whatsapp', ?)`, [convId, actor.id, nowIso]);
      conv = { id: convId };
    }

    // 4. Procesar con el Agente de OpenRouter (análisis unificado de la ráfaga)
    console.log(`🤖 [Anti-Ban] Consultando OpenRouter Agent para ráfaga unificada...`);
    const chatResult = await chatService.postMessage(conv.id, actor.id, { text, imageUrls: [] }, role);
    const replyText = chatResult.message.text;

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
    await this.sendMessage(senderPhone, replyText, isLid);
  }

  connectSocketListener() {
    const wsUrl = 'ws://127.0.0.1:21465/socket.io/?EIO=4&transport=websocket';
    try {
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
