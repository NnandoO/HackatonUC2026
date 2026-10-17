# Almacén de Angibell 360 (Frappe/ERPNext)

El control de almacén corre sobre **ERPNext v16** en Docker (compose oficial de `frappe_docker`, adaptado).

## Levantarlo

Desde `web/`:

```bash
docker compose up -d frontend web        # página + almacén
docker compose logs -f create-site       # la primera vez tarda varios minutos
```

- Desk (UI de Frappe para el almacén): http://localhost:8080 — sitio `angibell360`, usuario `Administrator`, contraseña `admin`.
- Página: http://localhost:3000

> La primera ejecución crea la base MariaDB, configura el sitio e instala ERPNext. Requiere buena conexión: descarga imágenes de varios GB.

## Conectar la página con el almacén

En la página, entra a **/panel → Almacén → Conectar almacén** e ingresa:

- URL: `http://localhost:8080` (o `http://frontend:8080` desde dentro de Docker)
- Usuario: `Administrator`
- Contraseña: `admin`

La página genera las API keys, las guarda (solo en tu equipo) y prepara lo mínimo: compañía, almacén, UOM y grupo de artículos. Si prefieres hacerlo a mano:

```bash
bash erpnext/bootstrap.sh   # imprime API key/secret para pegar en .env
```

## Cómo se refleja el stock

1. Paperclip (o el panel) registra una publicación con tallas y stock declarado.
2. Al **aprobar**, la página crea un artículo por talla en ERPNext y registra una Recepción de material (Stock Entry) con el stock declarado.
3. El panel y la tienda muestran el **stock real del ERP** (Bin/actual_qty). Si ERPNext no responde, se muestra el último stock conocido y se declara.

## Notas

- Datos del ERP en volúmenes Docker (`sites`, `db-data`): sobreviven a reinicios. Para borrar todo: `docker compose down -v`.
- No se exponen puertos más allá de 8080 (ERPNext) y 3000 (página). No hay despliegue público todavía.
