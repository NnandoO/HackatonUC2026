import type { Product } from "./db";
import { setCoreProductMapping } from "./db";
import { coreApiFetch } from "./core-api";

type CoreVariant = { id: string; sku: string; size: string; color: string; version: number };
type CoreProduct = {
  id: string;
  name: string;
  status: "draft" | "published";
  version: number;
  variants: CoreVariant[];
};

async function coreJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await coreApiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    admin: true,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } | string };
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : result.error?.message;
    throw new Error(message || `API comercial respondió ${response.status}`);
  }
  return result;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function mapVariants(product: Product, core: CoreProduct) {
  const mapped = product.variants.map((variant) => {
    const match = core.variants.find((item) =>
      item.size === variant.size &&
      (normalize(item.color) === normalize(variant.color) || !variant.color),
    );
    if (!match) throw new Error(`La talla ${variant.size} de “${product.name}” no coincide con el catálogo comercial.`);
    return { id: variant.id, coreId: match.id };
  });
  return mapped;
}

export async function syncApprovedProductToCore(product: Product) {
  if (process.env.CORE_CATALOG_SYNC_ENABLED !== "true") return null;

  const page = await coreJson<{ items: CoreProduct[] }>("/v1/admin/products?limit=50");
  let coreProduct = product.coreId
    ? page.items.find((item) => item.id === product.coreId)
    : page.items.find((item) => normalize(item.name) === normalize(product.name));

  if (coreProduct && coreProduct.status === "published") {
    const variants = mapVariants(product, coreProduct);
    setCoreProductMapping(product.id, coreProduct.id, variants);
    return { productId: coreProduct.id, status: "already_published" as const };
  }

  if (!coreProduct) {
    const slug = product.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 24);
    const created = await coreJson<CoreProduct>("/v1/admin/products", "POST", {
      name: product.name,
      description: product.description,
      imageUrls: product.imageUrls,
      variants: product.variants.map((variant, index) => ({
        sku: `ANG-${slug}-T${variant.size}-${index + 1}`.slice(0, 48),
        size: variant.size,
        color: variant.color || "Estándar",
        price: { amountCents: product.priceCents, currency: product.currency },
        stock: variant.stockCache ?? variant.stockDeclared,
      })),
    });
    coreProduct = created;
  }

  const proposal = await coreJson<{ id: string }>("/v1/admin/proposals", "POST", {
    kind: "publish_product",
    productId: coreProduct.id,
    expectedVersion: coreProduct.version,
  });
  const confirmed = await coreJson<{ product: CoreProduct }>(
    `/v1/admin/proposals/${proposal.id}/confirm`,
    "POST",
    { confirmation: "CONFIRM" },
  );
  const published = confirmed.product;
  const variants = mapVariants(product, published);
  setCoreProductMapping(product.id, published.id, variants);

  let socialDraft = false;
  try {
    const socialProposal = await coreJson<{ id: string }>("/v1/admin/proposals", "POST", {
      kind: "prepare_social",
      productId: published.id,
      expectedVersion: published.version,
    });
    await coreJson(`/v1/admin/proposals/${socialProposal.id}/confirm`, "POST", {
      confirmation: "CONFIRM",
    });
    socialDraft = true;
  } catch {
    // A social draft is helpful for the demo but must not undo an approved product.
  }

  return { productId: published.id, status: "published" as const, socialDraft };
}

export async function syncStockToCore(updates: Array<{ variantId: string; stock: number }>) {
  if (process.env.CORE_CATALOG_SYNC_ENABLED !== "true" || updates.length === 0) return;
  await coreJson("/v1/admin/stock", "PATCH", { updates });
}
