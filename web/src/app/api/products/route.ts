import { requireApiKey } from "@/lib/auth";
import { listProducts, type ProductStatus } from "@/lib/db";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { toPublicProduct } from "@/lib/public";

export const dynamic = "force-dynamic";

/**
 * GET /api/products — catálogo público (solo publicados por defecto).
 * ?status=publicado|pendiente|rechazado|todos
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "publicado";
  if (statusParam !== "publicado") {
    const panelAuthed = await isPanelAuthenticated();
    if (!panelAuthed) {
      const denied = requireApiKey(req);
      if (denied) return denied;
    }
  }
  const status = ["publicado", "pendiente", "rechazado"].includes(statusParam)
    ? (statusParam as ProductStatus)
    : undefined;
  const productos = (await listProducts({ status, limit: 200 })).map(toPublicProduct);
  return Response.json({ productos, total: productos.length });
}
