import Link from "next/link";
import { LogoAngibell } from "@/components/logo-angibell";
import { MSG_CATALOGO, waLink } from "@/lib/wa";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-[1.5px] border-tinta/70">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-12 lg:grid-cols-3 lg:px-14">
        <div>
          <LogoAngibell className="size-16" />
          <p className="mt-3 max-w-[32ch] text-[15px] leading-relaxed text-tinta-suave">
            Ropa para niñas de 0 a 14 años, con el stock que Angibell ajusta a mano cada día.
          </p>
        </div>
        <div>
          <div className="rotulo text-[11px] text-tinta-suave">La tienda</div>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <Link className="underline decoration-tiza decoration-2" href="/catalogo">
                Catálogo completo
              </Link>
            </li>
            <li>
              <Link className="underline decoration-tiza decoration-2" href="/#piezas">
                Piezas de hoy
              </Link>
            </li>
            <li>
              <a className="underline decoration-tiza decoration-2" href={waLink(MSG_CATALOGO)}>
                Pedir por WhatsApp
              </a>
            </li>
          </ul>
        </div>
        <div>
          <div className="rotulo text-[11px] text-tinta-suave">Para la propietaria</div>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <Link className="underline decoration-tiza decoration-2" href="/panel">
                Panel de aprobaciones
              </Link>
            </li>
            <li>
              <a className="underline decoration-tiza decoration-2" href="/api/health">
                Estado del sistema
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="costura mx-auto max-w-[calc(1400px-3rem)] lg:max-w-[calc(1400px-7rem)]" />
      <p className="mx-auto max-w-[1400px] px-6 py-6 rotulo text-[10px] leading-relaxed text-tinta-suave lg:px-14">
        Demo SORYNTEL · catálogo de muestra: prendas, precios y tallas son datos de demostración,
        y las fotos reales llegarán del taller una por una.
      </p>
    </footer>
  );
}
