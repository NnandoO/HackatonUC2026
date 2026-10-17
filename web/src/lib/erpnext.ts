import {
  getSetting,
  setSetting,
  listVariantsToSync,
  listErpnextVariants,
  markVariantReceipted,
  setVariantStockCache,
  type Product,
  type Variant,
} from "./db";

export type ErpnextConfig = { url: string; apiKey: string; apiSecret: string };
export type ErpnextState = { company?: string; warehouse?: string };

const TIMEOUT_READ = 4000;
const TIMEOUT_WRITE = 20000;

export async function getErpnextConfig(): Promise<ErpnextConfig | null> {
  const stored = getSetting<(ErpnextConfig & ErpnextState) | null>("erpnext");
  const url = (stored?.url ?? process.env.ERPNEXT_URL ?? "").trim();
  const apiKey = (stored?.apiKey ?? process.env.ERPNEXT_API_KEY ?? "").trim();
  const apiSecret = (stored?.apiSecret ?? process.env.ERPNEXT_API_SECRET ?? "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url: url.replace(/\/+$/, ""), apiKey, apiSecret };
}

export async function getErpnextState(): Promise<ErpnextState> {
  const stored = getSetting<ErpnextState>("erpnext");
  return { company: stored?.company, warehouse: stored?.warehouse };
}

async function erpFetch(
  cfg: ErpnextConfig,
  path: string,
  init: RequestInit = {},
  timeout = TIMEOUT_READ
): Promise<Response> {
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${cfg.apiKey}:${cfg.apiSecret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
}

async function erpJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function pingErpnext(cfg: ErpnextConfig): Promise<string> {
  const res = await erpFetch(cfg, "/api/method/frappe.auth.get_logged_user");
  if (!res.ok) throw new Error(`ERPNext respondió ${res.status}`);
  const data = (await erpJson(res)) as { message?: string };
  return data.message ?? "desconocido";
}

function erpError(data: unknown, status: number): string {
  const d = data as { exception?: string; _server_messages?: string; message?: unknown };
  const detail =
    d?._server_messages ??
    d?.exception ??
    (typeof d?.message === "string" ? d.message : JSON.stringify(d?.message ?? data));
  return `${status}: ${String(detail).slice(0, 300)}`;
}

export async function erpList(
  cfg: ErpnextConfig,
  doctype: string,
  params: { fields?: string[]; filters?: unknown[]; limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${cfg.url}/api/resource/${encodeURIComponent(doctype)}`);
  if (params.fields) url.searchParams.set("fields", JSON.stringify(params.fields));
  if (params.filters) url.searchParams.set("filters", JSON.stringify(params.filters));
  url.searchParams.set("limit_page_length", String(params.limit ?? 50));
  const res = await erpFetch(cfg, `${url.pathname}${url.search}`);
  const data = (await erpJson(res)) as { data?: Record<string, unknown>[] };
  if (!res.ok) throw new Error(`ERPNEXT_LIST ${erpError(data, res.status)}`);
  return data.data ?? [];
}

export async function erpGet(
  cfg: ErpnextConfig,
  doctype: string,
  name: string
): Promise<Record<string, unknown> | null> {
  const res = await erpFetch(cfg, `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  const data = (await erpJson(res)) as { data?: Record<string, unknown> };
  if (!res.ok) throw new Error(`ERPNEXT_GET ${erpError(data, res.status)}`);
  return data.data ?? null;
}

export async function erpInsert(
  cfg: ErpnextConfig,
  doctype: string,
  doc: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await erpFetch(
    cfg,
    `/api/resource/${encodeURIComponent(doctype)}`,
    { method: "POST", body: JSON.stringify(doc) },
    TIMEOUT_WRITE
  );
  const data = (await erpJson(res)) as { data?: Record<string, unknown> };
  if (!res.ok) throw new Error(`ERPNEXT_INSERT ${erpError(data, res.status)}`);
  return data.data ?? {};
}

export async function erpSubmit(cfg: ErpnextConfig, doc: Record<string, unknown>): Promise<void> {
  const res = await erpFetch(
    cfg,
    "/api/method/frappe.client.submit",
    { method: "POST", body: JSON.stringify({ doc }) },
    TIMEOUT_WRITE
  );
  if (!res.ok) {
    const data = await erpJson(res);
    throw new Error(`ERPNEXT_SUBMIT ${erpError(data, res.status)}`);
  }
}

export async function connectErpnext(
  rawUrl: string,
  usr: string,
  pwd: string
): Promise<ErpnextConfig> {
  const base = rawUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("La URL debe empezar con http:// o https://");
  const login = await fetch(`${base}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ usr, pwd }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_WRITE),
  });
  if (!login.ok) throw new Error(`Login falló (${login.status}). ¿Usuario o contraseña incorrectos?`);
  const cookies = login.headers.getSetCookie?.() ?? [];
  const sid = cookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sid="));
  if (!sid) throw new Error("Login sin sesión; revisa URL/usuario/contraseña");
  const csrfRes = await fetch(`${base}/api/method/frappe.sessions.get_csrf_token`, {
    headers: { Cookie: sid },
    signal: AbortSignal.timeout(TIMEOUT_READ),
  });
  const csrf = ((await erpJson(csrfRes)) as { message?: string }).message ?? "";
  const keysRes = await fetch(
    `${base}/api/method/frappe.core.doctype.user.user.generate_keys?user=${encodeURIComponent(usr)}`,
    {
      method: "POST",
      headers: { Cookie: sid, "X-Frappe-CSRF-Token": csrf },
      signal: AbortSignal.timeout(TIMEOUT_WRITE),
    }
  );
  const keysData = (await erpJson(keysRes)) as {
    message?: { api_key?: string; api_secret?: string } | string;
  };
  let apiKey = "";
  let apiSecret = "";
  if (typeof keysData.message === "string") {
    apiSecret = keysData.message;
  } else {
    apiKey = keysData.message?.api_key ?? "";
    apiSecret = keysData.message?.api_secret ?? "";
  }
  if (!apiKey) {
    const userRes = await fetch(
      `${base}/api/resource/User/${encodeURIComponent(usr)}?fields=${encodeURIComponent('["api_key"]')}`,
      { headers: { Cookie: sid }, signal: AbortSignal.timeout(TIMEOUT_READ) }
    );
    const userData = (await erpJson(userRes)) as { data?: { api_key?: string } };
    apiKey = userData.data?.api_key ?? "";
  }
  if (!apiKey || !apiSecret) throw new Error("No se pudieron generar las API keys");
  return { url: base, apiKey, apiSecret };
}

export async function ensureStockSetup(cfg: ErpnextConfig): Promise<ErpnextState> {
  const state = await getErpnextState();
  let company = state.company;
  if (!company) {
    const companies = await erpList(cfg, "Company", { fields: ["name"], limit: 1 });
    company = companies.length ? String(companies[0].name) : undefined;
    if (!company) {
      await erpInsert(cfg, "Company", {
        doctype: "Company",
        company_name: "Angibell Creaciones",
        country: "Peru",
        default_currency: "PEN",
      });
      company = "Angibell Creaciones";
    }
  }
  let warehouse = state.warehouse;
  if (!warehouse) {
    const warehouses = await erpList(cfg, "Warehouse", {
      fields: ["name"],
      filters: [
        ["is_group", "=", 0],
        ["company", "=", company],
      ],
      limit: 20,
    });
    warehouse = warehouses.length ? String(warehouses[0].name) : undefined;
    if (!warehouse) {
      const created = await erpInsert(cfg, "Warehouse", {
        doctype: "Warehouse",
        warehouse_name: "Almacén Angibell",
        company,
      });
      warehouse = String(created.name ?? "Almacén Angibell");
    }
  }
  const uom = await erpGet(cfg, "UOM", "Nos");
  if (!uom) await erpInsert(cfg, "UOM", { doctype: "UOM", uom_name: "Nos" });
  const itemGroup = await erpGet(cfg, "Item Group", "Productos");
  if (!itemGroup) {
    try {
      await erpInsert(cfg, "Item Group", { doctype: "Item Group", item_group_name: "Productos", parent_item_group: "All Item Groups" });
    } catch {
      /* si ya existe un grupo equivalente, se usa el que ERPNext cree por defecto */
    }
  }
  const merged = { ...(getSetting<Record<string, unknown>>("erpnext") ?? {}), company, warehouse };
  setSetting("erpnext", merged);
  return { company, warehouse };
}

export async function ensureItem(
  cfg: ErpnextConfig,
  itemCode: string,
  itemName: string
): Promise<void> {
  const existing = await erpGet(cfg, "Item", itemCode);
  if (existing) return;
  await erpInsert(cfg, "Item", {
    doctype: "Item",
    item_code: itemCode,
    item_name: itemName.slice(0, 140),
    item_group: "Productos",
    stock_uom: "Nos",
    is_stock_item: 1,
  });
}

export async function receiptStock(
  cfg: ErpnextConfig,
  itemCode: string,
  qty: number,
  warehouse: string,
  company: string
): Promise<void> {
  const doc = await erpInsert(cfg, "Stock Entry", {
    doctype: "Stock Entry",
    stock_entry_type: "Material Receipt",
    company,
    to_warehouse: warehouse,
    items: [
      {
        item_code: itemCode,
        qty,
        t_warehouse: warehouse,
        allow_zero_valuation_rate: 1,
      },
    ],
  });
  await erpSubmit(cfg, doc);
}

export async function fetchBinQty(
  cfg: ErpnextConfig,
  itemCodes: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!itemCodes.length) return result;
  const rows = await erpList(cfg, "Bin", {
    fields: ["item_code", "actual_qty"],
    filters: [["item_code", "in", itemCodes]],
    limit: 0,
  });
  for (const row of rows) {
    const code = String(row.item_code);
    result.set(code, (result.get(code) ?? 0) + Number(row.actual_qty ?? 0));
  }
  return result;
}

export function itemCodeFor(product: Product, variant: Variant): string {
  const suffix = variant.size.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `ANG-${product.slug}-${suffix}`.slice(0, 140);
}

export type SyncResult = {
  ok: boolean;
  itemsCreated: number;
  receipts: number;
  stockRefreshed: number;
  errores: string[];
  warehouse?: string;
  company?: string;
};

export async function syncProduct(cfg: ErpnextConfig, product: Product): Promise<SyncResult> {
  const { company, warehouse } = await ensureStockSetup(cfg);
  const result: SyncResult = {
    ok: true,
    itemsCreated: 0,
    receipts: 0,
    stockRefreshed: 0,
    errores: [],
    warehouse,
    company,
  };
  const pending = listVariantsToSync().filter((v) => v.productId === product.id);
  for (const variant of pending) {
    const code = variant.erpnextItemCode ?? itemCodeFor(product, variant);
    try {
      const existed = await erpGet(cfg, "Item", code);
      if (!existed) {
        await ensureItem(cfg, code, `${product.name} Talla ${variant.size}`);
        result.itemsCreated += 1;
      }
      if (variant.stockDeclared > 0) {
        await receiptStock(cfg, code, variant.stockDeclared, warehouse ?? "Stores", company ?? "Angibell Creaciones");
        result.receipts += 1;
      }
      markVariantReceipted(variant.id, code);
    } catch (e) {
      result.ok = false;
      result.errores.push(`Talla ${variant.size}: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    }
  }
  try {
    result.stockRefreshed = await refreshStockCache(cfg);
  } catch (e) {
    result.ok = false;
    result.errores.push(`Refresco de stock: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
  }
  return result;
}

export async function refreshStockCache(cfg: ErpnextConfig): Promise<number> {
  const variants = listErpnextVariants();
  if (!variants.length) return 0;
  const codes = Array.from(new Set(variants.map((v) => v.erpnextItemCode as string)));
  const bins = await fetchBinQty(cfg, codes);
  for (const variant of variants) {
    setVariantStockCache(variant.id, bins.get(variant.erpnextItemCode as string) ?? 0);
  }
  return variants.length;
}
