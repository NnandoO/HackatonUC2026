"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { waLink } from "@/lib/wa";

type Variante = { size: string; stock: number; stockFuente?: "declarado" };

export function TallaPicker({
  nombre,
  precio,
  variantes,
  stockEstimado = false,
}: {
  nombre: string;
  precio: string;
  variantes: Variante[];
  stockEstimado?: boolean;
}) {
  const primeraConStock = variantes.find((v) => v.stock > 0)?.size ?? null;
  const [talla, setTalla] = useState<string | null>(primeraConStock);
  const todoAgotado = primeraConStock === null;

  const mensaje = talla
    ? `Hola, me interesa la pieza ${nombre} en talla ${talla} (${precio}) del catálogo de Angibell Creaciones.`
    : `Hola, me interesa la pieza ${nombre} (${precio}) del catálogo de Angibell Creaciones.`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="rotulo text-[12px]">Elige tu talla</span>
        <span className="rotulo text-[10px] text-tinta-suave">
          {stockEstimado ? "stock provisional de demostración" : "stock disponible"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tallas disponibles">
        {variantes.map((v) => {
          const activa = talla === v.size;
          return (
            <button
              key={v.size}
              type="button"
              aria-pressed={activa}
              disabled={v.stock === 0}
              onClick={() => v.stock > 0 && setTalla(v.size)}
              className={cn(
                "num border px-4 py-3 text-[16px] transition-colors",
                v.stock === 0
                  ? "cursor-not-allowed border-dashed border-tinta-suave text-tinta-suave line-through"
                  : activa
                    ? "border-tinta bg-tiza shadow-lift"
                    : "border-tinta bg-papel hover:bg-tiza-suave"
              )}
            >
              {v.size}
            </button>
          );
        })}
      </div>
      {talla && (
        <p className="num mt-3 text-[13px] text-tinta-suave">
          {(() => {
            const v = variantes.find((x) => x.size === talla)!;
            const tallaLabel = talla.toLowerCase() === "por definir" ? "talla por confirmar" : `talla ${talla}`;
            if (stockEstimado) return `${v.stock} ${v.stock === 1 ? "unidad estimada" : "unidades estimadas"} · ${tallaLabel}; confirmar existencia real`;
            return `${v.stock} ${v.stock === 1 ? "pieza disponible" : "piezas disponibles"} en ${tallaLabel}`;
          })()}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-4">
        <a href={waLink(mensaje)} className="bt-tiza rotulo px-6 py-4 text-[12px]">
          {stockEstimado || precio === "Precio por confirmar" ? "Consultar por WhatsApp" : talla ? `Pedir talla ${talla} por WhatsApp` : "Pedir por WhatsApp"}
        </a>
      </div>
      {todoAgotado && (
        <p className="mt-4 border-[1.5px] border-dashed border-hilo-fuerte px-4 py-3 text-[14px] text-hilo-fuerte">
          Agotado por ahora. Escríbenos y te avisamos apenas el taller lo reponga.
        </p>
      )}
    </div>
  );
}
