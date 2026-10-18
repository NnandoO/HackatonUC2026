# ANGIBELL 360 API (prototipo)

El asesor comercial consulta el catálogo real y prepara solicitudes de venta. Para delivery pide distrito, dirección y fecha deseada; la fecha y el costo no se prometen hasta que la administradora los valide.

Flujo de venta por WhatsApp:

1. El cliente elige variante, cantidad y recojo o delivery. `create_order` crea una solicitud `pending` sin reservar stock ni generar pago.
2. La administradora recibe el identificador de la solicitud y puede consultar pendientes con `list_pending_sales` o `GET /v1/admin/sales-requests`.
3. Para aprobar por WhatsApp debe escribir: `APROBAR <ID> fecha YYYY-MM-DD envío S/ 10.00`. En recojo, usar `envío S/ 0.00`. También puede usar `POST /v1/admin/sales-requests/:id/approve` con `{ "deliveryDate": "YYYY-MM-DD", "shippingCents": 1000 }`.
4. La aprobación vuelve a comprobar precio y stock, crea el pedido y la reserva por 15 minutos, registra auditoría y prepara un enlace de **pago de prueba**. Se avisa al cliente por WhatsApp si el envío del mensaje funciona.
5. Si no procede, la administradora usa `reject_sale` o `POST /v1/admin/sales-requests/:id/reject` con `{ "reason": "..." }`.

La API exige identidad administrativa. El panel la llama en la red interna con `ANGIBELL_ADMIN_SERVICE_KEY`; el bot administrativo usa el rol derivado del teléfono autorizado. `SALES_ADMIN_PHONE` define el número al que llegan avisos. `PUBLIC_BASE_URL` debe apuntar a una URL accesible para el enlace de pago **simulado**. El endpoint local de webhook Culqi es solo un simulador y no valida firmas de Culqi; nunca debe exponerse como integración de pagos real. Las reglas definitivas de fechas y tarifas de reparto siguen pendientes.

El bot permanece apagado hasta que se inicie explícitamente el proceso `apps/api/src/main.js`.

El webhook HTTP de WhatsApp Cloud API solo acepta eventos con `X-Hub-Signature-256` válida. Configura `META_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` si vas a usar esa vía. El puente WPPConnect es una integración separada y desactivada por defecto; requiere `WHATSAPP_BRIDGE_ENABLED=true` y una `WPPCONNECT_SECRET_KEY` configurada fuera del repositorio. La publicación externa en Meta requiere además `META_PUBLISH_ENABLED=true`; el demo la mantiene desactivada.
