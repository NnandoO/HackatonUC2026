import { NextResponse } from "next/server";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export async function GET() {
  if (!(await isPanelAuthenticated())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const response = await coreApiFetch("/v1/admin/meta/facebook/pages", { admin: true });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "No se pudieron cargar las páginas disponibles." }, { status: 502 });
  }
}
