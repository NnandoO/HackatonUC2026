import { catalogService } from './services/catalog.service.js';
import { proposalService } from './services/proposal.service.js';
import { createAdminSession } from './middleware/auth.js';
import { db } from './database/db.js';
export function runSeed() {
    console.log('--- Iniciando Seed de Datos ANGIBELL 360 ---');
    // 1. Create Admin
    const admin = createAdminSession('+51999888777');
    console.log(`Admin creado con ID: ${admin.actorId}`);
    console.log(`Admin Bearer Token: ${admin.token}`);
    // Check if products already exist
    const existing = catalogService.adminGetProducts({ limit: 1 });
    if (existing.items.length > 0) {
        console.log('Base de datos ya cuenta con productos. Omitiendo creación inicial.');
        return { adminToken: admin.token };
    }
    // 2. Create Angibell Products
    const p1 = catalogService.createProduct({
        name: 'Vestido de Fiesta Princesa Valery',
        description: 'Hermoso vestido de gala para niñas con detalles de tul, bordados florales en el corpiño y forro de algodón suave antialérgico. Ideal para fiestas de cumpleaños, cortejos y ocasiones especiales.',
        imageUrls: [
            'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?auto=format&fit=crop&w=800&q=80'
        ],
        variants: [
            { sku: 'ANG-VAL-BL-T4', size: '4', color: 'Blanco Perla', price: { amountCents: 12000, currency: 'PEN' }, stock: 8 },
            { sku: 'ANG-VAL-BL-T6', size: '6', color: 'Blanco Perla', price: { amountCents: 12000, currency: 'PEN' }, stock: 10 },
            { sku: 'ANG-VAL-BL-T8', size: '8', color: 'Blanco Perla', price: { amountCents: 13000, currency: 'PEN' }, stock: 5 },
            { sku: 'ANG-VAL-RS-T6', size: '6', color: 'Rosa Pastel', price: { amountCents: 12000, currency: 'PEN' }, stock: 8 },
            { sku: 'ANG-VAL-RS-T8', size: '8', color: 'Rosa Pastel', price: { amountCents: 13000, currency: 'PEN' }, stock: 6 },
        ],
    }, admin.actorId);
    const p2 = catalogService.createProduct({
        name: 'Conjunto Elegante Camila',
        description: 'Conjunto de dos piezas compuesto por blusa de seda fría con cuello bebé y falda tableada con pretina elástica confortable. Confección peruana de alta durabilidad.',
        imageUrls: [
            'https://images.unsplash.com/photo-1596870230751-ebdfce98ec42?auto=format&fit=crop&w=800&q=80'
        ],
        variants: [
            { sku: 'ANG-CAM-LL-T6', size: '6', color: 'Lila', price: { amountCents: 9500, currency: 'PEN' }, stock: 10 },
            { sku: 'ANG-CAM-LL-T8', size: '8', color: 'Lila', price: { amountCents: 9500, currency: 'PEN' }, stock: 12 },
            { sku: 'ANG-CAM-RJ-T8', size: '8', color: 'Rojo Carmín', price: { amountCents: 9500, currency: 'PEN' }, stock: 7 },
        ],
    }, admin.actorId);
    const p3 = catalogService.createProduct({
        name: 'Vestido Casual Primavera Isabella',
        description: 'Vestido ligero y fresco 100% algodón pima peruano, estampado floreado acuarelado con lazo decorativo en cintura. Perfecto para tardes soleadas y paseos.',
        imageUrls: [
            'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=800&q=80'
        ],
        variants: [
            { sku: 'ANG-ISA-CL-T4', size: '4', color: 'Celeste Floral', price: { amountCents: 7500, currency: 'PEN' }, stock: 15 },
            { sku: 'ANG-ISA-CL-T6', size: '6', color: 'Celeste Floral', price: { amountCents: 7500, currency: 'PEN' }, stock: 15 },
            { sku: 'ANG-ISA-CL-T8', size: '8', color: 'Celeste Floral', price: { amountCents: 8000, currency: 'PEN' }, stock: 10 },
        ],
    }, admin.actorId);
    // 3. Publish initial products via admin proposal confirmation
    console.log('Aprobando publicación de productos iniciales...');
    for (const p of [p1, p2, p3]) {
        const prop = proposalService.createProposal({
            kind: 'publish_product',
            productId: p.id,
            expectedVersion: p.version,
        }, admin.actorId);
        proposalService.confirmProposal(prop.id, admin.actorId, 'CONFIRM');
        console.log(`Producto publicado: "${p.name}"`);
    }
    // 4. Create a social draft
    const socialProp = proposalService.createProposal({
        kind: 'prepare_social',
        productId: p1.id,
        expectedVersion: 2,
    }, admin.actorId);
    proposalService.confirmProposal(socialProp.id, admin.actorId, 'CONFIRM');
    console.log('Publicación para redes sociales preparada para producto 1.');
    console.log('--- Seed completado exitosamente ---');
    return { adminToken: admin.token };
}
if (process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts')) {
    runSeed();
}
