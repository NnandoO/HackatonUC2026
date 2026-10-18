import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPanelAuthenticated())) {
    return Response.json({ error: "Inicia sesión como administradora." }, { status: 401 });
  }
  try {
    const response = await coreApiFetch("/v1/admin/sales-requests?limit=50", { admin: true });
    const body = await response.json().catch(() => ({}));
    return Response.json(body, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo consultar la API comercial." },
      { status: 503 },
    );
  }
}
