import type { MessageInput, MessageResult, Channel } from '@angibell/contracts';
export declare class ChatService {
    createConversation(actorId: string, channel?: Channel): {
        id: string;
        channel: Channel;
    };
    postMessage(conversationId: string, actorId: string, input: MessageInput, userRole?: 'customer' | 'admin'): Promise<MessageResult>;
}
export declare const chatService: ChatService;
