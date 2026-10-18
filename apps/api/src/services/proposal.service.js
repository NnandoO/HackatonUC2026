import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { catalogService } from './catalog.service.js';
export class ProposalService {
    createProposal(action, actorId) {
        const proposalId = crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 min TTL
        const nowIso = now.toISOString();
        let summary = '';
        let expectedVersion = 1;
        switch (action.kind) {
            case 'publish_product': {
                const prod = db.queryOne(`SELECT * FROM products WHERE id = ?`, [action.productId]);
                if (!prod)
                    throw new Error('NOT_FOUND: Producto no encontrado.');
                expectedVersion = action.expectedVersion ?? prod.version;
                summary = `Publicar producto "${prod.name}" (v${expectedVersion})`;
                break;
            }
            case 'set_stock': {
                const v = db.queryOne(`SELECT * FROM variants WHERE id = ?`, [action.variantId]);
                if (!v)
                    throw new Error('NOT_FOUND: Variante no encontrada.');
                expectedVersion = action.expectedVersion ?? v.version;
                summary = `Ajustar stock de SKU ${v.sku} a ${action.stock} unidades (v${expectedVersion})`;
                break;
            }
            case 'set_price': {
                const v = db.queryOne(`SELECT * FROM variants WHERE id = ?`, [action.variantId]);
                if (!v)
                    throw new Error('NOT_FOUND: Variante no encontrada.');
                expectedVersion = action.expectedVersion ?? v.version;
                summary = `Actualizar precio de SKU ${v.sku} a S/ ${(action.price.amountCents / 100).toFixed(2)} (v${expectedVersion})`;
                break;
            }
            case 'prepare_social': {
                const prod = db.queryOne(`SELECT * FROM products WHERE id = ?`, [action.productId]);
                if (!prod)
                    throw new Error('NOT_FOUND: Producto no encontrado.');
                expectedVersion = action.expectedVersion ?? prod.version;
                summary = `Preparar publicación en redes sociales para "${prod.name}" (v${expectedVersion})`;
                break;
            }
        }
        const actor = db.queryOne(`SELECT id FROM actors WHERE id = ?`, [actorId]);
        if (!actor) {
            db.execute(`INSERT INTO actors (id, role, created_at) VALUES (?, 'admin', ?)`, [actorId, nowIso]);
        }
        db.execute(`INSERT INTO admin_proposals (id, actor_id, action_kind, action_payload, summary, expected_version, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [proposalId, actorId, action.kind, JSON.stringify(action), summary, expectedVersion, expiresAt, nowIso]);
        return {
            id: proposalId,
            action,
            summary,
            expiresAt,
            status: 'pending',
        };
    }
    confirmProposal(proposalId, actorId, confirmation) {
        if (confirmation !== 'CONFIRM') {
            throw new Error('INVALID_INPUT: Confirmación inválida. Debe ser CONFIRM.');
        }
        return db.transaction(() => {
            const prop = db.queryOne(`SELECT * FROM admin_proposals WHERE id = ?`, [proposalId]);
            if (!prop) {
                throw new Error('NOT_FOUND: Propuesta no encontrada.');
            }
            if (prop.status === 'confirmed') {
                // Replay pattern: return previous outcome without re-executing
                let product = null;
                let socialDraft = null;
                const action = JSON.parse(prop.action_payload);
                if ('productId' in action) {
                    product = catalogService.getProductById(action.productId);
                    socialDraft = db.queryOne(`SELECT * FROM social_drafts WHERE product_id = ?`, [action.productId]);
                }
                return {
                    proposal: {
                        id: prop.id,
                        action,
                        summary: prop.summary,
                        expiresAt: prop.expires_at,
                        status: 'confirmed',
                    },
                    product,
                    socialDraft,
                };
            }
            if (prop.status !== 'pending') {
                throw new Error(`CONFLICT: La propuesta no está pendiente (estado actual: ${prop.status}).`);
            }
            const now = new Date();
            if (new Date(prop.expires_at) < now) {
                db.execute(`UPDATE admin_proposals SET status = 'expired' WHERE id = ?`, [proposalId]);
                throw new Error('EXPIRED: La propuesta ha expirado. Genere una nueva.');
            }
            const action = JSON.parse(prop.action_payload);
            const nowIso = now.toISOString();
            let affectedProduct = null;
            let socialDraft = null;
            switch (action.kind) {
                case 'publish_product': {
                    const prod = db.queryOne(`SELECT * FROM products WHERE id = ?`, [action.productId]);
                    if (!prod)
                        throw new Error('NOT_FOUND: Producto no encontrado.');
                    if (prod.version !== action.expectedVersion) {
                        throw new Error(`CONFLICT: Versión desactualizada. Esperada: ${action.expectedVersion}, Actual: ${prod.version}`);
                    }
                    db.execute(`UPDATE products SET status = 'published', version = version + 1, updated_at = ? WHERE id = ?`, [nowIso, action.productId]);
                    affectedProduct = catalogService.getProductById(action.productId);
                    if (affectedProduct) {
                        const draftId = crypto.randomUUID();
                        const caption = `Nueva prenda en Angibell Creaciones: ${affectedProduct.name}.\n\n${affectedProduct.description}\n\nConsulta tallas y disponibilidad con la tienda. #Angibell #ModaInfantil #HechoEnPeru`;
                        db.execute(`INSERT INTO social_drafts (id, product_id, caption, image_urls, status, mode, created_at)
                                    VALUES (?, ?, ?, ?, 'prepared', 'simulated', ?)`, [draftId, affectedProduct.id, caption, JSON.stringify(affectedProduct.imageUrls || []), nowIso]);
                        socialDraft = {
                            id: draftId,
                            productId: affectedProduct.id,
                            caption,
                            imageUrls: affectedProduct.imageUrls || [],
                            status: 'prepared',
                            mode: 'simulated',
                        };
                    }
                    break;
                }
                case 'set_stock': {
                    const v = db.queryOne(`SELECT * FROM variants WHERE id = ?`, [action.variantId]);
                    if (!v)
                        throw new Error('NOT_FOUND: Variante no encontrada.');
                    if (v.version !== action.expectedVersion) {
                        throw new Error(`CONFLICT: Versión de variante desactualizada.`);
                    }
                    if (action.stock < v.stock_reserved) {
                        throw new Error(`CONFLICT: No se puede fijar stock (${action.stock}) por debajo de unidades reservadas (${v.stock_reserved}).`);
                    }
                    db.execute(`UPDATE variants SET stock_on_hand = ?, version = version + 1 WHERE id = ?`, [action.stock, action.variantId]);
                    affectedProduct = catalogService.getProductById(v.product_id);
                    break;
                }
                case 'set_price': {
                    const v = db.queryOne(`SELECT * FROM variants WHERE id = ?`, [action.variantId]);
                    if (!v)
                        throw new Error('NOT_FOUND: Variante no encontrada.');
                    if (v.version !== action.expectedVersion) {
                        throw new Error(`CONFLICT: Versión de variante desactualizada.`);
                    }
                    db.execute(`UPDATE variants SET price_cents = ?, version = version + 1 WHERE id = ?`, [action.price.amountCents, action.variantId]);
                    affectedProduct = catalogService.getProductById(v.product_id);
                    break;
                }
                case 'prepare_social': {
                    const prod = db.queryOne(`SELECT * FROM products WHERE id = ?`, [action.productId]);
                    if (!prod)
                        throw new Error('NOT_FOUND: Producto no encontrado.');
                    if (prod.version !== action.expectedVersion) {
                        throw new Error(`CONFLICT: Versión desactualizada.`);
                    }
                    const draftId = crypto.randomUUID();
                    const caption = `Nueva prenda en Angibell Creaciones: ${prod.name}.\n\n${prod.description}\n\nConsulta tallas y disponibilidad con la tienda. #Angibell #ModaInfantil #HechoEnPeru`;
                    db.execute(`INSERT INTO social_drafts (id, product_id, caption, image_urls, status, mode, created_at)
             VALUES (?, ?, ?, ?, 'prepared', 'simulated', ?)`, [draftId, prod.id, caption, prod.image_urls, nowIso]);
                    socialDraft = {
                        id: draftId,
                        productId: prod.id,
                        caption,
                        imageUrls: JSON.parse(prod.image_urls || '[]'),
                        status: 'prepared',
                        mode: 'simulated',
                    };
                    affectedProduct = catalogService.getProductById(prod.id);
                    break;
                }
            }
            // Mark proposal confirmed
            db.execute(`UPDATE admin_proposals SET status = 'confirmed' WHERE id = ?`, [proposalId]);
            // Record audit event
            const auditId = crypto.randomUUID();
            db.execute(`INSERT INTO audit_events (id, actor_id, action, entity_id, proposal_id, request_id, changes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [auditId, actorId, action.kind, (affectedProduct?.id || proposalId), proposalId, crypto.randomUUID(), JSON.stringify(action), nowIso]);
            return {
                proposal: {
                    id: prop.id,
                    action,
                    summary: prop.summary,
                    expiresAt: prop.expires_at,
                    status: 'confirmed',
                },
                product: affectedProduct,
                socialDraft,
            };
        });
    }
}
export const proposalService = new ProposalService();
