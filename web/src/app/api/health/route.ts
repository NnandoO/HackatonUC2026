import { getErpnextConfig, getErpnextState, pingErpnext } from "@/lib/erpnext";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getErpnextConfig();
  let almacen: {
    estado: "ok" | "no_configurado" | "inaccesible";
    url?: string;
    usuario?: string;
    company?: string;
    warehouse?: string;
    detalle?: string;
  } = { estado: "no_configurado" };
  if (cfg) {
    const state = await getErpnextState();
    try {
      const usuario = await pingErpnext(cfg);
      almacen = { estado: "ok", url: cfg.url, usuario, ...state };
    } catch (e) {
      almacen = {
        estado: "inaccesible",
        url: cfg.url,
        detalle: String(e instanceof Error ? e.message : e).slice(0, 200),
        ...state,
      };
    }
  }
  return Response.json({
    ok: true,
    servicio: "angibell360-web",
    hora: new Date().toISOString(),
    almacen,
  });
}
