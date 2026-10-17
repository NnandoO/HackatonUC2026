# Guía para agentes IA — ANGIBELL 360

Este repositorio es el proyecto **ANGIBELL 360** de SORYNTEL (Conti MIPYME Hackathon 2026). Antes de tocar código, lee [`PLAN-ANGIBELL360.md`](PLAN-ANGIBELL360.md) completo.

## Contexto esencial

- Cliente: **Angibell Creaciones** (Huancayo) — tienda de prendas para niñas de 0–14 años; público: padres de familia.
- Objetivo: publicar una vez, vender por varios canales, gestionar desde un solo lugar. **WhatsApp es el centro de administración**; el panel web es respaldo.
- Recorrido demo: foto por WhatsApp → producto preparado → confirmación → tienda → publicación Meta preparada → bot comercial → pedido + enlace de pago (prueba).

## Stack y reglas de arquitectura

- Next.js + TS (tienda/panel) · NestJS + TS (núcleo comercial) · PostgreSQL · BullMQ (colas).
- WhatsApp Cloud API oficial de Meta; Meta API para catálogo/publicaciones; Culqi para pagos.
- **La IA interpreta; NestJS valida y ejecuta.** El modelo nunca decide precios, stock, pedidos ni pagos por sí solo.
- El dinero no lo maneja la IA: el pago lo confirma el webhook de la pasarela; el backend verifica y recién confirma el pedido.

## Reglas de trabajo para agentes

1. **Tareas delimitadas** y ramas separadas por agente (`feat/frontend-…`, `feat/backend-…`, `feat/whatsapp-…`, `qa/…`). No trabajar dos agentes sobre la misma rama.
2. **Contratos de API y modelos de datos primero** (productos, variantes, pedidos, pagos, mensajes); sin contratos cerrados no se paraleliza.
3. PRs pequeños; **revisión humana de SORYNTEL** antes de integrar o desplegar.
4. Commits claros en español o inglés, sin secretos ni credenciales en el repo.

## Seguridad no negociable

- Órdenes administrativas solo desde **números autorizados** + confirmación explícita + registro de auditoría.
- Prohibido por instrucción ambigua: reembolsos, cambios de datos bancarios, eliminar productos, cambiar precios.
- No confiar solo en que el modelo interprete la identidad del usuario.

## Diseño y frontend

- Usar la skill **impeccable** para cualquier trabajo de UI (tienda, panel, landing):
  - Codex: `$impeccable` · Antigravity: `/impeccable` · opencode: `/impeccable`.
- Evitar anti-patrones (Inter/Arial por defecto, gradientes púrpura, tarjetas anidadas, texto gris sobre color).
- Verificar siempre el resultado renderizado antes de dar algo por terminado.
