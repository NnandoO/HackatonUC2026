import http, { type ServerResponse } from 'node:http';
import type { ApiError } from '@angibell/contracts';
export declare function sendJson(res: ServerResponse, statusCode: number, data: any, requestId?: string): void;
export declare function sendError(res: ServerResponse, statusCode: number, code: ApiError['error']['code'], message: string, requestId: string, fields?: Record<string, string>): void;
export declare function createServer(): http.Server;
