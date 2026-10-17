import type { OrderInput, Order, Page } from '@angibell/contracts';
export declare class OrderService {
    createOrder(input: OrderInput, actorId: string): Order;
    getOrderById(id: string, actorId: string, isAdmin?: boolean): Order | null;
    adminGetOrders(options: {
        limit?: number;
        cursor?: string | null;
    }): Page<Order>;
    sweepExpiredReservations(): void;
}
export declare const orderService: OrderService;
