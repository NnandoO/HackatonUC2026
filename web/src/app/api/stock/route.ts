import { requireApiKey } from "@/lib/auth";
import { listProducts, setVariantDeclaredStock } from "@/lib/db";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { toPublicProduct } from "@/lib/public";

export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  if (await isPanelAuthenticated()) return true;
  return requireApiKey(req) === null;
}

/**
 * GET /api/stock — stock actual por producto desde PostgreSQL.
 */
export async function GET() {
  const productos = (await listProducts({ status: "publicado", limit: 500 })).map(toPublicProduct);
  return Response.json({ ok: true, motor: "postgresql", productos });
}

/**
 * PATCH /api/stock — ajuste manual del stock por variante (panel de la
 * propietaria con sesión, o Paperclip con API key).
 * Cuerpo: { "updates": [{ "variantId": "uuid", "stock": 4 }] }
 */
export async function PATCH(req: Request) {
  if (!(await authorized(req))) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    updates?: Array<{ variantId?: unknown; stock?: unknown }>;
  };
  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 200) {
    return Response.json(
      { error: "updates es obligatorio: [{ variantId, stock }] (1 a 200)" },
      { status: 400 }
    );
  }
  const lista: Array<{ variantId: string; stock: number }> = [];
  for (const u of updates) {
    const variantId = typeof u.variantId === "string" || typeof u.variantId === "number"
      ? String(u.variantId).trim()
      : "";
    const stock = Number(u.stock);
    if (!variantId || !Number.isInteger(stock) || stock < 0 || stock > 100000) {
      return Response.json(
        { error: "Cada update necesita variantId (string no vacío) y stock (entero ≥ 0)" },
        { status: 400 }
      );
    }
    lista.push({ variantId, stock });
  }
  try {
    for (const u of lista) {
      await setVariantDeclaredStock(u.variantId, u.stock);
    }
  } catch (error) {
    return Response.json(
      {
        error: `No se pudo actualizar el stock en el motor comercial: ${
          error instanceof Error ? error.message : "error desconocido"
        }`,
      },
      { status: 502 }
    );
  }
  return Response.json({ ok: true, actualizadas: lista.length });
}
