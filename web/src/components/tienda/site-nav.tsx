import Link from "next/link";
import { LogoAngibell } from "@/components/logo-angibell";
import { MSG_CATALOGO, waLink } from "@/lib/wa";

const enlaces: Array<[string, string]> = [
  ["Catálogo", "/catalogo"],
  ["Probar asesora", "/simulator"],
  ["Piezas de hoy", "/#piezas"],
  ["Panel", "/panel"],
];

export function SiteNav() {
  return (
    <header className="border-b-[1.5px] border-tinta/70">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-4 lg:px-14">
        <Link href="/" className="flex items-center gap-3">
          <LogoAngibell priority />
          <span className="rotulo hidden text-[10px] text-tinta-suave sm:inline">huancayo</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {enlaces.map(([texto, href]) => (
            <Link
              key={href}
              href={href}
              className="rotulo text-[12px] transition-colors hover:text-berry"
            >
              {texto}
            </Link>
          ))}
        </nav>
        <a href={waLink(MSG_CATALOGO)} className="bt-tiza rotulo px-4 py-2.5 text-[11px]">
          Pedir por WhatsApp
        </a>
      </div>
    </header>
  );
}
