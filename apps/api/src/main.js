import { createServer } from './server.js';
import { runSeed } from './seed.js';
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';
// Seed initial catalog data
try {
    runSeed();
}
catch (err) {
    console.error('Advertencia durante seed:', err);
}
const server = createServer();
server.listen(PORT, HOST, () => {
    console.log(`===============================================`);
    console.log(`🚀 ANGIBELL 360 API escuchando en http://${HOST}:${PORT}`);
    console.log(`Endpoints base:`);
    console.log(`• Health:     http://${HOST}:${PORT}/v1/health`);
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
