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
