import { setSetting } from "@/lib/db";
import { connectErpnext, ensureStockSetup, pingErpnext } from "@/lib/erpnext";
import { isPanelAuthenticated } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/erpnext/connect — conecta la página con el almacén (solo panel).
 * Cuerpo: { "url": "http://localhost:8080", "usr": "Administrator", "pwd": "admin" }
 */
export async function POST(req: Request) {
  if (!(await isPanelAuthenticated())) {
    return Response.json({ error: "Solo desde el panel" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    usr?: string;
    pwd?: string;
    urlErp?: string;
  };
  const url = String(body.url ?? body.urlErp ?? "").trim();
  const usr = String(body.usr ?? "").trim();
  const pwd = String(body.pwd ?? "");
  if (!url || !usr || !pwd) {
    return Response.json({ error: "Faltan datos: url, usr y pwd" }, { status: 400 });
  }
  try {
    const cfg = await connectErpnext(url, usr, pwd);
    const usuario = await pingErpnext(cfg);
    const state = await ensureStockSetup(cfg);
    setSetting("erpnext", { url: cfg.url, apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, ...state });
    return Response.json({ ok: true, usuario, ...state });
  } catch (e) {
    return Response.json(
      { error: String(e instanceof Error ? e.message : e).slice(0, 300) },
      { status: 502 }
    );
  }
}
