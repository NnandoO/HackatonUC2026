# Tokens locales de Meta

Crear los archivos `meta-instagram-token` y `meta-facebook-page-token` en esta
carpeta con permisos `600`. Cada archivo debe contener únicamente el token
correspondiente, sin comillas. Esta carpeta se monta como solo lectura dentro de
la API y los tokens no se incluyen en Git.

Configurar `META_INSTAGRAM_USER_ID` y `META_FACEBOOK_PAGE_ID` en `web/.env`.
Para publicar fotos, `PUBLIC_BASE_URL` también debe ser una URL HTTPS pública
que permita a Meta descargar las imágenes del backend.
