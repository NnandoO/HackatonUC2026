import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { panelCookieName, panelToken } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const given = String(body.password ?? "");
  const expected = process.env.PANEL_PASSWORD ?? "angibell360";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!given || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  const store = await cookies();
  store.set(panelCookieName(), panelToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.json({ ok: true });
}
