export declare class Database {
    private db;
    constructor(customPath?: string);
    private init;
    query<T = any>(sql: string, params?: any[]): T[];
    queryOne<T = any>(sql: string, params?: any[]): T | null;
    execute(sql: string, params?: any[]): {
        changes: number;
    };
    transaction<T>(fn: () => T): T;
    close(): void;
}
export declare const db: Database;
