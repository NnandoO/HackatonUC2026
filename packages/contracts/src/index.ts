/** Contrato v1. Los tipos no sustituyen validación en ejecución de NestJS. */
export type Id = string; // UUID
export type Instant = string; // ISO-8601 UTC
export type Cents = number; // entero seguro >= 0, PEN
export type Channel = 'web' | 'whatsapp' | 'demo';
export type Mode = 'simulated' | 'sandbox' | 'live';
export interface Money { amountCents: Cents; currency: 'PEN' }
export interface Variant {
  id: Id; sku: string; size: string; color: string; price: Money;
  available: number; version: number;
}
export interface Product {
  id: Id; name: string; description: string; imageUrls: string[];
  status: 'draft' | 'published'; variants: Variant[]; version: number;
}
export interface ProductInput {
  name: string; description: string; imageUrls: string[];
  variants: { sku: string; size: string; color: string; price: Money; stock: number }[];
}
export interface OrderInput {
  items: { variantId: Id; quantity: number }[];
  deliveryZoneId: 'pickup'; channel: Channel;
}
export interface Order {
  id: Id; status: 'pending_payment' | 'paid' | 'expired' | 'cancelled';
  items: { variantId: Id; sku: string; quantity: number; unitPrice: Money }[];
  subtotal: Money; shipping: Money; total: Money;
  reservationExpiresAt: Instant; createdAt: Instant;
}
export interface Payment {
  id: Id; orderId: Id; status: 'pending' | 'succeeded' | 'failed' | 'expired';
  mode: Mode; amount: Money; checkoutUrl: string; expiresAt: Instant;
}
export type AdminAction =
  | { kind: 'publish_product'; productId: Id; expectedVersion: number }
  | { kind: 'set_stock'; variantId: Id; expectedVersion: number; stock: number }
  | { kind: 'set_price'; variantId: Id; expectedVersion: number; price: Money }
  | { kind: 'prepare_social'; productId: Id; expectedVersion: number };
export interface Proposal {
  id: Id; action: AdminAction; summary: string; expiresAt: Instant;
  status: 'pending' | 'confirmed' | 'expired';
}
export interface ConfirmInput { confirmation: 'CONFIRM'; expectedProposalId: Id }
export interface MessageInput { clientMessageId: Id; text: string; imageUrls: string[] }
export interface Message {
  id: Id; conversationId: Id; role: 'customer' | 'admin' | 'assistant' | 'human';
  text: string; channel: Channel; createdAt: Instant;
}
export interface MessageResult {
  message: Message; proposal: Proposal | null; orderId: Id | null; handoff: boolean;
}
export interface SocialDraft {
  id: Id; productId: Id; caption: string; imageUrls: string[];
  status: 'prepared'; mode: 'simulated';
}
export interface ApiError {
  error: { code: 'INVALID_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' |
    'CONFLICT' | 'OUT_OF_STOCK' | 'EXPIRED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE';
    message: string; requestId: Id; fields?: Record<string, string> };
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface AuditEvent {
  id: Id; actorId: Id; action: string; entityId: Id; proposalId: Id | null;
  requestId: Id; createdAt: Instant;
}
