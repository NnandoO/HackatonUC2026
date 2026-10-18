import { mkdirSync } from "node:fs";
import path from "node:path";
import { coreApiFetch } from "./core-api";

export type ProductStatus = "pendiente" | "publicado" | "rechazado";
export type ProductSource = "manual" | "paperclip" | "whatsapp";

export type Variant = {
  id: string;
  productId: string;
  sku?: string;
  size: string;
  color: string;
  stockDeclared: number;
  stockCache: number | null;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  category: string;
  colors: string[];
  imageUrls: string[];
  status: ProductStatus;
  source: ProductSource;
  createdAt: string;
  updatedAt: string;
  variants: Variant[];
};

export type VariantInput = {
  size: string;
  color?: string | null;
  stock: number;
  sku?: string;
};

export type ProductInput = {
  name: string;
  description?: string;
  priceCents: number;
  compareAtCents?: number | null;
  currency?: string;
  category?: string;
  colors?: string[];
  imageUrls?: string[];
  variants: VariantInput[];
  status?: ProductStatus;
  source?: ProductSource;
  publish?: boolean;
};

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `producto-${Date.now().toString(36)}`;
}

type ApiStatus = "draft" | "published" | "rejected";

function toStoreStatus(status: unknown): ProductStatus {
  const s = String(status ?? "").toLowerCase();
  if (s === "published" || s === "publicado") return "publicado";
  if (s === "rejected" || s === "rechazado") return "rechazado";
  return "pendiente";
}

function toApiStatus(status: ProductStatus): ApiStatus {
  if (status === "publicado") return "published";
  if (status === "rechazado") return "rejected";
  return "draft";
}

function toStoreSource(source: unknown): ProductSource {
  const s = String(source ?? "").toLowerCase();
  if (s === "paperclip" || s === "whatsapp") return s;
  return "manual";
}

type RawVariant = Record<string, unknown> & {
  price?: { amountCents?: number; currency?: string };
};

type RawProduct = Record<string, unknown> & {
  variants?: RawVariant[];
};

function mapVariantFromApi(v: RawVariant, productId: string): Variant {
  const stock =
    typeof v.available === "number"
      ? v.available
      : typeof v.stockOnHand === "number"
        ? v.stockOnHand
        : typeof v.stock_on_hand === "number"
          ? v.stock_on_hand
          : typeof v.stockDeclared === "number"
            ? v.stockDeclared
            : typeof v.stock === "number"
              ? v.stock
              : 0;
  return {
    id: String(v.id ?? ""),
    productId,
    sku: v.sku ? String(v.sku) : undefined,
    size: String(v.size ?? "Única"),
    color: String(v.color ?? ""),
    stockDeclared: Math.max(0, Number(stock) || 0),
    stockCache: null,
  };
}

function mapProductFromApi(raw: RawProduct): Product {
  const id = String(raw.id ?? "");
  const name = String(raw.name ?? "");
  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  const variants = rawVariants.map((v) => mapVariantFromApi(v, id));
  const variantPrices = rawVariants
    .map((v) =>
      typeof v.price?.amountCents === "number"
        ? v.price.amountCents
        : typeof v.price_cents === "number"
          ? v.price_cents
          : null
    )
    .filter((p): p is number => p !== null && p > 0);
  const basePrice =
    typeof raw.priceCents === "number" && raw.priceCents > 0
      ? raw.priceCents
      : typeof raw.price_cents === "number" && raw.price_cents > 0
        ? raw.price_cents
        : variantPrices.length > 0
          ? Math.min(...variantPrices)
          : 0;
  const compareAt =
    typeof raw.compareAtCents === "number"
      ? raw.compareAtCents
      : typeof raw.compare_at_cents === "number"
        ? raw.compare_at_cents
        : null;
  const colors = Array.isArray(raw.colors) ? raw.colors.map(String) : [];
  const imageUrls = Array.isArray(raw.imageUrls)
    ? raw.imageUrls.map(String)
    : Array.isArray(raw.image_urls)
      ? raw.image_urls.map(String)
      : [];
  const createdAt = String(raw.createdAt ?? raw.created_at ?? new Date().toISOString());
  const updatedAt = String(raw.updatedAt ?? raw.updated_at ?? createdAt);

  return {
    id,
    slug: String(raw.slug || slugify(name)),
    name,
    description: String(raw.description ?? ""),
    priceCents: basePrice,
    compareAtCents: compareAt,
    currency: String(raw.currency ?? rawVariants[0]?.price?.currency ?? "PEN"),
    category: String(raw.category ?? ""),
    colors,
    imageUrls,
    status: toStoreStatus(raw.status),
    source: toStoreSource(raw.source),
    createdAt,
    updatedAt,
    variants,
  };
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string | { message?: string };
    message?: string;
  };
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.error?.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return `${fallback} (HTTP ${res.status})`;
}

