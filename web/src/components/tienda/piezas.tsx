import { cn } from "@/lib/utils";
import type { PublicVariant } from "@/lib/public";

export function Alfiler({ className }: { className?: string }) {
  return <span aria-hidden className={cn("alfiler", className)} />;
}

export function FotoPieza({
  nombre,
  imagen,
  className,
}: {
  nombre: string;
  imagen?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden border-[1.5px] border-tinta bg-papel", className)}>
      {imagen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagen} alt={`Foto de ${nombre}`} className="h-full w-full object-cover" />
      ) : (
        <div className="foto-pendiente h-full w-full">
          <span className="rotulo px-4 text-center text-[11px] text-tinta-suave">
            Foto pendiente · llega del taller
          </span>
        </div>
      )}
    </div>
  );
}

export function Sello({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sello flex h-28 w-28 items-center justify-center px-3 text-center rotulo text-[11px] leading-relaxed",
        className
      )}
    >
      <span className="relative z-10">{children}</span>
    </div>
  );
}

export function TallaChips({
  variantes,
  className,
  stockEstimado = false,
}: {
  variantes: Pick<PublicVariant, "size" | "stock">[];
  className?: string;
  stockEstimado?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {variantes.map((v) => (
        <span
          key={v.size}
          title={v.stock > 0 ? `${v.stock}${stockEstimado ? " unidades estimadas; confirmar disponibilidad" : " disponibles"}` : "agotado"}
          className={cn(
            "num border px-2.5 py-1 text-[13px]",
            v.stock > 0
              ? "border-tinta bg-tiza"
              : "border-dashed border-tinta-suave text-tinta-suave line-through"
          )}
        >
          {v.size}
        </span>
      ))}
    </div>
  );
}
