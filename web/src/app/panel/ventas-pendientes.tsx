"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrecio } from "@/lib/public";

export type VentaPendiente = {
  id: string;
  customerPhone: string | null;
  items: Array<{ name: string; sku: string; quantity: number; priceCents: number }>;
  subtotalCents: number;
  deliveryMethod: "pickup" | "delivery";
  deliveryZone: string;
  deliveryAddress: string;
  requestedDate: string;
  createdAt: string;
};

export function VentasPendientes({
  ventas,
  error,
}: {
  ventas: VentaPendiente[];
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decidir(id: string, action: "approve" | "reject", form: FormData) {
    setBusy(id);
    try {
      const endpoint = `/api/sales-requests/${id}/${action}`;
      const payload = action === "approve"
        ? {
            deliveryDate: String(form.get("deliveryDate") || ""),
            shippingCents: Math.round(Number(form.get("shippingSoles") || 0) * 100),
          }
        : { reason: String(form.get("reason") || "").trim() };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string | { message?: string };
        checkoutUrl?: string;
      };
      if (!response.ok) {
        const message = typeof result.error === "string" ? result.error : result.error?.message;
        throw new Error(message || "No se pudo actualizar la solicitud.");
      }
      if (action === "approve") {
        toast.success("Venta aprobada con tus condiciones", {
          description: result.checkoutUrl
            ? `Enlace de pago de prueba: ${result.checkoutUrl}`
            : "La fecha, el envío y el stock quedaron registrados.",
          duration: 12_000,
        });
      } else {
        toast.message("Solicitud rechazada; se guardó el motivo.");
      }
      router.refresh();
    } catch (cause) {
      toast.error("No se pudo procesar la venta", {
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <p className="border border-hilo-fuerte/60 bg-papel px-4 py-3 text-[14px] leading-relaxed text-tinta">
        No se pudo conectar con el motor de ventas: {error}
      </p>
    );
  }
  if (ventas.length === 0) {
    return <p className="py-2 text-[15px] text-tinta-suave">No hay solicitudes pendientes de revisión.</p>;
  }

  return (
    <ul className="divide-y divide-linea">
      {ventas.map((venta) => (
        <li key={venta.id} className="py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-[22px]">Solicitud {venta.id.slice(0, 8)}</h3>
              <p className="mt-1 text-[14px] text-tinta-suave">
                {venta.customerPhone || "Cliente web"} · {venta.deliveryMethod === "delivery" ? `Delivery: ${venta.deliveryZone}` : "Recojo"}
              </p>
            </div>
            <p className="num text-[16px]">Subtotal {formatPrecio(venta.subtotalCents)}</p>
          </div>
          <ul className="mt-4 space-y-1 text-[14px]">
            {venta.items.map((item) => (
              <li key={item.sku} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <span>{item.name} · {item.sku} × {item.quantity}</span>
                <span className="num">{formatPrecio(item.priceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          {venta.deliveryMethod === "delivery" && (
            <p className="mt-3 text-[13px] leading-relaxed text-tinta-suave">
              Dirección: {venta.deliveryAddress || "sin dirección"} · Fecha solicitada: {venta.requestedDate || "sin indicar"}
            </p>
          )}
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(form) => decidir(venta.id, "approve", form)}
            >
              <label className="flex flex-col gap-1 text-[12px]">
                <span>Fecha confirmada</span>
                <Input name="deliveryDate" type="date" required className="h-9 w-44" />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span>Envío (S/)</span>
                <Input
                  name="shippingSoles"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={venta.deliveryMethod === "pickup" ? "0" : ""}
                  className="h-9 w-28"
                />
              </label>
              <Button type="submit" disabled={busy === venta.id} className="rotulo text-[11px]">
                {busy === venta.id ? "Validando…" : "Aprobar y generar pago de prueba"}
              </Button>
            </form>
            <form
              className="flex flex-wrap items-end gap-3"
              action={(form) => decidir(venta.id, "reject", form)}
            >
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[12px]">
                <span>Motivo para rechazar</span>
                <Input name="reason" required maxLength={300} className="h-9" placeholder="Indica por qué no procede" />
              </label>
              <Button type="submit" variant="outline" disabled={busy === venta.id} className="rotulo text-[11px]">
                Rechazar
              </Button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
