import Link from "next/link";
import { listProducts } from "@/lib/db";
import { getErpnextConfig, getErpnextState } from "@/lib/erpnext";
import { formatPrecio, toPublicProduct } from "@/lib/public";
import { MSG_CATALOGO, waLink } from "@/lib/wa";
import { PiezaCard } from "@/components/tienda/pieza-card";
import { SiteFooter } from "@/components/tienda/site-footer";
import { SiteNav } from "@/components/tienda/site-nav";
import { Alfiler, FotoPieza, Sello, TallaChips } from "@/components/tienda/piezas";

export const dynamic = "force-dynamic";

function fechaCorta(iso: string): string {
  const fecha = new Date(`${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(fecha.getTime())) return "hoy";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(fecha)
    .toUpperCase()
    .replace(".", "");
}

export default async function Home() {
  const productos = listProducts({ status: "publicado", limit: 200 }).map(toPublicProduct);
  const hero = productos.find((p) => p.slug === "vestido-rosas") ?? productos[0];
  const piezas = productos.filter((p) => p.slug !== hero?.slug).slice(0, 4);
  const [erpCfg, erpEstado] = await Promise.all([getErpnextConfig(), getErpnextState()]);

  if (!hero) {
    return (
      <div>
        <SiteNav />
        <main className="mx-auto max-w-[1400px] px-6 py-32 lg:px-14">
          <h1 className="font-display text-[clamp(40px,5vw,64px)] leading-tight">
            La mesa de corte está lista.
          </h1>
          <p className="mt-4 max-w-[48ch] text-[16px] leading-relaxed text-tinta-suave">
            Aún no hay piezas publicadas. Cuando la propietaria apruebe la primera publicación de
            Paperclip, aparecerá aquí.
          </p>
          <Link href="/panel" className="bt-tiza rotulo mt-8 inline-block px-6 py-4 text-[12px]">
            Ir al panel de aprobaciones
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const precioHero = formatPrecio(hero.priceCents, hero.currency);
  const [tituloA, ...tituloResto] = hero.name.split(" ");
  const tituloB = tituloResto.join(" ");

  return (
    <div>
      <SiteNav />
      <main>
        <section className="mx-auto grid max-w-[1400px] gap-12 px-6 pt-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14 lg:px-14">
          <div className="sobre p-7 sm:p-9 lg:p-11">
            <div className="flex items-center justify-between rotulo text-[11px] text-tinta-suave">
              <span>Patrón Nº 360</span>
              <span>Hecho en Huancayo</span>
            </div>
            <h1 className="mt-8 font-display text-[clamp(52px,7vw,96px)] leading-[0.95] tracking-[-0.01em]">
              <span className="block">{tituloA}</span>
              {tituloB && (
                <span className="relative block italic text-berry">
                  {tituloB}
                  <svg
                    aria-hidden
                    className="absolute -bottom-2 left-0 h-3 w-[min(280px,60%)] text-tiza"
                    viewBox="0 0 280 12"
                    fill="none"
                  >
                    <path
                      d="M2 9C60 3 200 2 278 6"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      className="trazo-anim"
                    />
                  </svg>
                </span>
              )}
            </h1>
            <p className="mt-7 max-w-[52ch] text-[17px] leading-relaxed text-tinta-suave">
              {hero.description}
            </p>
            <div className="rotulo mt-7 text-[11px] text-tinta-suave">Tallas disponibles</div>
            <TallaChips variantes={hero.variants} className="mt-2" />
            <div className="relative mt-10 max-w-[560px]">
              <div className="trazo-tiza">
                <FotoPieza
                  nombre={hero.name}
                  imagen={hero.images[0]}
                  className="h-[300px] w-full sm:h-[360px]"
                />
              </div>
              <Alfiler className="-left-2 -top-2" />
              <Alfiler className="-right-2 -top-2" />
              <Alfiler className="-left-2 -bottom-2" />
              <div className="num absolute -left-3 bottom-8 rotate-[-4deg] border-[1.5px] border-tinta bg-papel px-3 py-2 text-[12px]">
                Talla 4 · {precioHero}
              </div>
            </div>
          </div>
          <aside className="flex flex-col items-start gap-6 pt-2">
            <Sello>
              Nuevo
              <br />
              ingreso
              <br />
              {fechaCorta(hero.createdAt)}
            </Sello>
            <h2 className="font-display text-[clamp(32px,3.4vw,46px)] leading-[1.06]">
              El stock que ves es real, no una promesa.
            </h2>
            <p className="max-w-[42ch] text-[16px] leading-relaxed text-tinta-suave">
              Cada talla muestra sus piezas reales: cuando una se agota se marca, y cuando llega
              mercadería nueva Angibell lo ajusta en su panel y esta página lo cuenta.
            </p>
            <div className="num text-[34px]">
              {precioHero}
              {hero.compareAtCents !== null && (
                <s className="rotulo ml-2 align-middle text-[11px] text-tinta-suave decoration-hilo-fuerte">
                  antes {formatPrecio(hero.compareAtCents, hero.currency)}
                </s>
              )}{" "}
              <span className="rotulo text-[11px] text-tinta-suave">la pieza</span>
            </div>
            <p className="num text-[14px] text-tinta-suave">
              Ahora mismo:{" "}
              {hero.variants
                .map((v) => `T${v.size} ${v.stock > 0 ? `${v.stock} disp.` : "agotado"}`)
                .join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              <Link href="/catalogo" className="bt-tiza rotulo px-6 py-4 text-[12px]">
                Ver el catálogo →
              </Link>
              <a
                href={waLink(
                  `Hola, me interesa la pieza ${hero.name} (${precioHero}) del catálogo de Angibell Creaciones.`
                )}
                className="rotulo border-[1.5px] border-tinta px-6 py-4 text-[12px] transition-colors hover:bg-tiza-suave"
              >
                Pedir esta pieza
              </a>
            </div>
            <div className="costura mt-2 w-full" />
            <p className="rotulo text-[10px] leading-relaxed text-tinta-suave">
              {erpCfg
                ? `Almacén conectado${erpEstado.company ? ` · ${erpEstado.company}` : ""}${erpEstado.warehouse ? ` · ${erpEstado.warehouse}` : ""}`
                : "Stock ajustado a mano por Angibell; Paperclip lo actualiza al publicar."}
            </p>
          </aside>
        </section>

        <section id="piezas" className="mx-auto max-w-[1400px] px-6 pt-24 lg:px-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="font-display text-[clamp(30px,3vw,42px)] leading-none">
              Piezas de hoy
            </h2>
            <Link
              href="/catalogo"
              className="rotulo text-[12px] underline decoration-tiza decoration-2 underline-offset-4 transition-colors hover:text-berry"
            >
              Ver todo el catálogo
            </Link>
          </div>
          {piezas.length === 0 ? (
            <p className="mt-8 text-[15px] text-tinta-suave">
              Las próximas piezas aparecerán aquí apenas se publiquen.
            </p>
          ) : (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {piezas.map((p, i) => (
                <PiezaCard key={p.id} producto={p} numero={i + 2} />
              ))}
            </div>
          )}
        </section>

        <section className="mx-auto max-w-[1400px] px-6 pt-24 lg:px-14">
          <div className="sobre flex flex-col justify-between gap-8 bg-tiza p-10 md:flex-row md:items-center lg:p-14">
            <h2 className="max-w-[24ch] font-display text-[clamp(30px,3.2vw,44px)] leading-tight">
              ¿Ya sabes qué talla buscas? Te la separamos.
            </h2>
            <a href={waLink(MSG_CATALOGO)} className="bt-tinta rotulo shrink-0 px-7 py-4 text-[12px]">
              Escribir por WhatsApp
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
