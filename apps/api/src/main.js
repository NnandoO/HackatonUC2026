import fs from 'node:fs';
if (fs.existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch (e) {}
}

import { createServer } from './server.js';
import { runSeed } from './seed.js';
import { wppConnectService } from './services/wppconnect.service.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

// Seed initial catalog data
try {
    runSeed();
}
catch (err) {
    console.error('Advertencia durante seed:', err);
}

// Start WppConnect real WhatsApp polling
try {
    wppConnectService.startPolling();
} catch (err) {
    console.error('Advertencia iniciando WppConnect polling:', err);
}

const server = createServer();
server.listen(PORT, HOST, () => {
    console.log(`===============================================`);
    console.log(`🚀 ANGIBELL 360 API escuchando en http://${HOST}:${PORT}`);
    console.log(`Endpoints base:`);
    console.log(`• Health:     http://${HOST}:${PORT}/v1/health`);
    console.log(`• QR WhatsApp:http://${HOST}:${PORT}/qr`);
    console.log(`• Simulador:  http://${HOST}:${PORT}/simulator`);
    console.log(`• Catálogo:   http://${HOST}:${PORT}/v1/products`);
    console.log(`• Pedidos:    http://${HOST}:${PORT}/v1/orders`);
    console.log(`• Chatbot:    http://${HOST}:${PORT}/v1/conversations`);
    console.log(`• Admin:      http://${HOST}:${PORT}/v1/admin/products`);
    console.log(`===============================================`);
});

process.on('SIGTERM', () => {
    console.log('Cerrando servidor API...');
    server.close(() => process.exit(0));
});