function unwrapProduct(payload: unknown): RawProduct | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (obj.item && typeof obj.item === "object") return obj.item as RawProduct;
  if (obj.product && typeof obj.product === "object") return obj.product as RawProduct;
  if (typeof obj.id === "string" || typeof obj.name === "string") return obj as RawProduct;
  return null;
}

function unwrapProductList(payload: unknown): RawProduct[] {
  if (Array.isArray(payload)) return payload as RawProduct[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj.items as RawProduct[];
  if (Array.isArray(obj.products)) return obj.products as RawProduct[];
  return [];
}

export async function listProducts(
  opts: { status?: ProductStatus; limit?: number } = {}
): Promise<Product[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  try {
    if (opts.status === "publicado") {
      const res = await coreApiFetch(`/v1/products?limit=${limit}`);
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return unwrapProductList(data)
        .map(mapProductFromApi)
        .filter((p) => p.status === "publicado");
    }

    const query = new URLSearchParams({ limit: String(limit) });
    if (opts.status) {
      query.set("status", toApiStatus(opts.status));
    }
    const res = await coreApiFetch(`/v1/admin/products?${query.toString()}`, {
      admin: true,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const items = unwrapProductList(data).map(mapProductFromApi);
    return opts.status ? items.filter((p) => p.status === opts.status) : items;
  } catch {
    return [];
  }
}

export async function getProductById(id: string): Promise<Product | null> {
  if (!id) return null;
  try {
    const adminRes = await coreApiFetch(`/v1/admin/products/${encodeURIComponent(id)}`, {
      admin: true,
    });
    if (adminRes.ok) {
      const raw = unwrapProduct(await adminRes.json().catch(() => null));
      if (raw) return mapProductFromApi(raw);
    }
  } catch {
    // Fallback to list/public endpoint below
  }
  try {
    const adminList = await listProducts({ limit: 500 });
    const foundAdmin = adminList.find((p) => p.id === id || p.slug === id);
    if (foundAdmin) return foundAdmin;
  } catch {
    // Fallback to public endpoint below
  }
  try {
    const res = await coreApiFetch(`/v1/products/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const raw = unwrapProduct(await res.json().catch(() => null));
    return raw ? mapProductFromApi(raw) : null;
  } catch {
    return null;
  }
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!slug) return null;
  try {
    const res = await coreApiFetch(`/v1/products/${encodeURIComponent(slug)}`);
    if (res.ok) {
      const raw = unwrapProduct(await res.json().catch(() => null));
      if (raw) return mapProductFromApi(raw);
    }
  } catch {
    // Fallback to list lookup below
  }
  const published = await listProducts({ status: "publicado", limit: 500 });
  const matchPublished = published.find((p) => p.slug === slug || p.id === slug);
  if (matchPublished) return matchPublished;

  const all = await listProducts({ limit: 500 });
  return all.find((p) => p.slug === slug || p.id === slug) ?? null;
}

export async function createProduct(
  input: ProductInput & { publish?: boolean }
): Promise<Product> {
  if (!input.name || !input.name.trim()) {
    throw new Error("El nombre es obligatorio");
  }
  const price = Math.round(input.priceCents);
  if (!Number.isInteger(price) || price <= 0) {
    throw new Error("priceCents debe ser un entero positivo (céntimos)");
  }
  const variants: VariantInput[] = input.variants?.length
    ? input.variants
    : [{ size: "Única", stock: 0 }];
  for (const v of variants) {
    if (!Number.isInteger(v.stock) || v.stock < 0) {
      throw new Error(`Stock inválido para la talla "${v.size}"`);
    }
  }
  const compareAt =
    typeof input.compareAtCents === "number" &&
    Number.isInteger(input.compareAtCents) &&
    input.compareAtCents > price
      ? input.compareAtCents
      : null;
  const currency = (input.currency ?? "PEN").toUpperCase();
  const publish = input.status === "publicado" || input.publish === true;
  const baseSku =
    slugify(input.name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 10) || "PROD";
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();

  const res = await coreApiFetch("/v1/admin/products", {
    method: "POST",
    admin: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      priceCents: price,
      compareAtCents: compareAt,
      currency,
      category: input.category ?? "",
      colors: input.colors ?? [],
      imageUrls: input.imageUrls ?? [],
      source: input.source ?? "manual",
      status: publish
        ? "published"
        : input.status === "rechazado"
          ? "rejected"
          : "draft",
      publish,
      variants: variants.map((v, index) => {
        const size = String(v.size ?? "").trim() || "Única";
        const cleanSize = size.toUpperCase().replace(/[^A-Z0-9]+/g, "") || "U";
        return {
          sku: v.sku?.trim() || `ANG-${baseSku}-T${cleanSize}-${index + 1}-${suffix}`,
          size,
          color: String(v.color ?? "").trim() || "Estándar",
          price: { amountCents: price, currency },
          stock: Math.round(v.stock),
        };
      }),
    }),
  });

  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "No se pudo crear el producto"));
  }
  const raw = unwrapProduct(await res.json().catch(() => null));
  if (!raw) {
    throw new Error("Respuesta inválida al crear el producto");
  }
  return mapProductFromApi(raw);
}

export async function setProductStatus(
  id: string,
  status: ProductStatus
): Promise<Product> {
  const res = await coreApiFetch(
    `/v1/admin/products/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      admin: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: toApiStatus(status) }),
    }
  );
  if (!res.ok) {
    throw new Error(
      await extractErrorMessage(res, "No se pudo actualizar el estado del producto")
    );
  }
  const raw = unwrapProduct(await res.json().catch(() => null));
  if (raw) return mapProductFromApi(raw);
  const updated = await getProductById(id);
  if (!updated) throw new Error("Producto no encontrado tras actualizar estado");
  return updated;
}

export async function setVariantDeclaredStock(
  variantId: string,
  stock: number
): Promise<void> {
  const res = await coreApiFetch("/v1/admin/stock", {
    method: "PATCH",
    admin: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      updates: [{ variantId, stock: Math.max(0, Math.round(stock)) }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      await extractErrorMessage(res, "No se pudo actualizar el stock")
    );
  }
}

export async function recordPublication(
  productId: string | null,
  payload: unknown,
  note: string
): Promise<void> {
  try {
    await coreApiFetch("/v1/admin/publications", {
      method: "POST",
      admin: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, payload, note }),
    });
  } catch {
    // Si la API ya registró la publicación al crear el producto, no interrumpir el flujo
  }
}

