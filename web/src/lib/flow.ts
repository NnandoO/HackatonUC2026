import { getProductById, listProducts, setProductStatus, type Product } from "./db";
import { getErpnextConfig, refreshStockCache, syncProduct, type SyncResult } from "./erpnext";

export type ApproveOutcome = {
  product: Product;
  sync: SyncResult | null;
  aviso?: string;
};

export async function approveProduct(productId: number): Promise<ApproveOutcome> {
  const product = getProductById(productId);
  if (!product) throw new Error("Producto no encontrado");
  setProductStatus(productId, "publicado");
  const cfg = await getErpnextConfig();
  if (!cfg) {
    return {
      product: getProductById(productId) as Product,
      sync: null,
      aviso: "Almacén (ERPNext) aún no configurado: el stock queda como declarado.",
    };
  }
  const sync = await syncProduct(cfg, { ...product, status: "publicado" });
  return { product: getProductById(productId) as Product, sync };
}

export function rejectProduct(productId: number): Product {
  const product = getProductById(productId);
  if (!product) throw new Error("Producto no encontrado");
  setProductStatus(productId, "rechazado");
  return getProductById(productId) as Product;
}

export async function syncPending(): Promise<{ productos: number; resumen: SyncResult }> {
  const resumen: SyncResult = {
    ok: true,
    itemsCreated: 0,
    receipts: 0,
    stockRefreshed: 0,
    errores: [],
  };
  const cfg = await getErpnextConfig();
  if (!cfg) {
    return {
      productos: 0,
      resumen: { ...resumen, ok: false, errores: ["ERPNext no configurado"] },
    };
  }
  const publicados = listProducts({ status: "publicado", limit: 500 });
  let tocados = 0;
  for (const product of publicados) {
    const pendientes = product.variants.some((v) => !v.erpnextReceipted);
    if (!pendientes) continue;
    const r = await syncProduct(cfg, product);
    tocados += 1;
    resumen.itemsCreated += r.itemsCreated;
    resumen.receipts += r.receipts;
    resumen.stockRefreshed += r.stockRefreshed;
    resumen.errores.push(...r.errores);
    if (!r.ok) resumen.ok = false;
  }
  try {
    resumen.stockRefreshed += await refreshStockCache(cfg);
  } catch (e) {
    resumen.ok = false;
    resumen.errores.push(String(e instanceof Error ? e.message : e).slice(0, 200));
  }
  return { productos: tocados, resumen };
}
