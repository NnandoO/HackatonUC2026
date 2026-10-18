# Paperclip para desarrollar ANGIBELL 360

Paperclip 2026.1012.0 instalado desde registry.yarnpkg.com, con versión exacta y lockfile local. El registro npm principal no responde desde esta red. Bootstrap conforme al plan maestro; Servidor verificado con health `ok`, panel HTTP 200, cinco agentes y seis tareas creados. Coordinador activado para cerrar contratos.

## Instalar y empezar

Desde un terminal normal de esta PC con acceso a Internet:

```bash
cd /home/blink/hackuc/paperclip-angibell
bash setup.sh --start
```

Instala el paquete oficial `paperclipai@2026.1012.0` desde el registro Yarn en `.runtime`, conserva su versión exacta y lockfile, prepara worktrees, inicia una instancia independiente y crea compañía, cinco agentes y seis tareas. `--start` habilita ejecución por asignación y asigna únicamente la tarea inicial de contratos al coordinador. Abrir http://127.0.0.1:3100. El terminal permanece abierto; Ctrl+C detiene el proceso servidor iniciado por el script.

Para configurar sin iniciar trabajadores: `bash setup.sh`. Para arrancar posteriormente: `python3 provision.py --start`, con el servidor activo. Para reiniciar el servidor ya instalado: `bash start.sh`. Los archivos de estado permiten repetir el aprovisionamiento sin duplicar recursos. El arranque rechaza un puerto 3100 ocupado.

## Organización preparada

| Agente | Rama y worktree | Responsabilidad |
| --- | --- | --- |
| Coordinador | `paperclip/coordinador` · `.state/worktrees/coordinador` | Contratos, andamiaje, asignación, revisión y entrega |
| Backend | `paperclip/backend` · `.state/worktrees/backend` | NestJS, PostgreSQL, inventario, pedidos y auditoría |
| Frontend | `paperclip/frontend` · `.state/worktrees/frontend` | Next.js, tienda, panel e impeccable |
| Integraciones | `paperclip/integraciones` · `.state/worktrees/integraciones` | Asistentes, WhatsApp, Meta, Culqi y colas |
| QA | `paperclip/qa` · `.state/worktrees/qa` | Pruebas, seguridad y guion de demo |

El coordinador debe cerrar contratos antes de asignar código. Las seis tareas y sus dependencias están en tasks.json. Las instrucciones completas de cada rol están en agents/. Los agentes usan el adaptador `codex_local`, sin modelo forzado ni desactivación del sandbox. Requieren que la CLI Codex local esté autenticada; el arranque no lee, copia ni imprime tus credenciales. Paperclip gestiona la autenticación de sus procesos conforme al adaptador instalado.

No se configuró `agy` como Gemini: Antigravity no se presume compatible con `gemini_local`. Todos los roles usan Codex local.

## Aislamiento y revisión

El original `../HackatonUC2026` se conserva. Se clonó localmente el commit `96bdacc` en `.state/repo` y se eliminó su remote para evitar push accidental al original. Los cinco worktrees son escribibles y tienen ramas distintas. No se escribió código de la aplicación.

Los agentes tienen instrucciones de no hacer merge, push, despliegue, pagos reales ni publicaciones externas sin revisión humana. Esas instrucciones no sustituyen permisos del sistema: el sandbox de Codex se mantiene habilitado. La incorporación inicial de contratos por cherry-pick local está delimitada; las ramas de implementación requieren revisión humana antes de integración.

Instancia loopback local_trusted, puerto 3100, base PostgreSQL embebida independiente, datos/secretos/logs en `.state/paperclip`; nunca usa DATABASE_URL del entorno. El presupuesto medido de compañía está limitado a 1000 céntimos USD/mes como freno de emergencia; no garantiza el consumo de suscripción de Codex ni habilita servicios externos. No hay heartbeat periódico: solo activaciones por asignación tras --start. No se crean agentes adicionales sin aprobación del board.

`.state/` tiene permisos 700 y está ignorado junto con `.runtime/`. Contiene datos privados cuando Paperclip se inicia: no publicar ni adjuntar logs completos. No hay exposición LAN ni Cloudflare configurados.

## Verificación realizada

- Clonación local y creación de cinco worktrees desde el plan: verificadas, incluida segunda ejecución sin cambios.
- Sintaxis Bash y compilación Python: verificadas.
- Cuatro tests del aprovisionamiento con API simulada: aprobados (repetición, dependencias, activación inicial, configuración de sandbox/modelo).
- Instalación npm completada: 387 paquetes, versión 2026.1012.0. PostgreSQL embebido reparado mediante su script de enlaces revisado (npm 12 bloqueó su postinstall).
- API real: health ok, compañía, cinco agentes y seis tareas verificados; gobernanza de nuevas altas restablecida tras el bootstrap. Panel responde HTTP 200; no se realizó inspección visual del navegador.
- Test del adaptador Codex ACP: pass; primera ejecución del coordinador observada en estado running. Esto no certifica entrega de contratos ni del producto.
- Servicio transitorio de usuario activo: `angibell-paperclip.service`. No está habilitado para arrancar tras reinicio. Detener con `systemctl --user stop angibell-paperclip.service`. Para reiniciarlo: `systemd-run --user --unit=angibell-paperclip --collect --property=WorkingDirectory=/home/blink/hackuc/paperclip-angibell /bin/bash /home/blink/hackuc/paperclip-angibell/start.sh`.

