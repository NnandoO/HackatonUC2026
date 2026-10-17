"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type Pendiente = {
  id: number;
  name: string;
  precio: string;
  fuente: string;
  tallas: string;
  descripcion: string;
};

export function Aprobaciones({ pendientes }: { pendientes: Pendiente[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function decidir(p: Pendiente, accion: "aprobar" | "rechazar") {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/publications/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: accion }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        producto?: { name?: string };
        almacen?: { estado?: string; aviso?: string };
      };
      if (!res.ok) throw new Error(j.error ?? "No se pudo completar");
      const nombre = j.producto?.name ?? p.name;
      if (accion === "aprobar") {
        toast.success(`${nombre} ya está publicada`, {
          description:
            j.almacen?.aviso ??
            (j.almacen?.estado === "ok"
              ? "Sincronizada con el almacén."
              : "Quedó declarada mientras el almacén se conecta."),
        });
      } else {
        toast.message(`${nombre} fue rechazada`, {
          description: "No aparecerá en el catálogo.",
        });
      }
      router.refresh();
    } catch (err) {
      toast.error("No se pudo completar", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  if (pendientes.length === 0) {
    return (
      <p className="py-2 text-[15px] text-tinta-suave">
        No hay publicaciones esperando. Cuando Paperclip suba una, aparecerá aquí para tu revisión.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-linea">
      {pendientes.map((p) => (
        <li key={p.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-[24px] leading-tight">{p.name}</h3>
              <Badge className="rotulo border-[1.5px] border-tinta bg-papel text-[10px] text-tinta">
                {p.fuente}
              </Badge>
            </div>
            <p className="num mt-1 text-[14px] text-tinta-suave">
              {p.precio} · {p.tallas}
            </p>
            {p.descripcion && (
              <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-tinta-suave">
                {p.descripcion}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-3">
            <Button
              onClick={() => decidir(p, "aprobar")}
              disabled={busy === p.id}
              className="rotulo text-[11px]"
            >
              {busy === p.id ? "…" : "Aprobar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => decidir(p, "rechazar")}
              disabled={busy === p.id}
              className="rotulo border-hilo-fuerte text-[11px] text-hilo-fuerte hover:bg-hilo-fuerte hover:text-papel-claro"
            >
              Rechazar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
