import { listProducts, type ProductStatus } from "@/lib/db";
import { toPublicProduct } from "@/lib/public";

export const dynamic = "force-dynamic";

/**
 * GET /api/products — catálogo público (solo publicados por defecto).
 * ?status=publicado|pendiente|rechazado|todos
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "publicado";
  const status = ["publicado", "pendiente", "rechazado"].includes(statusParam)
    ? (statusParam as ProductStatus)
    : undefined;
  const productos = listProducts({ status, limit: 200 }).map(toPublicProduct);
  return Response.json({ productos, total: productos.length });
}
