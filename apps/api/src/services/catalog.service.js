import crypto from 'node:crypto';
import { db } from '../database/db.js';
export class CatalogService {
    getProducts(options) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const cursor = options.cursor;
        let sql = `SELECT * FROM products WHERE status = 'published'`;
        const params = [];
        if (cursor) {
            sql += ` AND created_at < ?`;
            params.push(cursor);
        }
        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit + 1);
        const rows = db.query(sql, params);
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const products = items.map((r) => this.mapProduct(r));
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
        return { items: products, nextCursor };
    }
    getProductById(id) {
        const row = db.queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!row)
            return null;
        return this.mapProduct(row);
    }
    adminGetProducts(options) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const cursor = options.cursor;
        let sql = `SELECT * FROM products WHERE 1=1`;
        const params = [];
        if (cursor) {
            sql += ` AND created_at < ?`;
            params.push(cursor);
        }
        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit + 1);
        const rows = db.query(sql, params);
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const products = items.map((r) => this.mapProduct(r));
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
        return { items: products, nextCursor };
    }
    createProduct(input, actorId) {
        if (!input.name || input.name.trim().length === 0 || input.name.length > 120) {
            throw new Error('INVALID_INPUT: El nombre debe tener entre 1 y 120 caracteres.');
        }
        if (input.description && input.description.length > 4000) {
            throw new Error('INVALID_INPUT: La descripción no puede exceder 4000 caracteres.');
        }
        if (!input.variants || input.variants.length === 0 || input.variants.length > 50) {
            throw new Error('INVALID_INPUT: El producto debe tener entre 1 y 50 variantes.');
        }
        const productId = crypto.randomUUID();
        const now = new Date().toISOString();
        return db.transaction(() => {
            db.execute(`INSERT INTO products (id, name, description, image_urls, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?)`, [productId, input.name.trim(), input.description?.trim() || '', JSON.stringify(input.imageUrls || []), now, now]);
            const variants = [];
            for (const v of input.variants) {
                if (!v.sku || !v.size || !v.color || v.price?.amountCents < 0 || v.stock < 0) {
                    throw new Error('INVALID_INPUT: Datos inválidos en variante.');
                }
                const variantId = crypto.randomUUID();
                db.execute(`INSERT INTO variants (id, product_id, sku, size, color, price_cents, stock_on_hand, stock_reserved, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`, [variantId, productId, v.sku.trim(), v.size.trim(), v.color.trim(), v.price.amountCents, v.stock]);
                variants.push({
                    id: variantId,
                    sku: v.sku.trim(),
                    size: v.size.trim(),
                    color: v.color.trim(),
                    price: { amountCents: v.price.amountCents, currency: 'PEN' },
                    available: v.stock,
                    version: 1,
                });
            }
            // Ensure actor exists
            const actor = db.queryOne(`SELECT id FROM actors WHERE id = ?`, [actorId]);
            if (!actor) {
                db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'admin', ?)`, [actorId, now]);
            }
            // Record audit event
            const auditId = crypto.randomUUID();
            db.execute(`INSERT INTO audit_events (id, actor_id, action, entity_id, proposal_id, request_id, changes, created_at)
         VALUES (?, ?, 'create_product_draft', ?, NULL, ?, ?, ?)`, [auditId, actorId, productId, crypto.randomUUID(), JSON.stringify({ name: input.name }), now]);
            return {
                id: productId,
                name: input.name.trim(),
                description: input.description?.trim() || '',
                imageUrls: input.imageUrls || [],
                status: 'draft',
                variants,
                version: 1,
            };
        });
    }
    mapProduct(row) {
        const variantRows = db.query(`SELECT * FROM variants WHERE product_id = ? ORDER BY size, color`, [row.id]);
        const variants = variantRows.map((v) => ({
            id: v.id,
            sku: v.sku,
            size: v.size,
            color: v.color,
            price: { amountCents: v.price_cents, currency: 'PEN' },
            available: Math.max(0, v.stock_on_hand - v.stock_reserved),
            version: v.version,
        }));
        let imageUrls = [];
        try {
            imageUrls = JSON.parse(row.image_urls);
        }
        catch {
            imageUrls = [];
        }
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            imageUrls,
            status: row.status,
            variants,
            version: row.version,
        };
    }
}
export const catalogService = new CatalogService();
