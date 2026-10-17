"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PiezaAlmacen = {
  id: number;
  name: string;
  variants: Array<{ id: number; size: string; stock: number }>;
};

export function AlmacenManual({ piezas }: { piezas: PiezaAlmacen[] }) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<number | null>(null);

  async function guardar(e: React.FormEvent<HTMLFormElement>, pieza: PiezaAlmacen) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const updates = pieza.variants.map((v) => ({
      variantId: v.id,
      stock: Math.max(0, Math.round(Number(datos.get(`v-${v.id}`) ?? v.stock))),
    }));
    setGuardando(pieza.id);
    try {
      const res = await fetch("/api/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; actualizadas?: number };
      if (!res.ok) throw new Error(j.error ?? "No se pudo guardar");
      toast.success(`Stock de ${pieza.name} guardado`, {
        description: `${j.actualizadas ?? updates.length} tallas actualizadas.`,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar el stock", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setGuardando(null);
    }
  }

  if (piezas.length === 0) {
    return (
      <p className="py-2 text-[15px] text-tinta-suave">
        Todavía no hay piezas publicadas con stock que ajustar.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-linea">
      {piezas.map((p) => (
        <li key={p.id} className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="min-w-0 font-display text-[20px] leading-tight">{p.name}</h3>
          <form
            onSubmit={(e) => guardar(e, p)}
            className="flex flex-wrap items-center justify-end gap-x-4 gap-y-3"
          >
            {p.variants.map((v) => (
              <label key={v.id} className="flex items-center gap-1.5">
                <span className="num text-[12px] text-tinta-suave">{v.size}</span>
                <Input
                  name={`v-${v.id}`}
                  type="number"
                  min={0}
                  defaultValue={v.stock}
                  className="num h-8 w-16 px-2 text-[13px]"
                />
              </label>
            ))}
            <Button
              type="submit"
              variant="outline"
              disabled={guardando === p.id}
              className="rotulo text-[11px]"
            >
              {guardando === p.id ? "Guardando…" : "Guardar"}
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
