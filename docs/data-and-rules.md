# Modelo y reglas v1

IDs UUID, fechas timestamptz/UTC, dinero entero seguro en céntimos PEN (120 soles = 12000); cantidades enteras positivas, stock >= 0. Límites DTO: nombres 1–120 caracteres, descripción <= 4000, texto <= 4000, 1–50 variantes/producto, 1–20 imágenes HTTPS, 1–50 líneas/pedido, quantity 1–99, precios 1–100000000 céntimos, stock 0–1000000. IDs de variante repetidos en pedido se rechazan. Precio de variante es autoridad; nunca aceptar totales o precios en OrderInput.

Tablas mínimas y restricciones:

| Tabla | Campos / restricciones adicionales a DTO |
|---|---|
| products | id PK, status, version, created_at, updated_at |
| variants | product_id FK, sku UNIQUE, size, color, price_cents, stock_on_hand, stock_reserved, version; CHECK 0 <= reserved <= on_hand; UNIQUE(product_id,size,color) |
| actors / sessions | identidad autenticada, permisos, expiración; token de sesión almacenado hash |
| authorized_admins | actor_id FK, teléfono E.164 único, active; sin gestión por IA |
| orders / order_items | actor_id FK, estado, snapshot SKU/precio/cantidad, total_cents, expires_at; líneas inmutables |
| reservations | order_id + variant_id UNIQUE, quantity, estado active/consumed/released |
| payments | order_id FK, mode, provider_reference UNIQUE por provider/mode, amount_cents, estado |
| webhook_inbox | provider + mode + event_id UNIQUE, payload_hash, processing_status |
| idempotency | actor_id + ruta + key UNIQUE, body_hash, response, estado, expires_at |
| conversations / messages | actor_id, canal y rol derivados del servidor; provider + external_message_id UNIQUE |
| admin_proposals | actor_id, acción y snapshot inmutable, expected_version, expires_at, estado |
| audit_events | actor_id, proposal_id, acción, entity_id, request_id, timestamp, cambios sanitizados; append-only |
| social_drafts / outbox | product/version UNIQUE para preparación; evento, estado, intentos, próxima ejecución |

Reserva: al crear pedido, bloquear variantes en orden UUID con SELECT FOR UPDATE dentro de una transacción. Consultar solo productos publicados y available=on_hand-reserved. Calcular precios/totales en servidor y reservar todo o nada por 15 minutos, con reloj de BD. Pedido y reserva se escriben juntos. Dos compradores por última unidad: solo uno obtiene pedido. set_stock significa stock físico absoluto y rechaza valor menor que reservado; version se incrementa en cada mutación de inventario/precio. Pedido conserva su snapshot aunque cambie catálogo.

Expiración/cancelación: bloquear pedido y reservas, liberar una única vez e incrementar versión de variante. API rechaza pago de pedido vencido incluso si el worker de expiración está retrasado. Webhook de pago y expirador usan el mismo bloqueo y orden de locks (pedido, variantes ordenadas). Pago correcto antes de expirar consume reserva, reduce on_hand y reserved en la misma transacción que paid. Pago tardío tras liberación: registrar incidencia para conciliación humana; NO marcar pedido pagado ni volver a descontar stock ni reembolsar automáticamente.

Pago: crear intento con importe calculado del pedido, modo explícito y referencia; una intención pending por pedido (índice parcial). Reintentos devuelven el mismo intento. La llamada de red ocurre fuera de transacción de inventario; usar idempotencia de proveedor o conciliación antes de reemitir tras resultado incierto. Webhook verificado por adaptador oficial, cuenta/entorno esperados y consulta al proveedor cuando corresponda. Comparar referencia, moneda e importe exactos. No basta un status en JSON ni redirect del navegador. Persistir inbox duradero antes de 202; procesar con transición monotónica e idempotencia. Duplicado válido devuelve 200 sin efectos. Fallido no vuelve succeeded a failed; pagos discordantes van a conciliación. Simulador no acepta eventos por ruta de proveedor ni se habilita en producción. La firma concreta de Culqi se fija con documentación oficial durante integración, antes de declarar sandbox operativo.

Propuestas administrativas: borrador no publicado; confirmar publicación/stock/precio requiere admin autenticado, actor autorizado, propuesta propia pendiente con TTL 5 minutos, acción/snapshot coincidente y versión vigente. Confirmación literal CONFIRM ligada a ID; replay devuelve resultado previo sin duplicar auditoría. Mutación + auditoría + outbox en misma transacción. Cambiar payload requiere nueva propuesta. No hay endpoints de eliminación, reembolso o cuentas bancarias en v1. Meta solo prepara borrador, nunca publica externamente en esta demo.

Idempotencia: toda mutación interna requiere Idempotency-Key UUID; persistir respuesta por actor+ruta durante 24h. Misma clave/cuerpo devuelve respuesta original; distinto cuerpo 409; solicitudes concurrentes se serializan, nunca ejecutan doble. Mensajes y webhooks además deduplican por ID externo, retención de eventos de pago por política de auditoría, nunca eliminarlos por TTL de HTTP. Jobs usan eventId estable, reintento exponencial con jitter máximo 5 veces y dead-letter/acción humana; no reintentos ciegos de cobros.
