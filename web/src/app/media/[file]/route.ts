import { readFile } from "node:fs/promises";
import path from "node:path";
import { uploadsDir } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

type Params = { params: Promise<{ file: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { file } = await params;
  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes("..")) {
    return new Response("No permitido", { status: 400 });
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = MIME[ext];
  if (!type) return new Response("No encontrado", { status: 404 });
  try {
    const buffer = await readFile(path.join(uploadsDir(), file));
    return new Response(buffer, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
