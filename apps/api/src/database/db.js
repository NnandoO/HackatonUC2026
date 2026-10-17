import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INIT_SCHEMA_SQL } from './schema.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class Database {
    db;
    constructor(customPath) {
        const dbPath = customPath || process.env.DB_PATH || path.resolve(__dirname, '../../../.state/angibell-dev.db');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON;');
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.init();
    }
    init() {
        this.db.exec(INIT_SCHEMA_SQL);
    }
    query(sql, params = []) {
        const stmt = this.db.prepare(sql);
        return stmt.all(...params);
    }
    queryOne(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const row = stmt.get(...params);
        return row || null;
    }
    execute(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const result = stmt.run(...params);
        return { changes: Number(result.changes) };
    }
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE;');
        try {
            const result = fn();
            this.db.exec('COMMIT;');
            return result;
        }
        catch (err) {
            this.db.exec('ROLLBACK;');
            throw err;
        }
    }
    close() {
        this.db.close();
    }
}
export const db = new Database();
