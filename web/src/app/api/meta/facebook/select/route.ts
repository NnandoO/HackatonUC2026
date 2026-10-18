import { NextRequest, NextResponse } from "next/server";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export async function POST(request: NextRequest) {
  if (!(await isPanelAuthenticated())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.pageId !== "string" || body.pageId.length > 128) return NextResponse.json({ error: "Página inválida" }, { status: 400 });
  try {
    const response = await coreApiFetch("/v1/admin/meta/facebook/pages/select", {
      method: "POST", admin: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: body.pageId }),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar la Página seleccionada." }, { status: 502 });
  }
}
