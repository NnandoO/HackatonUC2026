"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AlmacenPanel({ urlInicial }: { urlInicial?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(urlInicial ?? "http://localhost:8080");
  const [usr, setUsr] = useState("Administrator");
  const [pwd, setPwd] = useState("");
  const [conectando, setConectando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setConectando(true);
    try {
      const res = await fetch("/api/erpnext/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, usr, pwd }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        usuario?: string;
        company?: string;
        warehouse?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "No se pudo conectar");
      toast.success("Almacén conectado", {
        description: [j.usuario && `Usuario: ${j.usuario}`, j.company, j.warehouse]
          .filter(Boolean)
          .join(" · "),
      });
      setPwd("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo conectar el almacén", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setConectando(false);
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const res = await fetch("/api/stock", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        productos?: number;
        almacen?: { itemsCreated?: number; receipts?: number; stockRefreshed?: number; errores?: string[] };
      };
      if (!res.ok) throw new Error(j.error ?? "No se pudo sincronizar");
      const a = j.almacen ?? {};
      const errores = a.errores ?? [];
      toast.success("Sincronización terminada", {
        description: `${j.productos ?? 0} piezas revisadas · ${a.itemsCreated ?? 0} artículos nuevos · ${a.receipts ?? 0} ingresos · ${a.stockRefreshed ?? 0} stocks refrescados${errores.length ? ` · ${errores.length} con problemas` : ""}`,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo sincronizar", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={conectar} className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="erp-url" className="rotulo text-[11px]">
            Dirección del almacén
          </Label>
          <Input id="erp-url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="erp-usr" className="rotulo text-[11px]">
            Usuario
          </Label>
          <Input id="erp-usr" value={usr} onChange={(e) => setUsr(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="erp-pwd" className="rotulo text-[11px]">
            Clave
          </Label>
          <Input
            id="erp-pwd"
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={conectando} className="rotulo text-[11px]">
          {conectando ? "Conectando…" : "Conectar"}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[60ch] text-[14px] leading-relaxed text-tinta-suave">
          Al conectar, la página crea compañía, almacén y grupo de artículos en ERPNext, y registra
          cada variante publicada como artículo con su ingreso de stock.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={sincronizar}
          disabled={sincronizando}
          className="rotulo text-[11px]"
        >
          {sincronizando ? "Sincronizando…" : "Sincronizar stock ahora"}
        </Button>
      </div>
    </div>
  );
}
