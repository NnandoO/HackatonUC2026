# HackatonUC2026 — ANGIBELL 360 (SORYNTEL)

Plataforma de comercio electrónico con automatización comercial para **Angibell Creaciones** (Huancayo): tienda de prendas para niñas de 0–14 años.

**Objetivo:** publicar una vez, vender por varios canales y gestionar todo desde un solo lugar — con **WhatsApp como centro de operaciones** de la propietaria y panel web de respaldo.

**Recorrido demo (hackathon):** foto por WhatsApp → producto preparado → confirmación de la propietaria → aparece en la tienda → publicación para Meta preparada → cliente conversa con el bot → pedido + enlace de pago de prueba.

## Stack del demo actual

- **Next.js + TypeScript** — tienda virtual y panel administrable
- **API Node.js HTTP + `node:sqlite`** — catálogo comercial, reservas, pedidos, propuestas y pagos simulados; no es NestJS ni PostgreSQL.
- **SQLite** — datos persistentes del demo. La tienda conserva su propio catálogo local y sincroniza productos/stock aprobados con la API comercial.
- **ERPNext v16 opcional** — almacén de respaldo levantado por separado; no comparte transacciones de reservas con la API comercial.
- **WPPConnect opcional** — puente de demostración; la WhatsApp Cloud API oficial tiene webhook con firma, pero requiere credenciales externas.
- **Facebook/Instagram** — borradores y flujo de aprobación preparados; publicar fuera del demo está desactivado por defecto.
- **Culqi** — aún no conectado; el demo genera pagos simulados.

El destino de producción definido por el plan sigue siendo Next.js + NestJS + PostgreSQL + BullMQ. No se debe describir como implementado hasta migrar y verificar esos componentes.

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

La web queda en `http://localhost:3000`; el chat de demostración está en
`/simulator` y el panel de administración en `/panel`. La API comercial solo
queda accesible desde el propio equipo en `localhost:4000`. El puente de
WhatsApp inicia desactivado. Para respuestas generadas por IA se debe agregar
`OPENROUTER_API_KEY` a `web/.env`; sin esa clave, el proveedor no podrá responder.
El script crea claves locales aleatorias para el panel, Paperclip y el ERP. Las credenciales se guardan en `web/.env`; no compartir ese archivo.

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

La tienda y API de demostración descritas arriba ya pueden ejecutarse juntas.
`apps/api` es un prototipo Node.js con SQLite; `web/` usa SQLite para su propio
catálogo. El plan de producción mantiene NestJS, PostgreSQL y Redis como destino.
No guardar credenciales en Git. La integración local se hace en una rama
revisable; no implica push ni despliegue.