Si falla la instalación, revisar conectividad y versión Node soportada por el paquete. Si el servidor falla, revisar `.state/server.log` localmente. Si los agentes fallan, revisar el test del adaptador en Paperclip y el estado de login de Codex. No introducir claves en estos archivos.

## Referencias oficiales

- https://github.com/paperclipai/paperclip
- https://github.com/paperclipai/paperclip/blob/master/docs/cli/setup-commands.md
- https://github.com/paperclipai/paperclip/blob/master/docs/adapters/codex-local.md

## Acceso compartido LAN — autorizado sin login

Por instrucción explícita del propietario, el panel se comparte **con permisos completos y sin inicio de sesión** en `http://172.16.5.56:3101`. Toda persona que pueda alcanzar esa dirección LAN puede administrar el orquestador. No se configuró un rol Viewer ni autenticación.

Paperclip conserva el listener local en 127.0.0.1:3100. `share-lan.mjs` proporciona el acceso LAN con proxy HTTP y WebSocket, ligado exclusivamente a 172.16.5.56:3101. Se verificó desde esta PC: panel HTTP 200, health ok, PATCH sin cambio de contenido HTTP 200 y WebSocket de eventos conectado. Falta confirmación de apertura desde la PC del compañero.

Servicio de acceso LAN: `angibell-paperclip-lan.service` (transitorio de usuario). Detener: `systemctl --user stop angibell-paperclip-lan.service`. Recrear tras reinicio:

```bash
systemd-run --user --unit=angibell-paperclip-lan --collect --property=WorkingDirectory=/home/blink/hackuc/paperclip-angibell /usr/bin/node /home/blink/hackuc/paperclip-angibell/share-lan.mjs
```

El servicio principal debe estar activo. Si cambia la IP del Wi-Fi, reiniciar este proxy con PAPERCLIP_LAN_HOST adecuado. No se abrió Cloudflare ni un túnel público.

## PC remota con Antigravity

Solicitada por el propietario; pendiente de IP y usuario SSH de la otra PC. No se ha probado conexión ni creado un agente remoto. Al recibir los datos: comprobar SSH por clave y CLI Antigravity, reservar una rama/workspace remoto separado, validar ejecución headless, y conectar mediante adaptador compatible (por ejemplo process + puente SSH probado). No tratar `agy` como `gemini_local` sin verificar compatibilidad. El dashboard compartido por sí solo no ejecuta agentes en el equipo del visitante.

### Firewall LAN

Se detectó UFW activo con entrada denegada por defecto. Se añadió la regla `allow in on wlp3s0 from 172.16.5.0/24 to 172.16.5.56 port 3101 proto tcp` con comentario `Paperclip ANGIBELL LAN`. Verificada en iptables y panel HTTP 200 desde el host. La prueba desde el host no demuestra conectividad entre estaciones Wi-Fi; confirmar desde la PC del compañero. Revertir con `sudo ufw delete allow in on wlp3s0 from 172.16.5.0/24 to 172.16.5.56 port 3101 proto tcp`.

## Distribución vigente de motores (reemplaza el reparto inicial)

- PM/coordinador: Codex CLI nativa 0.163.0, engine=cli. Revisión de infraestructura SOR-8 completada dentro de Paperclip. ACP quedó descartado por incompatibilidad con la CLI incluida; no se modificó el modelo global del usuario.
- Backend/frontend/integraciones: puente process → Antigravity local. La autenticación por keyring es correcta; las pruebas headless no devolvieron texto antes del límite. No considerar estos workers operativos todavía.
- QA/tareas acotadas: process → OpenCode → NVIDIA Nemotron 3.5 Lightning. Respuesta del proveedor comprobada. La integración de ciclo de tarea aún presenta un rechazo HTTP 403 al registrar el resultado; smoke tests conservados como fallidos/bloqueados. No afirmar validación completa del puente.
- Los workers usan workspaces separados, sin heartbeat periódico. No hay desarrollo del producto completado.
- La tarea de contratos tiene ahora el documento plan adjunto; GET documents/plan devuelve 200.

PC remota: 172.16.5.29, acceso SSH por clave dedicado probado como jhulio. CLI agy instalada en /home/jhulio/.local/bin/agy, repositorio aislado en /home/jhulio/hackuc/angibell-worker/repo y rama paperclip/remote-agy. No se guardó la contraseña proporcionada. El Antigravity activo pertenece al usuario de escritorio nando, mientras SSH entra como jhulio. El agente remoto está pausado hasta resolver el acceso al usuario correcto o autenticar la CLI en jhulio. No se copiaron credenciales entre usuarios.

La pantalla Assistant Connection (MCP) exige instancia autenticada y URL pública HTTPS. No es requisito para ejecutar agentes locales por adaptadores; la instancia sigue intencionalmente sin login y en LAN por instrucción del propietario. No se publicó una URL pública.
