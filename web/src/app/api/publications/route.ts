import { requireApiKey } from "@/lib/auth";
import { createProduct, listPublications, recordPublication, type VariantInput } from "@/lib/db";
import { getErpnextConfig, syncProduct } from "@/lib/erpnext";
import { approveProduct } from "@/lib/flow";
import { toPublicProduct } from "@/lib/public";
import { syncApprovedProductToCore } from "@/lib/core-catalog";

export const dynamic = "force-dynamic";

type IncomingVariant = { size?: unknown; talla?: unknown; stock?: unknown; color?: unknown };

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * POST /api/publications — Paperclip sube una publicación nueva.
 * Cabecera obligatoria: X-API-Key (o Authorization: Bearer <clave>).
 * Cuerpo JSON (acepta snake_case y camelCase):
 * {
 *   "name": "Vestido abril",
 *   "description": "...", "price_cents": 12000, "currency": "PEN",
 *   "category": "Vestidos", "colors": ["rosa"],
 *   "image_urls": ["https://... | /media/archivo.jpg"],
 *   "sizes": [{ "size": "4", "stock": 3 }, { "size": "6", "stock": 0 }],
 *   "publish": true
 * }
 */
export async function POST(req: Request) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (name.length < 2 || name.length > 140) {
    return Response.json({ error: "name es obligatorio (2 a 140 caracteres)" }, { status: 400 });
  }
  const priceCents = num(body.price_cents ?? body.priceCents ?? body.precio_centimos);
  if (priceCents === null || !Number.isInteger(priceCents) || priceCents <= 0) {
    return Response.json(
      { error: "price_cents debe ser un entero positivo en céntimos (ej. S/ 120 → 12000)" },
      { status: 400 }
    );
  }
  const compareAtCents = num(body.compare_at_cents ?? body.compareAtCents ?? body.precio_antes_centimos);
  if (compareAtCents !== null && (!Number.isInteger(compareAtCents) || compareAtCents <= 0)) {
    return Response.json(
      { error: "compare_at_cents debe ser un entero positivo en céntimos (precio 'antes')" },
      { status: 400 }
    );
  }
  const rawVariants = (body.sizes ?? body.variants ?? body.tallas) as IncomingVariant[] | undefined;
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return Response.json(
      { error: "sizes es obligatorio: [{ size, stock }] (al menos una talla)" },
      { status: 400 }
    );
  }
  if (rawVariants.length > 30) {
    return Response.json({ error: "Demasiadas tallas (máximo 30)" }, { status: 400 });
  }
  const variants: VariantInput[] = [];
  for (const raw of rawVariants) {
    const size = String(raw.size ?? raw.talla ?? "").trim();
    const stock = num(raw.stock);
    if (!size) {
      return Response.json({ error: "Cada talla necesita 'size' no vacío" }, { status: 400 });
    }
    if (stock === null || !Number.isInteger(stock) || stock < 0) {
      return Response.json(
        { error: `Stock inválido para la talla "${size}" (entero ≥ 0)` },
        { status: 400 }
      );
    }
    variants.push({ size, stock, color: raw.color ? String(raw.color) : "" });
  }
  const colors = Array.isArray(body.colors) ? body.colors.map(String) : [];
  const imageUrls = Array.isArray(body.image_urls ?? body.imageUrls ?? body.imagenes)
    ? ((body.image_urls ?? body.imageUrls ?? body.imagenes) as unknown[]).map(String)
    : [];

  let product;
  try {
    product = createProduct({
      name,
      description: typeof body.description === "string" ? body.description : "",
      priceCents,
      compareAtCents,
      currency: typeof body.currency === "string" ? body.currency : "PEN",
      category: typeof body.category === "string" ? body.category : "",
      colors,
      imageUrls,
      variants,
      status: "pendiente",
      source: "paperclip",
    });
  } catch (e) {
    return Response.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 400 }
    );
  }
  recordPublication(product.id, body, `Publicación subida por Paperclip: ${product.name}`);

  const publish = body.publish === true || body.publicar === true;
  if (!publish) {
    return Response.json(
      {
        id: product.id,
        slug: product.slug,
        estado: "pendiente",
        mensaje: "Publicación recibida. Espera aprobación de la propietaria en el panel.",
      },
      { status: 201 }
    );
  }
  try {
    await syncApprovedProductToCore(product);
  } catch (e) {
    return Response.json(
      { id: product.id, slug: product.slug, estado: "pendiente", error: `No se pudo sincronizar el producto: ${String(e instanceof Error ? e.message : e)}` },
      { status: 502 },
    );
  }
  const outcome = await approveProduct(product.id);
  if (outcome.sync === null) {
    const cfg = await getErpnextConfig();
    if (!cfg) {
      return Response.json(
        {
          id: outcome.product.id,
          slug: outcome.product.slug,
          estado: "publicado",
          almacen: { estado: "no_configurado" },
          aviso: outcome.aviso,
        },
        { status: 201 }
      );
    }
    const sync = await syncProduct(cfg, outcome.product);
    return Response.json(
      { id: outcome.product.id, slug: outcome.product.slug, estado: "publicado", almacen: sync },
      { status: 201 }
    );
  }
  return Response.json(
    { id: outcome.product.id, slug: outcome.product.slug, estado: "publicado", almacen: outcome.sync },
    { status: 201 }
  );
}

/**
 * GET /api/publications — últimas publicaciones recibidas (requiere API key).
 */
export async function GET(req: Request) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return Response.json({ publicaciones: listPublications(50) });
}
