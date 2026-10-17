import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { catalogService } from './catalog.service.js';
import { proposalService } from './proposal.service.js';
import { orderService } from './order.service.js';
import { paymentService } from './payment.service.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Busca prendas disponibles en el catálogo de Angibell por término, talla o precio.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Término de búsqueda, ej: vestido, fiesta, princesa' },
          size: { type: 'string', description: 'Talla de niña, ej: 4, 6, 8, 10' },
          maxPriceCents: { type: 'number', description: 'Precio máximo en céntimos (ej: 120 soles = 12000)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_product',
      description: 'Prepara una propuesta de registro de nuevo producto para que la dueña lo confirme (Modo Admin).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre comercial del producto' },
          description: { type: 'string', description: 'Descripción detallada de la prenda' },
          imageUrls: { type: 'array', items: { type: 'string' }, description: 'URLs de fotos del producto' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'Código SKU opcional' },
                size: { type: 'string', description: 'Talla (ej: 4, 6, 8, 10, 12)' },
                color: { type: 'string', description: 'Color (ej: Palo Rosa, Blanco Perla)' },
                priceCents: { type: 'number', description: 'Precio unitario en céntimos de Sol' },
                stock: { type: 'number', description: 'Cantidad disponible para venta' }
              },
              required: ['size', 'color', 'priceCents', 'stock']
            }
          }
        },
        required: ['name', 'variants']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_proposal',
      description: 'Confirma una propuesta pendiente para publicar el producto o cambio en la tienda y generar el borrador de redes sociales.',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'ID de la propuesta a confirmar. Si se omite, se usa la última pendiente.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Genera un pedido formal para el cliente con reserva de stock por 15 minutos y link de pago Culqi.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                variantId: { type: 'string', description: 'ID de la variante seleccionada' },
                quantity: { type: 'number', description: 'Cantidad a comprar' }
              },
              required: ['variantId', 'quantity']
            }
          }
        },
        required: ['items']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_human_handoff',
      description: 'Deriva la conversación a atención humana/diseñadora (ej: confección a medida, diseño personalizado o quejas).',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Motivo por el cual se requiere atención humana' }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_social_draft',
      description: 'Crea o actualiza el borrador de publicación para Facebook e Instagram de un producto.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'ID del producto' },
          facebookCopy: { type: 'string', description: 'Texto del post para Facebook con hashtags y llamado a la acción' },
          instagramCopy: { type: 'string', description: 'Texto del post para Instagram' }
        },
        required: ['productId', 'facebookCopy']
      }
    }
  }
];

