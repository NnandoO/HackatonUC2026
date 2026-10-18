import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  if (!(await isPanelAuthenticated())) {
    return Response.json({ error: "Inicia sesión como administradora." }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: "Borrador inválido." }, { status: 400 });
  try {
    const response = await coreApiFetch(`/v1/admin/social-drafts/${id}/publish-facebook`, {
      method: "POST",
      admin: true,
    });
    const result = await response.json().catch(() => ({}));
    return Response.json(result, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo publicar en Facebook." },
      { status: 503 },
    );
  }
}
