import { createHash } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "angibell_panel";

export function panelToken(): string {
  return createHash("sha256")
    .update(`angibell360:${process.env.PANEL_PASSWORD ?? "angibell360"}`)
    .digest("hex");
}

export async function isPanelAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE)?.value === panelToken();
}

export function panelCookieName(): string {
  return COOKIE;
}
