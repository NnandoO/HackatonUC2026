# Tokens locales de Meta

Crear los archivos `meta-instagram-token` y `meta-facebook-page-token` en esta
carpeta con permisos `600`. Cada archivo debe contener únicamente el token
correspondiente, sin comillas. Esta carpeta se monta como solo lectura dentro de
la API y los tokens no se incluyen en Git.

Instagram conserva la configuración manual: `META_INSTAGRAM_USER_ID` y su token en `web/secrets`.

Facebook se conecta desde **Panel → Publicaciones → Conectar Facebook**. Configura `META_APP_ID`, `META_APP_SECRET` y `META_OAUTH_REDIRECT_URI` en `web/.env`, registra esa URL como URI OAuth válida en la app de Meta y habilita Facebook Login. Solicita `pages_show_list`, `pages_read_engagement` y `pages_manage_posts`. `META_TOKEN_ENCRYPTION_KEY` se genera al iniciar el demo y cifra el token de Página con AES-256-GCM en SQLite. No compartas ni subas `web/.env`.

El backend recibe el callback OAuth en `/v1/admin/meta/facebook/oauth/callback`. Registra `https://<túnel-cloudflare>/v1/admin/meta/facebook/oauth/callback` en Meta y asigna esa misma URL a `META_OAUTH_REDIRECT_URI`. `META_PANEL_RETURN_URL` apunta al panel visible por el navegador (localmente, `http://localhost:3002/panel`). La conexión no habilita la publicación: revisa `META_PUBLISH_ENABLED` y `PUBLIC_MEDIA_BASE_URL` por separado. En modo desarrollo de Meta solo podrán autorizar usuarios con rol en la app; uso por terceros puede requerir revisión de permisos.
Para publicar fotos, `PUBLIC_MEDIA_BASE_URL` debe ser una URL HTTPS pública
que permita a Meta descargar las imágenes del backend.
