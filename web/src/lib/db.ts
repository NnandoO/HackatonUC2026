import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type ProductStatus = "pendiente" | "publicado" | "rechazado";
export type ProductSource = "manual" | "paperclip";

export type Variant = {
  id: number;
  productId: number;
  size: string;
  color: string;
  stockDeclared: number;
  stockCache: number | null;
  erpnextItemCode: string | null;
  erpnextReceipted: boolean;
};

export type Product = {
  id: number;
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

export type VariantInput = { size: string; color?: string | null; stock: number };

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
};

const g = globalThis as unknown as { __angibellDb?: DatabaseSync };

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): DatabaseSync {
  if (g.__angibellDb) return g.__angibellDb;
  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir(), "angibell.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PEN',
      category TEXT NOT NULL DEFAULT '',
      colors TEXT NOT NULL DEFAULT '[]',
      image_urls TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pendiente',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      stock_declared INTEGER NOT NULL DEFAULT 0,
      stock_cache INTEGER,
      erpnext_item_code TEXT,
      erpnext_receipted INTEGER NOT NULL DEFAULT 0,
      UNIQUE (product_id, size, color)
    );
    CREATE TABLE IF NOT EXISTS publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      payload TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const productCols = db.prepare("PRAGMA table_info(products)").all() as Row[];
  if (!productCols.some((c) => String(c.name) === "compare_at_cents")) {
    db.exec("ALTER TABLE products ADD COLUMN compare_at_cents INTEGER");
  }
  g.__angibellDb = db;
  return db;
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

type Row = Record<string, unknown>;

function variantFromRow(r: Row): Variant {
  return {
    id: Number(r.id),
    productId: Number(r.product_id),
    size: String(r.size),
    color: String(r.color ?? ""),
    stockDeclared: Number(r.stock_declared),
    stockCache: r.stock_cache === null ? null : Number(r.stock_cache),
    erpnextItemCode: r.erpnext_item_code === null ? null : String(r.erpnext_item_code),
    erpnextReceipted: Number(r.erpnext_receipted) === 1,
  };
}

function productFromRow(r: Row, variants: Variant[]): Product {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: String(r.description ?? ""),
    priceCents: Number(r.price_cents),
    compareAtCents:
      r.compare_at_cents === null || r.compare_at_cents === undefined
        ? null
        : Number(r.compare_at_cents),
    currency: String(r.currency ?? "PEN"),
    category: String(r.category ?? ""),
    colors: JSON.parse(String(r.colors ?? "[]")) as string[],
    imageUrls: JSON.parse(String(r.image_urls ?? "[]")) as string[],
    status: String(r.status) as ProductStatus,
    source: String(r.source) as ProductSource,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    variants,
  };
}

