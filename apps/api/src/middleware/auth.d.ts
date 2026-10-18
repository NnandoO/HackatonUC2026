import type { IncomingMessage } from 'node:http';
export interface AuthContext {
    actorId: string;
    role: 'customer' | 'admin';
    phone?: string;
}
export declare function parseCookies(req: IncomingMessage): Record<string, string>;
export declare function getAuthContext(req: IncomingMessage): AuthContext;
export declare function createCustomerSession(actorId?: string): {
    token: string;
    expiresAt: string;
    actorId: string;
};
export declare function createAdminSession(phone?: string): {
    token: string;
    expiresAt: string;
    actorId: string;
};
