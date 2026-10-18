# HackatonUC2026 — ANGIBELL 360 (SORYNTEL)

Plataforma de comercio electrónico con automatización comercial para **Angibell Creaciones** (Huancayo): tienda de prendas para niñas de 0–14 años.

**Objetivo:** publicar una vez, vender por varios canales y gestionar todo desde un solo lugar — con **WhatsApp como centro de operaciones** de la propietaria y panel web de respaldo.

**Recorrido demo (hackathon):** foto por WhatsApp → producto preparado → confirmación de la propietaria → aparece en la tienda → publicación para Meta preparada → cliente conversa con el bot → pedido + enlace de pago de prueba.

## Stack del demo actual

- **Next.js + TypeScript** — tienda virtual y panel administrable
- **API comercial Node.js HTTP** — catálogo, reservas, pedidos, propuestas y pagos simulados. PostgreSQL es la fuente única de datos para la API y la tienda; el servicio actual todavía no está implementado con NestJS.
- **PostgreSQL 17** — catálogo y operaciones comerciales en una sola base, con migraciones de esquema y transacciones de stock.
- **WPPConnect opcional** — puente de demostración; la WhatsApp Cloud API oficial tiene webhook con firma, pero requiere credenciales externas.
- **Facebook/Instagram** — borradores y flujo de aprobación preparados; publicar fuera del demo está desactivado por defecto.
- **Culqi** — aún no conectado; el demo genera pagos simulados.

PostgreSQL y el acceso unificado de la tienda/API ya están implementados y cuentan con pruebas de integración. NestJS y BullMQ siguen en el plan como trabajo pendiente; no se describen como implementados.

## Documentos

- [`PLAN-ANGIBELL360.md`](PLAN-ANGIBELL360.md) — plan técnico completo (v1 + arquitectura v2)
- [`AGENTS.md`](AGENTS.md) — guía para agentes IA que trabajan en este repo

## Equipo

SORYNTEL — Conti MIPYME Hackathon 2026.

## Demo local disponible

La tienda y el motor comercial pueden ejecutarse juntos desde `web/`:

```sh
bash scripts/start-demo.sh
```

La web queda en `http://localhost:3000` y el panel de administración en
`/panel`. La API comercial solo queda accesible desde el propio equipo en
`localhost:4000`. El puente de WhatsApp inicia desactivado. Para respuestas generadas por IA se debe agregar
`OPENROUTER_API_KEY` a `web/.env`; sin esa clave, el proveedor no podrá responder.
El script crea claves locales aleatorias para el panel, Paperclip, PostgreSQL y el cifrado de tokens Meta. Las credenciales se guardan en `web/.env`; no compartir ese archivo.

Al aprobar una publicación en el panel, el producto pasa también al catálogo
del motor comercial, queda preparado un texto para Meta y aparece en el chat de
demo. Las ventas llegan al panel para que Angibell confirme stock, fecha y
envío; solo después se genera el enlace de pago simulado. La publicación externa
requiere activar `META_PUBLISH_ENABLED=true`, credenciales y una URL HTTPS
pública para las imágenes; consulta `web/secrets/README.md`. Culqi real y el
despliegue público todavía requieren integración y verificación.

## Base de contratos v1

Ver [arquitectura](docs/architecture.md), [HTTP](docs/http-api.md),
[modelo y reglas](docs/data-and-rules.md) y [aceptación](docs/acceptance.md).
DTO compartidos: `packages/contracts/src/index.ts`.

Requiere Node 22–26 y pnpm 10.30.3:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
```

La tienda y API descritas arriba comparten PostgreSQL. `apps/api` es una API
Node.js HTTP (aún no NestJS); `web/` consume el catálogo y las operaciones por
esa API. Culqi sigue simulado y la publicación externa de Meta permanece
desactivada hasta configurar credenciales y autorización. No guardar
credenciales en Git.
