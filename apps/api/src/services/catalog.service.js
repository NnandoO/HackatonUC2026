import crypto from 'node:crypto';
import { db } from '../database/db.js';

export function slugify(value) {
    const base = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return base || 'producto';
}

export class CatalogService {
    async getProducts(options = {}) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 200);
        const cursor = options.cursor;
        let sql = `SELECT * FROM products WHERE status = 'published'`;
        const params = [];
        if (cursor) {
            sql += ` AND created_at < $1`;
            params.push(cursor);
        }
        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit + 1);
        const rows = await db.query(sql, params);
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const products = await Promise.all(items.map((r) => this.mapProduct(r)));
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
        return { items: products, nextCursor };
    }

    async getProductById(idOrSlug) {
        const row = await db.queryOne(
            `SELECT * FROM products WHERE id = $1 OR slug = $1 LIMIT 1`,
            [idOrSlug]
        );
        if (!row)
            return null;
        return this.mapProduct(row);
    }

    async getProductBySlug(slug) {
        const row = await db.queryOne(
            `SELECT * FROM products WHERE slug = $1 OR id = $1 LIMIT 1`,
            [slug]
        );
        if (!row)
            return null;
        return this.mapProduct(row);
    }

    async adminGetProducts(options = {}) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 200);
        const cursor = options.cursor;
        const status = options.status;
        let sql = `SELECT * FROM products WHERE 1=1`;
        const params = [];
        if (status && ['draft', 'published', 'rejected'].includes(status)) {
            params.push(status);
            sql += ` AND status = $${params.length}`;
        }
        if (cursor) {
            params.push(cursor);
            sql += ` AND created_at < $${params.length}`;
        }
        params.push(limit + 1);
        sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
        const rows = await db.query(sql, params);
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const products = await Promise.all(items.map((r) => this.mapProduct(r)));
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
        return { items: products, nextCursor };
    }

    async _generateUniqueSlug(nameOrSlug) {
        const base = slugify(nameOrSlug);
        let candidate = base;
        let counter = 2;
        while (await db.queryOne(`SELECT id FROM products WHERE slug = $1`, [candidate])) {
            candidate = `${base}-${counter}`;
            counter += 1;
        }
        return candidate;
    }

    async createProduct(input, actorId = 'web-panel-service') {
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
        const initialStatus = input.publish === true || input.status === 'published'
            ? 'published'
            : input.status === 'rejected'
                ? 'rejected'
                : 'draft';
        const source = ['manual', 'paperclip', 'whatsapp'].includes(input.source) ? input.source : 'manual';
        const category = String(input.category || '').trim();
        const currency = 'PEN';
        const compareAtCents = input.compareAtCents != null && Number(input.compareAtCents) > 0
            ? Math.round(Number(input.compareAtCents))
            : null;

        return db.transaction(async () => {
            const slug = await this._generateUniqueSlug(input.slug || input.name);

            const normalizedVariantsInput = input.variants.map((v, idx) => {
                const size = String(v.size ?? '').trim();
                const color = String(v.color ?? '').trim();
                const rawPrice = v.price?.amountCents ?? v.priceCents ?? input.priceCents;
                const amountCents = Number(rawPrice);
                const rawStock = v.stock ?? v.stockOnHand ?? v.stockDeclared ?? 0;
                const stock = Number(rawStock);
                if (!size || !Number.isFinite(amountCents) || amountCents < 0 || !Number.isFinite(stock) || stock < 0) {
                    throw new Error('INVALID_INPUT: Datos inválidos en variante.');
                }
                const autoSku = `ANG-${slug.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)}-T${size}-${idx + 1}`;
                const sku = v.sku && String(v.sku).trim() ? String(v.sku).trim() : autoSku;
                return {
                    sku,
                     explicitSku: Boolean(v.sku && String(v.sku).trim()),
                    size,
                    color,
                    amountCents: Math.round(amountCents),
                    stock: Math.round(stock),
                };
            });

            const basePriceCents = input.priceCents != null && Number.isFinite(Number(input.priceCents)) && Number(input.priceCents) > 0
                ? Math.round(Number(input.priceCents))
                : Math.min(...normalizedVariantsInput.map((v) => v.amountCents));

            const colorsArray = Array.isArray(input.colors) && input.colors.length > 0
                ? input.colors.map((c) => String(c).trim()).filter(Boolean)
                : [...new Set(normalizedVariantsInput.map((v) => v.color).filter(Boolean))];

            await db.execute(
                `INSERT INTO products (
                    id, slug, name, description, price_cents, compare_at_cents, currency,
                    category, colors, image_urls, status, source, version, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14)`,
                [
                    productId,
                    slug,
                    input.name.trim(),
                    input.description?.trim() || '',
                    basePriceCents,
                    compareAtCents,
                    currency,
                    category,
                    JSON.stringify(colorsArray),
                    JSON.stringify(input.imageUrls || []),
                    initialStatus,
                    source,
                    now,
                    now,
                ]
            );

            const variants = [];
            for (const v of normalizedVariantsInput) {
                let finalSku = v.sku;
                if (!v.explicitSku) {
                    const existingSku = await db.queryOne(`SELECT id FROM variants WHERE sku = $1`, [finalSku]);
                    if (existingSku) {
                        finalSku = `${finalSku}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
                    }
                }
                const variantId = crypto.randomUUID();
                await db.execute(
                    `INSERT INTO variants (id, product_id, sku, size, color, price_cents, stock_on_hand, stock_reserved, version)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1)`,
                    [variantId, productId, finalSku, v.size, v.color, v.amountCents, v.stock]
                );
                variants.push({
                    id: variantId,
                    sku: finalSku,
                    size: v.size,
                    color: v.color,
                    price: { amountCents: v.amountCents, currency: 'PEN' },
                    available: v.stock,
                    stockOnHand: v.stock,
                    stockReserved: 0,
                    version: 1,
                });
            }

            // Ensure actor exists
            await db.execute(
                `INSERT INTO actors (id, role, created_at) VALUES ($1, 'admin', $2) ON CONFLICT (id) DO NOTHING`,
                [actorId, now]
            );

            if (initialStatus === 'published') {
                await this._ensureSocialDraft(productId, input.name.trim(), input.description?.trim() || '', input.imageUrls || [], now);
            }

            if (input.note || input.source === 'paperclip' || input.recordPublication) {
                await db.execute(
                    `INSERT INTO publications (product_id, payload, note, received_at) VALUES ($1, $2, $3, $4)`,
                    [productId, JSON.stringify(input), String(input.note || `Creación (${source})`), now]
                );
            }

            // Record audit event
            const auditId = crypto.randomUUID();
            await db.execute(
                `INSERT INTO audit_events (id, actor_id, action, entity_id, proposal_id, request_id, changes, created_at)
                 VALUES ($1, $2, 'create_product_draft', $3, NULL, $4, $5, $6)`,
                [auditId, actorId, productId, crypto.randomUUID(), JSON.stringify({ name: input.name, slug, status: initialStatus }), now]
            );

            return {
                id: productId,
                slug,
                name: input.name.trim(),
                description: input.description?.trim() || '',
                priceCents: basePriceCents,
                compareAtCents,
                currency,
                category,
                colors: colorsArray,
                imageUrls: input.imageUrls || [],
                status: initialStatus,
                source,
                version: 1,
                createdAt: now,
                updatedAt: now,
                variants,
            };
        });
    }

    async _ensureSocialDraft(productId, name, description, imageUrls, nowIso = new Date().toISOString()) {
        const existing = await db.queryOne(`SELECT * FROM social_drafts WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`, [productId]);
        if (existing) {
            return {
                id: existing.id,
                productId: existing.product_id,
                caption: existing.caption,
                imageUrls: JSON.parse(existing.image_urls || '[]'),
                status: existing.status,
                mode: existing.mode,
            };
        }
        const draftId = crypto.randomUUID();
        const caption = `Nueva prenda en Angibell Creaciones: ${name}.\n\n${description}\n\nConsulta tallas y disponibilidad con la tienda. #Angibell #ModaInfantil #HechoEnPeru`;
        const serializedImages = Array.isArray(imageUrls) ? JSON.stringify(imageUrls) : String(imageUrls || '[]');
        await db.execute(
            `INSERT INTO social_drafts (id, product_id, caption, image_urls, status, mode, created_at)
             VALUES ($1, $2, $3, $4, 'prepared', 'simulated', $5)`,
            [draftId, productId, caption, serializedImages, nowIso]
        );
        return {
            id: draftId,
            productId,
            caption,
            imageUrls: Array.isArray(imageUrls) ? imageUrls : JSON.parse(serializedImages),
            status: 'prepared',
            mode: 'simulated',
        };
    }

    async setProductStatus(id, status, actorId = 'web-panel-service') {
        if (!['draft', 'published', 'rejected'].includes(status)) {
            throw new Error('INVALID_INPUT: Estado de producto inválido.');
        }
        return db.transaction(async () => {
            const prod = await db.queryOne(`SELECT * FROM products WHERE id = $1 OR slug = $1 FOR UPDATE`, [id]);
            if (!prod) {
                throw new Error('NOT_FOUND: Producto no encontrado.');
            }
            const nowIso = new Date().toISOString();
            await db.execute(
                `UPDATE products SET status = $1, version = version + 1, updated_at = $2 WHERE id = $3`,
                [status, nowIso, prod.id]
            );
            if (status === 'published') {
                let imgs = [];
                try { imgs = JSON.parse(prod.image_urls || '[]'); } catch { imgs = []; }
                await this._ensureSocialDraft(prod.id, prod.name, prod.description, imgs, nowIso);
            }
            await db.execute(
                `INSERT INTO actors (id, role, created_at) VALUES ($1, 'admin', $2) ON CONFLICT (id) DO NOTHING`,
                [actorId, nowIso]
            );
            await db.execute(
                `INSERT INTO audit_events (id, actor_id, action, entity_id, proposal_id, request_id, changes, created_at)
                 VALUES ($1, $2, 'set_product_status', $3, NULL, $4, $5, $6)`,
                [crypto.randomUUID(), actorId, prod.id, crypto.randomUUID(), JSON.stringify({ status }), nowIso]
            );
            return this.getProductById(prod.id);
        });
    }

    async recordPublication(productId, payload, note = '') {
        const nowIso = new Date().toISOString();
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
        const res = await db.queryOne(
            `INSERT INTO publications (product_id, payload, note, received_at)
             VALUES ($1, $2, $3, $4)
             RETURNING id, product_id, payload, note, received_at`,
            [productId || null, serialized, String(note || ''), nowIso]
        );
        return res;
    }

    async listPublications(limit = 50) {
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const rows = await db.query(
            `SELECT id, product_id, payload, note, received_at
             FROM publications
             ORDER BY id DESC
             LIMIT $1`,
            [safeLimit]
        );
        return rows;
    }

    async mapProduct(row) {
        const variantRows = await db.query(
            `SELECT * FROM variants WHERE product_id = $1 ORDER BY size, color`,
            [row.id]
        );
        const variants = variantRows.map((v) => ({
            id: v.id,
            sku: v.sku,
            size: v.size,
            color: v.color,
            price: { amountCents: v.price_cents, currency: 'PEN' },
            available: Math.max(0, v.stock_on_hand - v.stock_reserved),
            stockOnHand: v.stock_on_hand,
            stockReserved: v.stock_reserved,
            version: v.version,
        }));
        let imageUrls = [];
        try {
            imageUrls = JSON.parse(row.image_urls || '[]');
        } catch {
            imageUrls = [];
        }
        let colors = [];
        try {
            colors = JSON.parse(row.colors || '[]');
        } catch {
            colors = [];
        }
        if (colors.length === 0 && variants.length > 0) {
            colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
        }
        const computedMinPrice = variants.length > 0
            ? Math.min(...variants.map((v) => v.price.amountCents))
            : 0;
        const priceCents = row.price_cents > 0 ? row.price_cents : computedMinPrice;

        return {
            id: row.id,
            slug: row.slug || slugify(row.name),
            name: row.name,
            description: row.description,
            priceCents,
            compareAtCents: row.compare_at_cents ?? null,
            currency: row.currency || 'PEN',
            category: row.category || '',
            colors,
            imageUrls,
            status: row.status,
            source: row.source || 'manual',
            variants,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export const catalogService = new CatalogService();
