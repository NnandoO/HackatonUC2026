# HackatonUC2026 — ANGIBELL 360 (SORYNTEL)

Plataforma de comercio electrónico con automatización comercial para **Angibell Creaciones** (Huancayo): tienda de prendas para niñas de 0–14 años.

**Objetivo:** publicar una vez, vender por varios canales y gestionar todo desde un solo lugar — con **WhatsApp como centro de operaciones** de la propietaria y panel web de respaldo.

**Recorrido demo (hackathon):** foto por WhatsApp → producto preparado → confirmación de la propietaria → aparece en la tienda → publicación para Meta preparada → cliente conversa con el bot → pedido + enlace de pago de prueba.

## Stack

- **Next.js + TypeScript** — tienda virtual y panel administrable
- **NestJS + TypeScript** — servicios comerciales (precios, inventario, pedidos, pagos)
- **PostgreSQL** — datos de negocio
- **BullMQ** — colas y trabajos en segundo plano
- **WhatsApp Cloud API (Meta)** — asistentes administrativo y comercial
- **Meta API** — catálogo y publicaciones · **Culqi** — pagos
- **Docker + AWS Lightsail + Cloudflare** — despliegue, DNS y protección

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
El script crea claves locales aleatorias; consulta `web/.env` para iniciar sesión
en el panel y para integrar Paperclip.

Al aprobar una publicación en el panel, el producto pasa también al catálogo
del motor comercial, queda preparado un texto para Meta y aparece en el chat de
demo. Las ventas llegan al panel para que Angibell confirme stock, fecha y
envío; solo después se genera el enlace de pago simulado. La publicación real
en Facebook e Instagram necesita las credenciales respectivas, los IDs de la
Página/cuenta y una URL HTTPS pública para las imágenes; consulta
`web/secrets/README.md`. Cada publicación exige aprobación expresa en el panel.
Culqi real y el despliegue público todavía requieren configuración externa.

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
La base técnica de producción sigue definiendo PostgreSQL y Redis como destino;
este arranque local usa almacenamiento SQLite y servicios simulados. No guardar
credenciales en Git. Integrar ramas, publicar o desplegar requiere revisión
humana SORYNTEL.
