import { coreApiFetch } from "@/lib/core-api";

export const dynamic = "force-dynamic";

export async function GET() {
  let api: {
    estado: "ok" | "inaccesible";
    servicio?: string;
    modo?: string;
    detalle?: string;
  } = { estado: "inaccesible" };

  try {
    const res = await coreApiFetch("/v1/health");
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      service?: string;
      mode?: string;
    };
    if (res.ok && data.status === "ok") {
      api = {
        estado: "ok",
        servicio: data.service ?? "ANGIBELL 360 Core API",
        modo: data.mode ?? "postgresql",
      };
    } else {
      api = {
        estado: "inaccesible",
        detalle: `HTTP ${res.status}`,
      };
    }
  } catch (e) {
    api = {
      estado: "inaccesible",
      detalle: String(e instanceof Error ? e.message : e).slice(0, 200),
    };
  }

  return Response.json(
    {
      ok: api.estado === "ok",
      servicio: "angibell360-web",
      hora: new Date().toISOString(),
      api,
    },
    { status: api.estado === "ok" ? 200 : 503 }
  );
}
