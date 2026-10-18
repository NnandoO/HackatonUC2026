import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { listProducts } from "@/lib/db";
import { toPublicProduct } from "@/lib/public";
import { PiezaCard } from "@/components/tienda/pieza-card";
import { SiteFooter } from "@/components/tienda/site-footer";
import { SiteNav } from "@/components/tienda/site-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catálogo",
  description: "Todas las piezas publicadas de Angibell Creaciones, con su stock por talla.",
};

function ordenarTallas(a: string, b: string): number {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "es");
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ talla?: string }>;
}) {
  const { talla } = await searchParams;
  const todos = (await listProducts({ status: "publicado", limit: 200 })).map(toPublicProduct);
  const tallas = Array.from(new Set(todos.flatMap((p) => p.variants.map((v) => v.size)))).sort(
    ordenarTallas
  );
  const visibles = talla ? todos.filter((p) => p.variants.some((v) => v.size === talla)) : todos;

  return (
    <div>
      <SiteNav />
      <main className="mx-auto max-w-[1400px] px-6 pt-14 lg:px-14">
        <h1 className="font-display text-[clamp(38px,4.5vw,58px)] leading-tight">
          El catálogo completo
        </h1>
        <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-tinta-suave">
          {visibles.length} {visibles.length === 1 ? "pieza" : "piezas"} publicadas, cada una con
          sus tallas y su stock real.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/catalogo"
            className={cn(
              "num border px-3.5 py-2 text-[13px] transition-colors",
              !talla ? "border-tinta bg-tiza" : "border-tinta bg-papel hover:bg-tiza-suave"
            )}
          >
            Todas
          </Link>
          {tallas.map((t) => (
            <Link
              key={t}
              href={`/catalogo?talla=${encodeURIComponent(t)}`}
              className={cn(
                "num border px-3.5 py-2 text-[13px] transition-colors",
                talla === t ? "border-tinta bg-tiza" : "border-tinta bg-papel hover:bg-tiza-suave"
              )}
            >
              {t}
            </Link>
          ))}
        </div>
        {visibles.length === 0 ? (
          <div className="sobre mt-12 p-8">
            <h2 className="font-display text-[28px]">Sin piezas para esta talla</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-tinta-suave">
              El taller aún no publica piezas en esa talla. Prueba con otra talla o mira el catálogo
              completo.
            </p>
            <Link href="/catalogo" className="bt-tiza rotulo mt-6 inline-block px-5 py-3.5 text-[11px]">
              Ver todo el catálogo
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibles.map((p, i) => (
              <PiezaCard key={p.id} producto={p} numero={i + 1} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
