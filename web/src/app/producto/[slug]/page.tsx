import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, listProducts } from "@/lib/db";
import { formatPrecio, toPublicProduct } from "@/lib/public";
import { PiezaCard } from "@/components/tienda/pieza-card";
import { SiteFooter } from "@/components/tienda/site-footer";
import { SiteNav } from "@/components/tienda/site-nav";
import { Alfiler, FotoPieza } from "@/components/tienda/piezas";
import { TallaPicker } from "@/components/tienda/talla-picker";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const producto = getProductBySlug(slug);
  if (!producto || producto.status !== "publicado") return { title: "Pieza no encontrada" };
  return { title: producto.name, description: producto.description || undefined };
}

export default async function ProductoPage({ params }: Props) {
  const { slug } = await params;
  const producto = getProductBySlug(slug);
  if (!producto || producto.status !== "publicado") notFound();
  const pub = toPublicProduct(producto);
  const precio = formatPrecio(pub.priceCents, pub.currency);
  const otros = listProducts({ status: "publicado", limit: 200 })
    .filter((p) => p.slug !== pub.slug)
    .slice(0, 3)
    .map(toPublicProduct);

  return (
    <div>
      <SiteNav />
      <main className="mx-auto max-w-[1400px] px-6 pt-10 lg:px-14">
        <Link
          href="/catalogo"
          className="rotulo text-[11px] text-tinta-suave transition-colors hover:text-berry"
        >
          ← Volver al catálogo
        </Link>
        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="relative">
            <div className="trazo-tiza">
              <FotoPieza nombre={pub.name} imagen={pub.images[0]} className="aspect-[4/5] w-full" />
            </div>
            <Alfiler className="-left-2 -top-2" />
            <Alfiler className="-right-2 -top-2" />
            <Alfiler className="-left-2 -bottom-2" />
            {pub.agotado && (
              <span className="rotulo absolute right-4 top-4 border-[1.5px] border-hilo-fuerte bg-papel px-3 py-2 text-[11px] text-hilo-fuerte">
                agotado
              </span>
            )}
          </div>
          <div className="max-w-[560px]">
            <h1 className="font-display text-[clamp(40px,4.5vw,60px)] leading-[1.02]">
              {pub.name}
            </h1>
            <div className="num mt-3 flex flex-wrap items-baseline gap-3 text-[30px]">
              {precio}
              {pub.compareAtCents !== null && (
                <s className="rotulo text-[12px] text-tinta-suave decoration-hilo-fuerte">
                  antes {formatPrecio(pub.compareAtCents, pub.currency)}
                </s>
              )}
            </div>
            {pub.description && (
              <p className="mt-5 text-[16px] leading-relaxed text-tinta-suave">{pub.description}</p>
            )}
            <div className="costura my-8" />
            <TallaPicker
              nombre={pub.name}
              precio={precio}
              variantes={pub.variants.map((v) => ({
                size: v.size,
                stock: v.stock,
                stockFuente: v.stockFuente,
              }))}
            />
          </div>
        </div>
        {otros.length > 0 && (
          <section className="mt-24">
            <h2 className="font-display text-[clamp(28px,2.8vw,38px)] leading-none">
              Otras piezas
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {otros.map((p, i) => (
                <PiezaCard key={p.id} producto={p} numero={i + 1} />
              ))}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
