import { cookies } from "next/headers";
import { panelCookieName } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  store.delete(panelCookieName());
  return Response.json({ ok: true });
}