export class AgentService {
  /**
   * Ejecuta una herramienta contra los servicios del backend
   */
  async executeTool(name, args, context) {
    const { actorId, conversationId, userRole } = context;

    switch (name) {
      case 'search_catalog': {
        const query = args.query ? args.query.toLowerCase() : '';
        const size = args.size ? String(args.size).trim() : null;
        let sql = `
          SELECT p.id as product_id, p.name, p.description, p.image_urls,
                 v.id as variant_id, v.sku, v.size, v.color, v.price_cents,
                 v.stock_on_hand, v.stock_reserved
          FROM products p
          JOIN variants v ON v.product_id = p.id
          WHERE p.status = 'published'
        `;
        const params = [];
        if (query) {
          sql += ` AND (LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(v.color) LIKE ?)`;
          params.push(`%${query}%`, `%${query}%`, `%${query}%`);
        }
        if (size) {
          sql += ` AND v.size = ?`;
          params.push(size);
        }
        const rows = db.query(sql, params);
        const results = rows.map(r => ({
          productId: r.product_id,
          productName: r.name,
          variantId: r.variant_id,
          sku: r.sku,
          size: r.size,
          color: r.color,
          priceSoles: (r.price_cents / 100).toFixed(2),
          priceCents: r.price_cents,
          availableStock: Math.max(0, r.stock_on_hand - r.stock_reserved),
          image: JSON.parse(r.image_urls || '[]')[0] || null
        }));
        return { count: results.length, items: results };
      }

      case 'propose_product': {
        if (userRole !== 'admin') {
          return { error: 'Acceso denegado: solo la dueña administradora puede registrar productos.' };
        }
        const variantsData = (args.variants || []).map((v, i) => ({
          sku: v.sku || `ANG-${Date.now().toString().slice(-4)}-T${v.size}-${i+1}`,
          size: String(v.size),
          color: v.color || 'Estándar',
          price: { amountCents: Number(v.priceCents) || 12000, currency: 'PEN' },
          stock: Number(v.stock) || 1
        }));

        const product = catalogService.createProduct({
          name: args.name || 'Nuevo Producto Angibell',
          description: args.description || `Prenda confeccionada por Angibell en Huancayo`,
          imageUrls: args.imageUrls && args.imageUrls.length > 0 ? args.imageUrls : [
            'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=800&q=80'
          ],
          variants: variantsData
        }, actorId);

        const proposal = proposalService.createProposal({
          kind: 'publish_product',
          productId: product.id,
          expectedVersion: product.version
        }, actorId);

        return {
          success: true,
          proposalId: proposal.id,
          productName: product.name,
          variants: variantsData.map(v => `Talla ${v.size} (${v.color}) - S/ ${(v.price.amountCents/100).toFixed(2)} - Stock: ${v.stock}`),
          expiresAt: proposal.expiresAt,
          summary: proposal.summary,
          confirmationRequired: true
        };
      }

      case 'confirm_proposal': {
        if (userRole !== 'admin') {
          return { error: 'Acceso denegado: solo la dueña puede confirmar propuestas.' };
        }
        let propId = args.proposalId;
        if (!propId) {
          // Look up latest pending proposal for actor
          const latest = db.queryOne(`SELECT id FROM admin_proposals WHERE actor_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [actorId]);
          if (!latest) {
            const anyPending = db.queryOne(`SELECT id FROM admin_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`);
            if (anyPending) {
              propId = anyPending.id;
            } else {
              return { error: 'No tienes ninguna propuesta pendiente por confirmar en este momento.' };
            }
          } else {
            propId = latest.id;
          }
        }

        const outcome = proposalService.confirmProposal(propId, actorId, 'CONFIRM');
        return {
          success: true,
          proposalId: propId,
          status: 'confirmed',
          product: outcome.product ? {
            id: outcome.product.id,
            name: outcome.product.name,
            status: outcome.product.status
          } : null,
          socialDraft: outcome.socialDraft ? {
            id: outcome.socialDraft.id,
            caption: outcome.socialDraft.caption,
            status: outcome.socialDraft.status
          } : null
        };
      }

      case 'create_order': {
        const orderResult = orderService.createOrder({
          items: args.items,
          channel: 'whatsapp',
          deliveryZoneId: 'pickup'
        }, actorId);

        const payment = paymentService.createPayment(orderResult.id, actorId, 'simulated');

        return {
          success: true,
          orderId: orderResult.id,
          totalSoles: (orderResult.total.amountCents / 100).toFixed(2),
          reservationExpiresAt: orderResult.reservationExpiresAt,
          checkoutUrl: payment.checkoutUrl,
          message: 'Stock reservado por 15 minutos.'
        };
      }

      case 'request_human_handoff': {
        return {
          success: true,
          handoff: true,
          reason: args.reason,
          notice: 'Se ha derivado a la diseñadora principal de Angibell.'
        };
      }

      case 'create_social_draft': {
        let prod = null;
        if (args.productId) {
          prod = db.queryOne(`SELECT * FROM products WHERE id = ?`, [args.productId]);
        }
        if (!prod) {
          prod = db.queryOne(`SELECT * FROM products ORDER BY created_at DESC LIMIT 1`);
        }
        if (!prod) {
          return { error: 'No se encontró un producto para asociar a la publicación.' };
        }

        const draftId = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const caption = `${args.facebookCopy || `¡Nueva prenda en Angibell! Conoce ${prod.name}`}\n\n---\nInstagram:\n${args.instagramCopy || args.facebookCopy || prod.description}`;
        db.execute(`
          INSERT INTO social_drafts (id, product_id, caption, image_urls, status, mode, created_at)
          VALUES (?, ?, ?, ?, 'prepared', 'simulated', ?)
        `, [draftId, prod.id, caption, prod.image_urls || '[]', nowIso]);

        return {
          success: true,
          draftId,
          productName: prod.name,
          status: 'prepared',
          caption
        };
      }

      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  }

  /**
   * Procesa un mensaje conversacional usando el modelo de OpenRouter
   */
  async processMessage({ conversationId, actorId, userRole, text, imageUrls = [], channel = 'whatsapp' }) {
    // 1. Obtener historial reciente de mensajes
    const historyRows = db.query(`
      SELECT role, text, created_at FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC LIMIT 8
    `, [conversationId]);
    historyRows.reverse();

    // 2. Construir prompt del sistema
    const systemPrompt = userRole === 'admin'
      ? `Eres el Asistente Administrativo de Angibell 360, operando directamente en el WhatsApp de la dueña del taller y tienda de confecciones Angibell en Huancayo, Perú.
Tu función es ayudar a la dueña a gestionar su negocio desde mensajes de WhatsApp (fotos, voz o texto).
Capacidades:
1. Registrar productos: Si la dueña describe un nuevo vestido o prenda (o envía fotos/medidas), extrae el nombre, descripción, variantes (talla, color, precio en céntimos y stock) y llama a 'propose_product'.
2. Confirmar propuestas: Cuando la dueña dice "CONFIRMAR", "Sí", "Listo", "Publicar" o similar para aprobar una propuesta pendiente, llama a 'confirm_proposal'.
3. Consultar inventario/stock: Si pregunta por existencias, llama a 'search_catalog'.
4. Generar publicaciones de redes sociales: Si pide armar o revisar el post de redes, llama a 'create_social_draft'.

Reglas de Negocio:
- Precios: Siempre en Soles (PEN). Internamente la herramienta usa céntimos (ej: 115 soles = 11500 céntimos).
- Toda creación de producto requiere CONFIRMACIÓN de la dueña mediante una propuesta con TTL de 5 minutos.
- Sé concisa, ejecutiva, ordenada y usa emojis amables (👗, ✨, 📦, 💰).`
      : `Eres Rosita, la asesora de ventas virtual de Angibell Creaciones (Huancayo, Perú).
Angibell se especializa en vestidos de fiesta, gala, primera comunión, bautizo y ropa casual de alta confección para niñas de 0 a 14 años.
Tu objetivo es brindar una atención cálida, amable y consultiva a los padres de familia, guiándolos para encontrar la prenda ideal.

Capacidades:
1. Consultar catálogo y existencias: Usa SIEMPRE 'search_catalog' para conocer los vestidos reales, tallas disponibles y precios exactos en Soles. NUNCA inventes vestidos, precios o stock que no estén en la base de datos.
2. Compras y pedidos: Si el cliente decide comprar un vestido disponible, confirma la talla y cantidad, y llama a 'create_order' para reservar el stock por 15 minutos y generar su enlace de pago seguro con Culqi (acepta Yape, Plin y tarjetas).
3. Confección a medida / Diseño personalizado: Si el cliente pide un diseño exclusivo, medidas especiales o modificación de modelo, llama a 'request_human_handoff' e infórmale con cariño que la diseñadora principal se comunicará directamente con ellos.

Tono:
- Muy cálido, respetuoso y empático (ej: "¡Hola! Qué gusto saludarte 🌸", "Con mucho gusto te ayudo a elegir el vestido perfecto para tu pequeña").
- Precios claros en Soles (PEN).`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    for (const h of historyRows) {
      if (h.role === 'customer' || h.role === 'admin') {
        messages.push({ role: 'user', content: h.text });
      } else if (h.role === 'assistant') {
        messages.push({ role: 'assistant', content: h.text });
      }
    }

    // Agregar mensaje actual
    let userContent = text;
    if (imageUrls && imageUrls.length > 0) {
      userContent = [
        { type: 'text', text: text || 'Mira esta foto del nuevo vestido para agregar al catálogo:' },
        ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
      ];
    }
    messages.push({ role: 'user', content: userContent });

    // 3. Llamada a OpenRouter
    let lastProposal = null;
    let lastOrderId = null;
    let isHandoff = false;
    let toolExecutionLog = [];

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hackuc.org/angibell360',
          'X-Title': 'Angibell 360 Agent'
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages,
          tools: TOOLS_SCHEMA,
          tool_choice: 'auto'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
      }

      const completion = await response.json();
      const choice = completion.choices?.[0];
      const assistantMessage = choice?.message;

      // 4. Si el modelo llamó a herramientas:
      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        messages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('Error parseando argumentos de tool:', e);
          }

          const toolResult = await this.executeTool(fnName, fnArgs, { actorId, conversationId, userRole });
          toolExecutionLog.push({ tool: fnName, args: fnArgs, result: toolResult });

          if (toolResult.proposalId) {
            lastProposal = { id: toolResult.proposalId, summary: toolResult.summary, status: toolResult.status || 'pending' };
          }
          if (toolResult.orderId) {
            lastOrderId = toolResult.orderId;
          }
          if (toolResult.handoff) {
            isHandoff = true;
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: fnName,
            content: JSON.stringify(toolResult)
          });
        }

        // Llamar a OpenRouter para obtener la respuesta final conversacional
        const finalResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://hackuc.org/angibell360',
            'X-Title': 'Angibell 360 Agent'
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages
          })
        });

        const finalCompletion = await finalResponse.json();
        const replyText = finalCompletion.choices?.[0]?.message?.content || 'Operación completada con éxito.';

        return {
          replyText,
          proposal: lastProposal,
          orderId: lastOrderId,
          handoff: isHandoff,
          toolExecutionLog
        };
      }

      // Si no llamó herramientas, devolver texto directo
      return {
        replyText: assistantMessage?.content || '¿En qué puedo ayudarte hoy?',
        proposal: null,
        orderId: null,
        handoff: false,
        toolExecutionLog: []
      };

    } catch (err) {
      console.error('Error en llamada a OpenRouter:', err);
      // Fallback amigable
      return {
        replyText: `Hola, recibí tu mensaje pero tuve un problema de conexión momentáneo con la IA. Por favor intenta nuevamente en unos segundos. Detalle: ${err.message}`,
        proposal: null,
        orderId: null,
        handoff: false,
        toolExecutionLog: []
      };
    }
  }
}

export const agentService = new AgentService();
