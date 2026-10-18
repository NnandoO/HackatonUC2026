# HTTP v1

Este documento define el contrato objetivo; no es un inventario de rutas actualmente implementadas. La API del demo está descrita en `apps/api/README.md`. En particular, el simulador Culqi actual no valida firma y no puede usarse como pago real.

JSON UTF-8; DTO de packages/contracts/src/index.ts es fuente de nombres y estados. Respuestas directas, errores ApiError; requestId generado por servidor. UUID y fechas se validan; precios no usan floats. Listados Page<T>, limit 1–50 (default 20), cursor opaco por createdAt/id, nextCursor null al terminar. CORS solo origen web autorizado. Idempotency-Key obligatorio en POST internos (incluye mensajes); webhooks usan IDs externos. Sesiones: public=lectura catálogo; customer=sesión opaca vinculada; admin=sesión y permiso de administrador. Todos los recursos privados se filtran por actor, 404 para recurso ajeno.

| Método/ruta | Acceso | Entrada | Éxito |
|---|---|---|---|
| GET /v1/health | público | — | 200 {status:'ok',mode:'simulated'\|'sandbox'\|'live'} sin secretos |
| POST /v1/sessions | público, rate limit | {} | 201 cookie de sesión customer; {expiresAt:Instant} |
| GET /v1/products | público | ?limit&cursor | 200 Page<Product> solo published |
| GET /v1/products/:id | público | — | 200 Product publicado |
| POST /v1/admin/products | admin | ProductInput | 201 Product draft; auditoría, nunca publicar |
| GET /v1/admin/products | admin | ?limit&cursor | 200 Page<Product> drafts incluidos |
| POST /v1/admin/proposals | admin | AdminAction | 201 Proposal |
| POST /v1/admin/proposals/:id/confirm | admin + actor autorizado | ConfirmInput | 200 {proposal:Proposal,product:Product,socialDraft:SocialDraft\|null} |
| POST /v1/orders | customer | OrderInput | 201 Order con reserva |
| GET /v1/orders/:id | propietario customer/admin | — | 200 Order |
| GET /v1/admin/orders | admin | ?limit&cursor | 200 Page<Order> |
| POST /v1/orders/:id/payments | propietario customer | {} | 201 Payment, modo visible |
| GET /v1/orders/:id/payment | propietario customer/admin | — | 200 Payment más reciente, 404 si no existe |
| POST /v1/conversations | customer/admin | {} | 201 {id:Id,channel:'web'\|'demo'} determinado por servidor |
| POST /v1/conversations/:id/messages | propietario | MessageInput | 201 MessageResult; propuesta nunca autoejecutada |
| GET /v1/admin/social-drafts | admin | ?limit&cursor | 200 Page<SocialDraft> |
| GET /v1/webhooks/whatsapp | Meta | parámetros oficiales de desafío | 200 desafío solo con token verificado; 403 si inválido |
| POST /v1/webhooks/whatsapp | firma Meta verificada | raw bytes oficiales | 202 {received:true}; duplicado 200 |
| POST /v1/webhooks/culqi | adaptador Culqi verificado | raw bytes oficiales | Objetivo futuro; el endpoint actual solo simula pagos y no acepta firma oficial |

Admin panel no dispone de login ficticio público: sesión admin provisionada localmente por operador hasta implementar autenticación revisada. Adaptador WhatsApp crea conversaciones internas según remitente verificado; no usa role del mensaje. Mensaje administrativo con foto prepara ProductInput para validación y creación de draft por herramienta autorizada; luego Proposal publish_product. Cliente no puede acceder a herramientas admin. Imagen pendiente/ambigua o pedido a medida produce handoff=true. MessageResult.orderId solo tras confirmación explícita del cliente y creación por backend; mensajes de IA no acreditan pago.

Códigos: 400 INVALID_INPUT (incluye falta de Idempotency-Key), 401 UNAUTHORIZED, 403 FORBIDDEN (incluye firma inválida), 404 NOT_FOUND, 409 CONFLICT/OUT_OF_STOCK (version o key conflictiva), 410 EXPIRED, 429 RATE_LIMITED con Retry-After, 503 PROVIDER_UNAVAILABLE. No filtrar payload sensible en errores. Headers request ID y cookies se implementan en backend, no en contratos de navegador.

Eventos externos tienen esquema propio de proveedor: NO inventar envoltorio común de firma. Adaptadores convierten bytes validados a eventos internos y separan simulación de rutas públicas. Hasta fijar verificación oficial, endpoint externo responde 503 sin aceptar pagos. Simulación usa fixture/herramienta local de QA fuera de producción, sin endpoint público que permita marcar paid.
