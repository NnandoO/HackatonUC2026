import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { agentService } from './agent.service.js';

export class ChatService {
    async createConversation(actorId, channel = 'web') {
        const id = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        await db.execute(
            `INSERT INTO actors (id, role, created_at) VALUES ($1, 'customer', $2) ON CONFLICT (id) DO NOTHING`,
            [actorId, nowIso]
        );
        await db.execute(
            `INSERT INTO conversations (id, actor_id, channel, created_at)
             VALUES ($1, $2, $3, $4)`,
            [id, actorId, channel, nowIso]
        );
        return { id, channel };
    }

    async postMessage(conversationId, actorId, input, userRole = 'customer') {
        const conv = await db.queryOne(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
        if (!conv) {
            throw new Error('NOT_FOUND: Conversación no encontrada.');
        }
        const now = new Date().toISOString();
        const customerMsgId = crypto.randomUUID();

        // 1. Store user message in history
        await db.execute(
            `INSERT INTO messages (id, conversation_id, role, text, channel, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerMsgId, conversationId, userRole, input.text.trim(), conv.channel, now]
        );

        // 2. Delegate to OpenRouter Agent with real tool calling
        const agentResult = await agentService.processMessage({
            conversationId,
            actorId,
            userRole,
            text: input.text.trim(),
            imageUrls: input.imageUrls || [],
            storedImageUrls: input.storedImageUrls || [],
            channel: conv.channel
        });

        const assistantMsgId = crypto.randomUUID();
        const replyText = agentResult.replyText;
        const proposal = agentResult.proposal || null;
        const orderId = agentResult.orderId || null;
        const handoff = agentResult.handoff || false;
        const replyCreatedAt = new Date().toISOString();

        // 3. Store assistant response
        await db.execute(
            `INSERT INTO messages (id, conversation_id, role, text, channel, proposal_id, order_id, handoff, created_at)
             VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8)`,
            [
                assistantMsgId,
                conversationId,
                replyText,
                conv.channel,
                proposal?.id || null,
                orderId,
                handoff ? 1 : 0,
                replyCreatedAt
            ]
        );

        return {
            message: {
                id: assistantMsgId,
                conversationId,
                role: 'assistant',
                text: replyText,
                channel: conv.channel,
                createdAt: replyCreatedAt,
            },
            proposal,
            orderId,
            handoff,
            toolExecutionLog: agentResult.toolExecutionLog || []
        };
    }
}

export const chatService = new ChatService();
