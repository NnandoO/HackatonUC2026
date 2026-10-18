import { createAdminSession } from './middleware/auth.js';
import { db } from './database/db.js';

export async function runSeed() {
    console.log('--- Iniciando Seed de Datos ANGIBELL 360 ---');
    await db.init();
    // Revocar el número administrativo usado solo en la demo anterior.
    await db.execute(`UPDATE authorized_admins SET active = 0 WHERE phone = $1`, ['+51999888777']);
    // Asegurar sesión/actor administrativo real sin sembrar productos mock.
    const admin = await createAdminSession('+51995992450');
    console.log(`Admin asegurado con ID: ${admin.actorId}`);
    console.log('Sesión administrativa creada (credencial omitida de los logs).');
    console.log('--- Seed completado exitosamente (sin productos mock) ---');
    return { adminToken: admin.token, actorId: admin.actorId };
}

if (process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts')) {
    runSeed().catch((err) => {
        console.error('Error en seed:', err);
        process.exit(1);
    });
}
