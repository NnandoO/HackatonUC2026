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

`apps/web` y `apps/api` están reservados para los especialistas; esta base no
arranca tienda, API ni infraestructura. PostgreSQL y Redis se configurarán en
la entrega backend, sin credenciales en Git. La demo será simulada por defecto.
La incorporación local del commit inicial está autorizada; integrar ramas de
implementación, publicar o desplegar requiere revisión humana SORYNTEL.
