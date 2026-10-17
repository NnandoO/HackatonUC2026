import { getProductBySlug } from "@/lib/db";
import { toPublicProduct } from "@/lib/public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product || product.status !== "publicado") {
    return Response.json({ error: "No encontrado" }, { status: 404 });
  }
  return Response.json({ producto: toPublicProduct(product) });
}