export async function listPublications(limit = 50): Promise<
  Array<{
    id: number | string;
    productId: string | null;
    productName?: string | null;
    note: string;
    receivedAt: string;
  }>
> {
  const clamped = Math.min(Math.max(limit, 1), 200);
  try {
    const res = await coreApiFetch(`/v1/admin/publications?limit=${clamped}`, {
      admin: true,
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as {
      items?: Array<Record<string, unknown>>;
      publications?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : (data.items ?? data.publications ?? []);
    return rows.map((r, idx) => ({
      id: (r.id as number | string) ?? idx + 1,
      productId:
        r.productId == null && r.product_id == null
          ? null
          : String(r.productId ?? r.product_id),
      productName:
        r.productName == null && r.product_name == null
          ? null
          : String(r.productName ?? r.product_name),
      note: String(r.note ?? ""),
      receivedAt: String(r.receivedAt ?? r.received_at ?? new Date().toISOString()),
    }));
  } catch {
    return [];
  }
}

export async function addProductImages(
  productId: string,
  urls: string[]
): Promise<void> {
  if (!productId || urls.length === 0) return;
  try {
    const product = await getProductById(productId);
    const merged = Array.from(
      new Set([...(product?.imageUrls ?? []), ...urls.filter(Boolean)])
    );
    await coreApiFetch(`/v1/admin/products/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      admin: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrls: merged }),
    });
  } catch {
    // Ignorar si el endpoint opcional de adjuntar imagen no está disponible
  }
}
