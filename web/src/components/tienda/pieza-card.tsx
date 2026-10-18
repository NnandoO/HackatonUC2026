import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatPrecio, type PublicProduct } from "@/lib/public";
import { Alfiler, FotoPieza } from "./piezas";

export function PiezaCard({ producto, numero }: { producto: PublicProduct; numero: number }) {
  const agotado = producto.totalStock === 0;
  const pocas = !agotado && producto.totalStock <= 3;
  const precio = producto.priceCents > 0
    ? formatPrecio(producto.priceCents, producto.currency)
    : "Precio por confirmar";
  return (
    <Link href={`/producto/${producto.slug}`} className="pieza-card group block">
      <Alfiler className="left-3 top-3" />
      <Alfiler className="right-3 top-3" />
      <div className="p-4 pb-0">
        <FotoPieza nombre={producto.name} imagen={producto.images[0]} className="h-44 w-full" />
      </div>
      <div className="relative p-4">
        <span className="num absolute right-4 top-4 text-[13px] text-tinta-suave">
          #{String(numero).padStart(2, "0")}
        </span>
        <h3 className="pr-10 font-display text-[26px] leading-tight">{producto.name}</h3>
        <div className="rotulo mt-1.5 text-[11px] text-tinta-suave">
          {producto.variants.map((v) => v.size).join(" · ")}
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span className="num text-[19px]">
            {precio}
            {producto.compareAtCents !== null && (
              <s className="rotulo ml-2 align-middle text-[10px] text-tinta-suave decoration-hilo-fuerte">
                antes {formatPrecio(producto.compareAtCents, producto.currency)}
              </s>
            )}
          </span>
          <span
            className={cn(
              "rotulo border px-2 py-1 text-[10px]",
              agotado
                ? "border-hilo-fuerte text-hilo-fuerte"
                : pocas
                  ? "border-hilo-fuerte bg-papel text-hilo-fuerte"
                  : "border-tinta bg-papel"
            )}
          >
            {agotado ? "agotado" : producto.stockEstimado ? `stock demo: ${producto.totalStock}` : pocas ? `quedan ${producto.totalStock}` : "en almacén"}
          </span>
        </div>
        <span className="rotulo mt-3 inline-block text-[11px] text-berry opacity-0 transition-opacity group-hover:opacity-100">
          Ver la pieza →
        </span>
      </div>
    </Link>
  );
}
