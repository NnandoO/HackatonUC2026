# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Implementación actual: Next.js + TypeScript para tienda/panel, PostgreSQL 17 como fuente única de datos y API comercial Node.js HTTP. La tienda consulta y actualiza el catálogo mediante la API; reservas, pedidos, publicaciones y aprobaciones usan la misma base transaccional. La API todavía no está implementada con NestJS y BullMQ no está integrado.

## Users

- **Propietaria de Angibell Creaciones** (Huancayo, Perú): registra y publica prendas, aprueba publicaciones y controla el stock. Su centro de operación es WhatsApp; este panel es su respaldo web.
- **Clientas**: madres, padres y familiares que compran ropa de niñas 0–14; navegan desde el celular.
- **Jurado del hackathon** y equipo SORYNTEL: recorren catálogo → publicación entrante de Paperclip → aprobación → tienda y bot comercial.

## Product Purpose

Página de comercio de Angibell Creaciones: catálogo de prendas para niñas 0–14, recepción de publicaciones por API, aprobación humana y conexión al motor comercial local. Éxito = la demo muestra el recorrido completo y separa claramente los datos del demo de las integraciones de producción.

## Positioning

Un catálogo vivo conectado a un motor comercial de demostración: la propietaria aprueba productos, el backend valida precio e inventario y prepara borradores de Meta. Paperclip puede aportar publicaciones, pero no autoriza su publicación externa.

## Operating Context

- Hackathon Conti MIPYME 2026 (SORYNTEL); la demo cierra el domingo.
- Todo corre local en Docker (página + API + PostgreSQL); no requiere ERPNext.
- Paperclip (equipo de agentes Codex de la PC del equipo) se conecta por HTTP con `X-API-Key` para subir publicaciones.
- Las fotos reales de productos llegarán por lotes de 4 durante el desarrollo; hasta entonces hay material sintético etiquetado.
- Precios en soles (PEN), guardados en céntimos. Pagos reales fuera del alcance de la demo.

## Capabilities and Constraints

- Catálogo con variantes por talla, stock por variante, fotos, descripción y precio.
- Publicaciones entrantes con estado pendiente → aprobar/rechazar en el panel; log de auditoría de cada entrada.
- Stock por variantes, reservas de venta y pagos simulados en PostgreSQL compartido por API y tienda.
- La IA interpreta; el sistema valida. Sin pagos reales; la publicación externa en Meta queda desactivada por defecto.
- Sin push, merge ni despliegue sin revisión humana (regla del plan v2).

## Brand Commitments

- Nombre: **Angibell Creaciones**.
- Logo en **rosa pastel y crema pastel**: la página continúa esos tonos por mandato explícito del usuario.
- Público familiar; tono cálido, honesto y sin claims no verificados (lo sintético se etiqueta).

## Evidence on Hand

- `PLAN-ANGIBELL360.md` v2 en la raíz del repo (arquitectura, costos, alcance hackathon).
- Bootstrap de Paperclip (`paperclip-angibell/`) preparado por el equipo en la PC remota.
- Fotos reales de prendas: pendientes (llegan en lotes de 4); hasta entonces, placeholders sintéticos claramente etiquetados.

## Product Principles

1. Aprobar antes de publicar: la revisión de la propietaria es una función, no un obstáculo.
2. Ningún dato inventado: sin stock o foto real, se declara la ausencia o el material sintético.
3. La IA propone; el sistema valida (precios, stock, permisos) y todo queda auditado.
4. Un solo comando levanta PostgreSQL, la tienda y API del demo; servicios externos siguen siendo opcionales.
5. El backend comercial valida reservas y pedidos; la página presenta el catálogo y el panel.

## Accessibility & Inclusion

Las clientas navegan desde el celular: la tienda debe ser usable en pantallas pequeñas, con lenguaje claro en español y buen contraste.
