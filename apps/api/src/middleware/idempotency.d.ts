export interface IdempotencyRecord {
    responseCode: number;
    responseBody: string;
}
export declare function checkIdempotency(actorId: string, route: string, key: string, bodyRaw: string): IdempotencyRecord | 'CONFLICT' | null;
export declare function saveIdempotency(actorId: string, route: string, key: string, bodyRaw: string, statusCode: number, responseBody: string): void;
