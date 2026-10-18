import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Protege los endpoints que usa Paperclip para subir publicaciones.
 * Devuelve null si la petición está autorizada; si no, una respuesta de error.
 */
export function requireApiKey(req: Request): Response | null {
  const expected = process.env.PAPERCLIP_API_KEY?.trim() || process.env.ANGIBELL_ADMIN_SERVICE_KEY?.trim();
  if (!expected) {
    return Response.json(
      { error: "Falta configurar PAPERCLIP_API_KEY o ANGIBELL_ADMIN_SERVICE_KEY en el entorno de la página" },
      { status: 503 }
    );
  }
  const given =
    req.headers.get("x-api-key") ??
    req.headers.get("x-angibell-admin-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";
  if (given && safeEqual(given, expected)) return null;
  return Response.json(
    { error: "No autorizado", pista: "Envía la cabecera X-API-Key" },
    { status: 401 }
  );
}
