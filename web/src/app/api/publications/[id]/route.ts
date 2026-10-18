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
  const product = await getProductById(id);
  if (!product) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ producto: toPublicProduct(product) });
}

/**
 * PATCH /api/publications/:id — aprobar o rechazar una publicación pendiente.
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
  const product = await getProductById(id);
  if (!product) return Response.json({ error: "No encontrado" }, { status: 404 });
  try {
    if (action === "rechazar") {
      const rejected = await rejectProduct(product.id);
      return Response.json({ producto: toPublicProduct(rejected) });
    }
    const outcome = await approveProduct(product.id);
    return Response.json({
      producto: toPublicProduct(outcome.product),
    });
  } catch (error) {
    return Response.json(
      {
        error: `No se pudo actualizar la publicación: ${
          error instanceof Error ? error.message : "error desconocido"
        }`,
      },
      { status: 502 }
    );
  }
}
