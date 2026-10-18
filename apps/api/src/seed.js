import { createAdminSession } from './middleware/auth.js';
import { db } from './database/db.js';

export async function runSeed() {
    console.log('--- Iniciando Seed de Datos ANGIBELL 360 ---');
    await db.init();
    const adminPhone = '+51995992450';
    await db.transaction(async () => {
        await db.execute(`DELETE FROM sessions WHERE actor_id IN (
            SELECT actor_id FROM authorized_admins WHERE phone <> $1
        )`, [adminPhone]);
        await db.execute(`UPDATE authorized_admins SET active = CASE WHEN phone = $1 THEN 1 ELSE 0 END`, [adminPhone]);
        await db.execute(`UPDATE actors SET role = 'customer' WHERE phone IS NOT NULL AND phone <> $1 AND role = 'admin'`, [adminPhone]);
    });
    const admins = [await createAdminSession(adminPhone)];
    await db.execute(`UPDATE actors SET role = 'admin' WHERE id = $1`, [admins[0].actorId]);
    console.log(`Administradores asegurados: ${admins.length} (teléfonos omitidos de los logs).`);
    console.log('Sesiones administrativas creadas (credenciales omitidas de los logs).');
    console.log('--- Seed completado exitosamente (sin productos mock) ---');
    return { adminToken: admins[0].token, actorId: admins[0].actorId };
}

if (process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts')) {
    runSeed().catch((err) => {
        console.error('Error en seed:', err);
        process.exit(1);
    });
}
