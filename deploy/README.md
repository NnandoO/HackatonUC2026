# Preparación de producción de ANGIBELL 360

`compose.production.yml` define únicamente PostgreSQL, la API y la tienda. No
incluye ERPNext. El contenedor `angibell-cloudflared` está instalado por separado
en el EC2 y unido a la red Docker externa `angibell`.

## Estado y condición de arranque

La migración de API y tienda a PostgreSQL unificado (sin SQLite ni ERPNext) ya
está integrada y verificada con la suite de pruebas transaccionales y E2E. La
configuración del túnel apunta a `http://angibell-web:3000`.

## Variables

Crear `deploy/.env.production` a partir de `deploy/env.production.example`,
rellenar valores únicos y protegerlo con permisos `0600`. No guardar ese archivo
ni credenciales dentro del repositorio. `DATABASE_URL` debe usar la misma base
que las variables `POSTGRES_*`; codificar los caracteres reservados de la
contraseña para URL.

Los archivos de tokens Meta se montan desde `deploy/secrets/` y no deben
versionarse. Mantener desactivado `META_PUBLISH_ENABLED` hasta verificar la
autorización y publicación real desde el panel.

## Requisitos antes de publicar

1. Crear o verificar el CNAME proxied de `angibell.soryntel.com` hacia el túnel.
   El token Wrangler disponible no tiene permisos de lectura/escritura DNS.
2. Proteger y respaldar PostgreSQL antes de ingresar datos reales.

Cuando los requisitos estén verificados, desplegar desde la raíz del repo con:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

Verificar después `/api/health`, `/v1/health`, acceso a catálogo, reserva y
liberación de stock, y callback OAuth de Meta. El servicio de base de datos no
publica un puerto al host.