export function createProduct(input: ProductInput): Product {
  const db = getDb();
  if (!input.name || !input.name.trim()) throw new Error("El nombre es obligatorio");
  const price = Math.round(input.priceCents);
  if (!Number.isInteger(price) || price <= 0) throw new Error("priceCents debe ser un entero positivo (céntimos)");
  const variants: VariantInput[] = input.variants?.length ? input.variants : [{ size: "Única", stock: 0 }];
  for (const v of variants) {
    if (!Number.isInteger(v.stock) || v.stock < 0) throw new Error(`Stock inválido para la talla "${v.size}"`);
  }
  let slug = slugify(input.name);
  if (db.prepare("SELECT id FROM products WHERE slug = ?").get(slug)) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  const compareAt =
    typeof input.compareAtCents === "number" && Number.isInteger(input.compareAtCents) && input.compareAtCents > price
      ? input.compareAtCents
      : null;
  const ins = db
    .prepare(
      `INSERT INTO products (slug, name, description, price_cents, compare_at_cents, currency, category, colors, image_urls, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      slug,
      input.name.trim(),
      input.description?.trim() ?? "",
      price,
      compareAt,
      (input.currency ?? "PEN").toUpperCase(),
      input.category ?? "",
      JSON.stringify(input.colors ?? []),
      JSON.stringify(input.imageUrls ?? []),
      input.status ?? "pendiente",
      input.source ?? "manual"
    );
  const productId = Number(ins.lastInsertRowid);
  const vIns = db.prepare(
    "INSERT INTO variants (product_id, size, color, stock_declared) VALUES (?, ?, ?, ?)"
  );
  for (const v of variants) {
    vIns.run(productId, String(v.size ?? "").trim() || "Única", String(v.color ?? "").trim(), Math.round(v.stock));
  }
  const created = getProductById(productId);
  if (!created) throw new Error("No se pudo crear el producto");
  return created;
}

export function getProductById(id: number): Product | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;
  const vs = db.prepare("SELECT * FROM variants WHERE product_id = ? ORDER BY id").all(id) as Row[];
  return productFromRow(row, vs.map(variantFromRow));
}

export function getProductBySlug(slug: string): Product | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM products WHERE slug = ?").get(slug) as Row | undefined;
  if (!row) return null;
  const vs = db.prepare("SELECT * FROM variants WHERE product_id = ? ORDER BY id").all(Number(row.id)) as Row[];
  return productFromRow(row, vs.map(variantFromRow));
}

export function listProducts(opts: { status?: ProductStatus; limit?: number } = {}): Product[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const rows = (
    opts.status
      ? db.prepare("SELECT * FROM products WHERE status = ? ORDER BY updated_at DESC LIMIT ?").all(opts.status, limit)
      : db.prepare("SELECT * FROM products ORDER BY updated_at DESC LIMIT ?").all(limit)
  ) as Row[];
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => "?").join(",");
  const vRows = db
    .prepare(`SELECT * FROM variants WHERE product_id IN (${placeholders}) ORDER BY id`)
    .all(...ids) as Row[];
  const byProduct = new Map<number, Variant[]>();
  for (const vr of vRows) {
    const pid = Number(vr.product_id);
    const list = byProduct.get(pid) ?? [];
    list.push(variantFromRow(vr));
    byProduct.set(pid, list);
  }
  return rows.map((r) => productFromRow(r, byProduct.get(Number(r.id)) ?? []));
}

export function setProductStatus(id: number, status: ProductStatus): void {
  const db = getDb();
  db.prepare("UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function setVariantDeclaredStock(variantId: number, stock: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE variants SET stock_declared = ?, erpnext_receipted = 0 WHERE id = ?"
  ).run(Math.max(0, Math.round(stock)), variantId);
  db.prepare("UPDATE products SET updated_at = datetime('now') WHERE id = (SELECT product_id FROM variants WHERE id = ?)").run(variantId);
}

export function markVariantReceipted(variantId: number, itemCode: string): void {
  const db = getDb();
  db.prepare("UPDATE variants SET erpnext_item_code = ?, erpnext_receipted = 1 WHERE id = ?").run(itemCode, variantId);
}

export function setVariantStockCache(variantId: number, qty: number | null): void {
  const db = getDb();
  db.prepare("UPDATE variants SET stock_cache = ? WHERE id = ?").run(qty, variantId);
}

export function listVariantsToSync(): Variant[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.* FROM variants v JOIN products p ON p.id = v.product_id
       WHERE p.status = 'publicado' AND v.erpnext_receipted = 0 ORDER BY v.id`
    )
    .all() as Row[];
  return rows.map(variantFromRow);
}

export function listErpnextVariants(): Variant[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.* FROM variants v JOIN products p ON p.id = v.product_id
       WHERE p.status = 'publicado' AND v.erpnext_item_code IS NOT NULL ORDER BY v.id`
    )
    .all() as Row[];
  return rows.map(variantFromRow);
}

export function recordPublication(productId: number | null, payload: unknown, note: string): void {
  const db = getDb();
  db.prepare("INSERT INTO publications (product_id, payload, note) VALUES (?, ?, ?)").run(
    productId,
    JSON.stringify(payload),
    note
  );
}

export function listPublications(limit = 50): Array<{
  id: number;
  productId: number | null;
  productName: string | null;
  note: string;
  receivedAt: string;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pub.id, pub.product_id, pub.note, pub.received_at, p.name AS product_name
       FROM publications pub LEFT JOIN products p ON p.id = pub.product_id
       ORDER BY pub.id DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 200)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    productId: r.product_id === null ? null : Number(r.product_id),
    productName: r.product_name === null ? null : String(r.product_name),
    note: String(r.note ?? ""),
    receivedAt: String(r.received_at),
  }));
}

export function getSetting<T>(key: string): T | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
  if (!row) return null;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

export function addProductImages(productId: number, urls: string[]): void {
  const product = getProductById(productId);
  if (!product) return;
  const merged = Array.from(new Set([...product.imageUrls, ...urls.filter(Boolean)]));
  const db = getDb();
  db.prepare("UPDATE products SET image_urls = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(merged),
    productId
  );
}
