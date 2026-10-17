# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegado por el plan maestro (`PLAN-ANGIBELL360.md` v2): Next.js (App Router) + React + TypeScript + Tailwind para tienda y panel. Frappe/ERPNext v16 en Docker **solo para el control de almacén** (decisión explícita del usuario): la página nunca renderiza con tecnología Frappe; el ERP es el motor de inventario detrás de la API. SQLite local para catálogo y publicaciones; un solo Docker Compose levanta página + almacén.

## Users

- **Propietaria de Angibell Creaciones** (Huancayo, Perú): registra y publica prendas, aprueba publicaciones y controla el stock. Su centro de operación es WhatsApp; este panel es su respaldo web.
- **Clientas**: madres, padres y familiares que compran ropa de niñas 0–14; navegan desde el celular.
- **Jurado del hackathon** (demo del domingo) y equipo SORYNTEL: recorren catálogo → publicación entrante de Paperclip → aprobación → almacén.

## Product Purpose

Página de comercio de Angibell Creaciones: catálogo completo de prendas para niñas 0–14, recepción de nuevas publicaciones subidas por Paperclip vía API, aprobación humana de la propietaria y control de almacén real sobre ERPNext. Éxito = la demo del domingo muestra ese recorrido completo sin promesas falsas.

## Positioning

Un catálogo vivo conectado a un almacén real: cada prenda existe como artículo con stock verificable en ERPNext, y los agentes (Paperclip) alimentan publicaciones que la propietaria aprueba. Ni el modelo ni la página deciden precios o stock; el sistema valida y audita.

## Operating Context

- Hackathon Conti MIPYME 2026 (SORYNTEL); la demo cierra el domingo.
- Todo corre en Docker local (página + ERPNext); sin despliegue público todavía.
- Paperclip (equipo de agentes Codex de la PC del equipo) se conecta por HTTP con `X-API-Key` para subir publicaciones.
- Las fotos reales de productos llegarán por lotes de 4 durante el desarrollo; hasta entonces hay material sintético etiquetado.
- Precios en soles (PEN), guardados en céntimos. Pagos reales fuera del alcance de la demo.

## Capabilities and Constraints

- Catálogo con variantes por talla, stock por variante, fotos, descripción y precio.
- Publicaciones entrantes con estado pendiente → aprobar/rechazar en el panel; log de auditoría de cada entrada.
- Control de almacén en ERPNext (artículos, recepciones de material, disponibilidad); si el ERP no responde, la página usa el último stock conocido y lo declara.
- La IA interpreta; el sistema valida. Sin pagos reales ni publicación externa automática.
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
4. Un solo comando levanta todo (Docker Compose); la demo no depende de pasos manuales frágiles.
5. El almacén es la verdad operativa; la página es la vitrina.

## Accessibility & Inclusion

Las clientas navegan desde el celular: la tienda debe ser usable en pantallas pequeñas, con lenguaje claro en español y buen contraste.
