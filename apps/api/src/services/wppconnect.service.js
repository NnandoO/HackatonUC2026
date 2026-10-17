import { chatService } from './chat.service.js';
import { db } from '../database/db.js';
import crypto from 'node:crypto';

const WPP_BASE_URL = process.env.WPPCONNECT_BASE_URL || 'http://127.0.0.1:21465';
const SECRET_KEY = process.env.WPPCONNECT_SECRET_KEY || 'f3d03d5856e6ab6b5a200ec5448bf7ba9a354870fafc74fc';
const SESSION_NAME = 'angibell';

export class WppConnectService {
  token = null;
  ws = null;
  processedMsgIds = new Set();
  sentByBotIds = new Set();

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

  async sendMessage(phone, message) {
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

  async handleIncomingMessage(msg) {
    if (!msg || !msg.body) return;

    const msgId = typeof msg.id === 'object' ? msg.id._serialized : msg.id;
    if (!msgId || this.processedMsgIds.has(msgId) || this.sentByBotIds.has(msgId)) {
      return;
    }
    this.processedMsgIds.add(msgId);
    if (this.processedMsgIds.size > 2000) this.processedMsgIds.clear();

    const senderPhone = (msg.from || '').replace('@c.us', '').replace('@lid', '');
    const text = msg.body.trim();

    // Si el mensaje es saliente hacia otra persona (no auto-chat), ignorar
    const isSelf = msg.to === msg.from || (msg.chatId && (msg.chatId.includes('51995992450') || msg.chatId.includes('152875737075771')));
    if (msg.fromMe && !isSelf) {
      return;
    }

    console.log(`\n======================================================`);
    console.log(`[WHATSAPP REAL RECIBIDO]`);
    console.log(`• Remitente: +${senderPhone}`);
    console.log(`• Mensaje: "${text}"`);
    console.log(`======================================================`);

    // Detectar rol
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

    // Procesar con el Agente de OpenRouter
    const chatResult = await chatService.postMessage(conv.id, actor.id, { text, imageUrls: [] }, role);
    const replyText = chatResult.message.text;

    console.log(`[WHATSAPP REAL ENVIANDO RESPUESTA A +${senderPhone}]:\n"${replyText.slice(0, 100)}..."\n`);
    await this.sendMessage(senderPhone, replyText);
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
    // Iniciar el listener de Socket.IO en tiempo real (instantáneo)
    this.connectSocketListener();
  }
}

export const wppConnectService = new WppConnectService();
