import { NextResponse } from "next/server";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { coreApiFetch } from "@/lib/core-api";

export async function POST() {
  if (!(await isPanelAuthenticated())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const response = await coreApiFetch("/v1/admin/meta/facebook/connect", { method: "POST", admin: true });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch {
    return NextResponse.json({ error: "No se pudo iniciar la conexión con Facebook." }, { status: 502 });
  }
}
