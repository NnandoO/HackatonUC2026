import { writeFile } from "node:fs/promises";
import path from "node:path";
import { requireApiKey } from "@/lib/auth";
import { addProductImages, slugify, uploadsDir } from "@/lib/db";
import { isPanelAuthenticated } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/**
 * POST /api/uploads — sube una foto (multipart/form-data, campo "file").
 * Opcional: campo "productId" para adjuntarla al producto.
 * Autorizado por panel o por API key (Paperclip).
 */
export async function POST(req: Request) {
  const panel = await isPanelAuthenticated();
  if (!panel) {
    const denied = requireApiKey(req);
    if (denied) return denied;
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: 'Falta el archivo en el campo "file"' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "La imagen supera 8 MB" }, { status: 413 });
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return Response.json(
      { error: `Formato no soportado (${file.type || "desconocido"}). Usa JPG, PNG, WebP, AVIF o GIF` },
      { status: 415 }
    );
  }
  const original = path.parse(file.name || "foto").name;
  const name = `${Date.now()}-${slugify(original) || "foto"}.${ext}`;
  const target = path.join(uploadsDir(), name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(target, buffer);
  const url = `/media/${name}`;
  const productId = Number(form.get("productId"));
  if (Number.isInteger(productId) && productId > 0) {
    addProductImages(productId, [url]);
  }
  return Response.json({ ok: true, url, bytes: file.size }, { status: 201 });
}
