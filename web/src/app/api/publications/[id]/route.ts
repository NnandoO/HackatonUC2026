import { requireApiKey } from "@/lib/auth";
import { getProductById } from "@/lib/db";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { toPublicProduct } from "@/lib/public";
import { approveProduct, rejectProduct } from "@/lib/flow";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await params;
  const product = getProductById(Number(id));
  if (!product) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ producto: toPublicProduct(product) });
}

/**
 * PATCH /api/publications/:id — Paperclip puede aprobar o rechazar (opcional).
 * Cuerpo: { "action": "aprobar" | "rechazar" }
 */
export async function PATCH(req: Request, { params }: Params) {
  const denied = (await isPanelAuthenticated()) ? null : requireApiKey(req);
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? "";
  if (!["aprobar", "rechazar"].includes(action)) {
    return Response.json({ error: 'action debe ser "aprobar" o "rechazar"' }, { status: 400 });
  }
  const product = getProductById(Number(id));
  if (!product) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (action === "rechazar") {
    return Response.json({ producto: toPublicProduct(rejectProduct(product.id)) });
  }
  const outcome = await approveProduct(product.id);
  return Response.json({
    producto: toPublicProduct(outcome.product),
    almacen: outcome.sync ?? { estado: "no_configurado", aviso: outcome.aviso },
  });
}
