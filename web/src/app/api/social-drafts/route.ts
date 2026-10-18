import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPanelAuthenticated())) {
    return Response.json({ error: "Inicia sesión como administradora." }, { status: 401 });
  }
  try {
    const response = await coreApiFetch("/v1/admin/social-drafts?limit=50", { admin: true });
    const result = await response.json().catch(() => ({}));
    return Response.json(result, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudieron consultar los borradores." },
      { status: 503 },
    );
  }
}
