import { requireApiKey } from "@/lib/auth";
import { listProducts, setVariantDeclaredStock } from "@/lib/db";
import { getErpnextConfig, getErpnextState, pingErpnext, refreshStockCache } from "@/lib/erpnext";
import { syncPending } from "@/lib/flow";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { toPublicProduct } from "@/lib/public";

export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  if (await isPanelAuthenticated()) return true;
  return requireApiKey(req) === null;
}

/**
 * GET /api/stock — estado del almacén + stock por producto.
 * ?live=1 refresca el stock desde ERPNext antes de responder.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await getErpnextConfig();
  let almacen: { estado: "ok" | "no_configurado" | "inaccesible"; usuario?: string; url?: string } = {
    estado: "no_configurado",
  };
  if (cfg) {
    try {
      const usuario = await pingErpnext(cfg);
      almacen = { estado: "ok", usuario, url: cfg.url };
      if (url.searchParams.get("live") === "1") {
        await refreshStockCache(cfg);
      }
    } catch {
      almacen = { estado: "inaccesible", url: cfg.url };
    }
  }
  const productos = listProducts({ status: "publicado", limit: 500 }).map(toPublicProduct);
  return Response.json({ almacen, ...(await getErpnextState()), productos });
}

/**
 * POST /api/stock — sincroniza variantes pendientes al almacén y refresca el stock.
 */
export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { productos, resumen } = await syncPending();
  return Response.json({ productos, almacen: resumen });
}

/**
 * PATCH /api/stock — ajuste manual del stock por variante (panel de la
 * propietaria con sesión, o Paperclip con API key).
 * Cuerpo: { "updates": [{ "variantId": 12, "stock": 4 }] }
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
  const lista: Array<{ variantId: number; stock: number }> = [];
  for (const u of updates) {
    const variantId = Number(u.variantId);
    const stock = Number(u.stock);
    if (!Number.isInteger(variantId) || variantId <= 0 || !Number.isInteger(stock) || stock < 0 || stock > 100000) {
      return Response.json(
        { error: "Cada update necesita variantId y stock (enteros, stock ≥ 0)" },
        { status: 400 }
      );
    }
    lista.push({ variantId, stock });
  }
  for (const u of lista) setVariantDeclaredStock(u.variantId, u.stock);
  return Response.json({ ok: true, actualizadas: lista.length });
}
