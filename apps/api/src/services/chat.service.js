import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { agentService } from './agent.service.js';

export class ChatService {
    createConversation(actorId, channel = 'web') {
        const id = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        db.execute(`INSERT INTO conversations (id, actor_id, channel, created_at)
       VALUES (?, ?, ?, ?)`, [id, actorId, channel, nowIso]);
        return { id, channel };
    }

    async postMessage(conversationId, actorId, input, userRole = 'customer') {
        const conv = db.queryOne(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
        if (!conv) {
            throw new Error('NOT_FOUND: Conversación no encontrada.');
        }
        const now = new Date().toISOString();
        const customerMsgId = crypto.randomUUID();

        // 1. Store user message in history
        db.execute(`INSERT INTO messages (id, conversation_id, role, text, channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [customerMsgId, conversationId, userRole, input.text.trim(), conv.channel, now]);

        // 2. Delegate to OpenRouter Agent with real tool calling
        const agentResult = await agentService.processMessage({
            conversationId,
            actorId,
            userRole,
            text: input.text.trim(),
            imageUrls: input.imageUrls || [],
            channel: conv.channel
        });

        const assistantMsgId = crypto.randomUUID();
        const replyText = agentResult.replyText;
        const proposal = agentResult.proposal || null;
        const orderId = agentResult.orderId || null;
        const handoff = agentResult.handoff || false;

        // 3. Store assistant response
        db.execute(`INSERT INTO messages (id, conversation_id, role, text, channel, proposal_id, order_id, handoff, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`, [
            assistantMsgId,
            conversationId,
            replyText,
            conv.channel,
            proposal?.id || null,
            orderId,
            handoff ? 1 : 0,
            new Date().toISOString()
        ]);

        return {
            message: {
                id: assistantMsgId,
                conversationId,
                role: 'assistant',
                text: replyText,
                channel: conv.channel,
                createdAt: new Date().toISOString(),
            },
            proposal,
            orderId,
            handoff,
            toolExecutionLog: agentResult.toolExecutionLog || []
        };
    }
}

export const chatService = new ChatService();
