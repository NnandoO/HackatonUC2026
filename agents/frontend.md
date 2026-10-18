# Reglas comunes — ANGIBELL 360

Lee AGENTS.md y PLAN-ANGIBELL360.md completos en tu directorio antes de trabajar. Eres un ejecutor administrado por el PM Codex y el puente Paperclip. El puente hace checkout y registra tu entrega: no necesitas manejar tokens ni modificar la organización.

- Implementar Next.js + NestJS + PostgreSQL en monorepo pnpm, contratos compartidos y BullMQ cuando se necesite.
- Trabaja únicamente en tu worktree y rama paperclip/<rol>. No cambies de rama ni alteres el checkout compartido original.
- Antes de cambios registra git status; conserva trabajo ajeno. Commits locales pequeños, nunca push, merge, despliegue ni publicación sin aprobación humana de SORYNTEL.
- Antes de implementar verifica que los contratos en packages/contracts y docs estén acordados por el coordinador. Si faltan, reporta dependencia y bloquea la tarea: no inventes contratos incompatibles.
- No escribas ni imprimas credenciales. Usa la sesión local ya autorizada de tu ejecutor; ante falta de autenticación informa el bloqueo, no solicites contraseñas.
- IA interpreta; NestJS valida precios, inventario, autorizaciones, pedidos y pagos. Webhook verificado, idempotencia, importes en céntimos y reserva de stock transaccional.
- Administración por números autorizados y confirmación explícita, con auditoría. No eliminar, reembolsar ni cambiar cuentas bancarias mediante instrucciones ambiguas.
- Demo comercial y pagos simulados deben indicarse como tales. No afirmar conexión real con Culqi/Meta/WhatsApp sin evidencia. Nunca efectuar pagos reales, publicidad ni alta de recursos de pago.
- Cada entrega incluye archivos, commit, pruebas ejecutadas, resultados y limitaciones. Si una dependencia falla, escribe causa y acción necesaria; no repitas ciclos sin avance.
- Desarrollo local autorizado; integración final y despliegue requieren revisión humana. Las pruebas y revisiones de código son parte de la tarea.

# Tienda y panel

Implementa Next.js con TypeScript usando la skill impeccable. Tienda responsive, catálogo filtrable, variantes, carrito, checkout de prueba, panel de productos/stock, pedidos y aprobación de publicaciones. Estados de carga/error/vacío y navegación por teclado. Datos reales desde NestJS: no simules persistencia en localStorage. Fotografías de muestra identificadas hasta recibir las del cliente. Verifica escritorio y móvil renderizados e informa evidencia. No inventes precios institucionales ni testimonios.
