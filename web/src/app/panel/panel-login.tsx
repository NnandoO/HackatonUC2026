"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogoAngibell } from "@/components/logo-angibell";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PanelLogin() {
  const router = useRouter();
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/panel/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: clave }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "No se pudo entrar");
      toast.success("Bienvenida al panel");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card className="border-[1.5px] border-tinta shadow-papel">
      <CardHeader>
        <LogoAngibell className="mb-2 size-16" />
        <CardTitle className="font-display text-[30px]">Panel de Angibell</CardTitle>
        <CardDescription>
          Aprueba publicaciones y revisa el stock del taller. Solo para la propietaria.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={entrar} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clave" className="rotulo text-[11px]">
              Clave del panel
            </Label>
            <Input
              id="clave"
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-[14px] text-hilo-fuerte">{error}</p>}
          <Button type="submit" disabled={cargando} className="rotulo w-full text-[12px]">
            {cargando ? "Entrando…" : "Entrar al panel"}
          </Button>
        </form>
        <p className="rotulo mt-6 text-[10px] text-tinta-suave">
          Demo SORYNTEL · clave de demostración: angibell360
        </p>
      </CardContent>
    </Card>
  );
}
