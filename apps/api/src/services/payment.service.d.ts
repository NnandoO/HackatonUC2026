import type { Payment, Mode } from '@angibell/contracts';
export declare class PaymentService {
    createPayment(orderId: string, actorId: string, mode?: Mode): Payment;
    getPaymentByOrderId(orderId: string): Payment | null;
    processCulqiWebhook(payload: any): {
        received: boolean;
        status: string;
    };
}
export declare const paymentService: PaymentService;
