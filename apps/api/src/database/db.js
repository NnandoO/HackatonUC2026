import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { INIT_SCHEMA_SQL } from './schema.js';

const { Pool, types } = pg;

// Parse PostgreSQL INT8 (BIGINT, e.g. COUNT(*)) as JavaScript Number
types.setTypeParser(20, (val) => Number(val));

const DEFAULT_DATABASE_URL = 'postgresql://angibell:angibell_test_pw@127.0.0.1:55432/angibell360';

export function normalizeSqlPlaceholders(sql) {
    if (!sql.includes('?')) {
        return sql;
    }
    let index = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let out = '';
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" && !inDoubleQuote) {
            if (inSingleQuote && sql[i + 1] === "'") {
                out += "''";
                i++;
                continue;
            }
            inSingleQuote = !inSingleQuote;
            out += ch;
        } else if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            out += ch;
        } else if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
            index += 1;
            out += `$${index}`;
        } else {
            out += ch;
        }
    }
    return out;
}

export class Database {
    pool;
    als;
    initPromise = null;

    constructor(connectionString) {
        const url = connectionString || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
        this.pool = new Pool({
            connectionString: url,
            max: 20,
        });
        this.als = new AsyncLocalStorage();
    }

    async init() {
        if (!this.initPromise) {
            this.initPromise = this.pool.query(INIT_SCHEMA_SQL).catch((err) => {
                this.initPromise = null;
                throw err;
            });
        }
        await this.initPromise;
    }

    async _runner() {
        const txClient = this.als.getStore();
        if (txClient) {
            return txClient;
        }
        if (!this.initPromise) {
            await this.init();
        } else {
            await this.initPromise;
        }
        return this.pool;
    }

    async query(sql, params = []) {
        const runner = await this._runner();
        const pgSql = normalizeSqlPlaceholders(sql);
        const res = await runner.query(pgSql, params);
        return res.rows;
    }

    async queryOne(sql, params = []) {
        const runner = await this._runner();
        const pgSql = normalizeSqlPlaceholders(sql);
        const res = await runner.query(pgSql, params);
        return res.rows[0] || null;
    }

    async execute(sql, params = []) {
        const runner = await this._runner();
        const pgSql = normalizeSqlPlaceholders(sql);
        const res = await runner.query(pgSql, params);
        return { changes: res.rowCount ?? 0, rows: res.rows };
    }

    async transaction(fn) {
        const existingClient = this.als.getStore();
        if (existingClient) {
            return await fn(existingClient);
        }
        if (!this.initPromise) {
            await this.init();
        } else {
            await this.initPromise;
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await this.als.run(client, () => fn(client));
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Ignore rollback errors
            }
            throw err;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}

export const db = new Database();
