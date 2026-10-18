import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { listProducts, listPublications } from "@/lib/db";
import { isPanelAuthenticated } from "@/lib/panel-auth";
import { formatPrecio, toPublicProduct } from "@/lib/public";
import { LogoAngibell } from "@/components/logo-angibell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { Aprobaciones, type Pendiente } from "./aprobaciones";
import { AlmacenManual, type PiezaAlmacen } from "./almacen-manual";
import { LogoutButton } from "./logout-button";
import { PanelLogin } from "./panel-login";
import { VentasPendientes, type VentaPendiente } from "./ventas-pendientes";
import { coreApiFetch } from "@/lib/core-api";
import { BorradoresMeta, type BorradorMeta, type ConexionesMeta } from "./borradores-meta";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Panel",
};

function fechaHora(iso: string): string {
  const fecha = new Date(`${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(fecha.getTime())) return iso;
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(fecha);
}

export default async function PanelPage() {
  const authed = await isPanelAuthenticated();
  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[520px] items-center px-6 py-16">
        <div className="w-full">
          <PanelLogin />
        </div>
        <Toaster />
      </main>
    );
  }

  const todos = listProducts({ limit: 200 }).map(toPublicProduct);
  const pendientes: Pendiente[] = todos
    .filter((p) => p.status === "pendiente")
    .map((p) => ({
      id: p.id,
      name: p.name,
      precio: formatPrecio(p.priceCents, p.currency),
      fuente: p.status === "pendiente" ? "esperando revisión" : p.status,
      tallas:
        p.variants.map((v) => `T${v.size}:${v.stock}`).join(" · ") ||
        "sin tallas",
      descripcion: p.description,
    }));
  const registro = listPublications(20);
  const enAprobacion = todos.filter((p) => p.status === "pendiente").length;
  const publicados = todos.filter((p) => p.status === "publicado").length;
  let ventasPendientes: VentaPendiente[] = [];
  let errorVentas: string | null = null;
  try {
    const response = await coreApiFetch("/v1/admin/sales-requests?limit=50", { admin: true });
    const result = await response.json() as { items?: VentaPendiente[]; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message || `API respondió ${response.status}`);
    ventasPendientes = result.items ?? [];
  } catch (error) {
    errorVentas = error instanceof Error ? error.message : "API comercial no disponible";
  }
  let borradoresMeta: BorradorMeta[] = [];
  let conexionesMeta: ConexionesMeta | null = null;
  let errorMeta: string | null = null;
  try {
    const response = await coreApiFetch("/v1/admin/social-drafts?limit=50", { admin: true });
    const result = await response.json() as { items?: BorradorMeta[]; connections?: ConexionesMeta; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message || `API respondió ${response.status}`);
    borradoresMeta = result.items ?? [];
    conexionesMeta = result.connections ?? null;
  } catch (error) {
    errorMeta = error instanceof Error ? error.message : "API comercial no disponible";
  }

  const secciones = [
    { href: "#ventas", nombre: "Ventas por validar", n: ventasPendientes.length },
    { href: "#por-aprobar", nombre: "Por aprobar", n: enAprobacion },
    { href: "#meta", nombre: "Meta por revisar", n: borradoresMeta.length },
    { href: "#catalogo", nombre: "Catálogo", n: todos.length },
    { href: "#almacen", nombre: "Almacén", n: publicados },
    { href: "#registro", nombre: "Registro", n: registro.length },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1240px] gap-10 px-6 py-8 lg:px-10">
      <aside className="sticky top-8 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col lg:flex">
        <LogoAngibell />
        <p className="rotulo mt-3 text-[10px] text-tinta-suave">
          panel de la propietaria · huancayo
        </p>
        <nav className="mt-10 flex flex-col">
          {secciones.map((s, i) => (
            <a
              key={s.href}
              href={s.href}
              className="flex items-baseline justify-between border-b border-linea py-3.5 transition-colors first:border-t hover:text-berry"
            >
              <span className="font-display text-[17px]">
                <span className="num mr-3 text-[11px] text-tinta-suave">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.nombre}
              </span>
              <span className="num text-[12px] text-tinta-suave">{s.n}</span>
            </a>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-linea pt-5">
          <Link
            href="/"
            className="rotulo text-[11px] underline decoration-tiza decoration-2 underline-offset-4 hover:text-berry"
          >
            Ver la tienda
          </Link>
          <LogoutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-4 lg:hidden">
          <div className="flex items-center gap-3">
            <LogoAngibell />
            <p className="rotulo text-[10px] text-tinta-suave">
              panel · huancayo
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="rotulo text-[11px] underline decoration-tiza decoration-2 underline-offset-4 hover:text-berry"
            >
              Ver la tienda
            </Link>
            <LogoutButton />
          </div>
        </header>
        <nav className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-linea pb-4 lg:hidden">
          {secciones.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="flex items-baseline gap-2 transition-colors hover:text-berry"
            >
              <span className="font-display text-[16px]">{s.nombre}</span>
              <span className="num text-[11px] text-tinta-suave">{s.n}</span>
            </a>
          ))}
        </nav>

        <div className="mt-10 space-y-10">
          <section id="ventas" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3 font-display text-[26px]">
                  Ventas por validar
                  <Badge className="rotulo border-[1.5px] border-tinta bg-tiza text-[10px] text-tinta">
                    {ventasPendientes.length} pendientes
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Confirma personalmente stock, fecha y costo de envío. El pago de prueba solo se prepara después de tu aprobación.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <VentasPendientes ventas={ventasPendientes} error={errorVentas} />
              </CardContent>
            </Card>
          </section>

          <section id="por-aprobar" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 font-display text-[26px]">
                  Por aprobar
                  <Badge className="rotulo border-[1.5px] border-tinta bg-tiza text-[10px] text-tinta">
                    {enAprobacion} esperando
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Publicaciones que Paperclip dejó esperando tu revisión.
                  Aprobar publica la pieza en el catálogo; rechazar la deja
                  fuera.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Aprobaciones pendientes={pendientes} />
              </CardContent>
            </Card>
          </section>

          <section id="meta" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3 font-display text-[26px]">
                  Publicaciones para revisar
                  <Badge className="rotulo border-[1.5px] border-tinta bg-tiza text-[10px] text-tinta">
                    {borradoresMeta.length} preparadas
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Facebook e Instagram publican al pulsar su botón cuando sus credenciales están conectadas y la imagen tiene URL HTTPS pública.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BorradoresMeta borradores={borradoresMeta} error={errorMeta} conexiones={conexionesMeta} />
              </CardContent>
            </Card>
          </section>

          <section id="catalogo" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="font-display text-[26px]">
                  Catálogo
                </CardTitle>
                <CardDescription>
                  Todas las piezas de la tienda con su estado y el stock por
                  talla.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="rotulo text-[10px]">
                        Pieza
                      </TableHead>
                      <TableHead className="rotulo text-[10px]">
                        Estado
                      </TableHead>
                      <TableHead className="rotulo text-[10px]">
                        Precio
                      </TableHead>
                      <TableHead className="rotulo text-[10px]">
                        Stock por talla
                      </TableHead>
                      <TableHead className="rotulo text-[10px]">
                        Origen
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todos.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-display text-[18px]">
                          {p.name}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "rotulo border-[1.5px] text-[10px]",
                              p.status === "publicado"
                                ? "border-tinta bg-tiza text-tinta"
                                : p.status === "rechazado"
                                  ? "border-hilo-fuerte bg-hilo-fuerte text-papel-claro"
                                  : "border-dashed border-tinta-suave bg-papel text-tinta-suave",
                            )}
                          >
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="num text-[14px]">
                          {formatPrecio(p.priceCents, p.currency)}
                        </TableCell>
                        <TableCell className="num text-[13px] text-tinta-suave">
                          {p.variants
                            .map((v) => `T${v.size}:${v.stock}`)
                            .join(" · ")}
                        </TableCell>
                        <TableCell className="rotulo text-[10px] text-tinta-suave">
                          {p.status === "pendiente" ? "Paperclip" : "Taller"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          <section id="almacen" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3 font-display text-[26px]">
                  Almacén
                  <Badge className="rotulo border-[1.5px] border-tinta bg-tiza text-[10px] text-tinta">
                    ajuste a mano
                  </Badge>
                </CardTitle>
                <CardDescription>
                  El stock llega desde Paperclip al publicar cada pieza; aquí lo
                  corriges con tus dedos cuando vendes o aparece ropa nueva.
                  Cada cambio se refleja al instante en la tienda.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlmacenManual
                  piezas={todos
                    .filter((p) => p.status === "publicado")
                    .map<PiezaAlmacen>((p) => ({
                      id: p.id,
                      name: p.name,
                      variants: p.variants.map((v) => ({
                        id: v.id,
                        size: v.size,
                        stock: v.stock,
                      })),
                    }))}
                />
              </CardContent>
            </Card>
          </section>

          <section id="registro" className="scroll-mt-8">
            <Card className="border-[1.5px] border-tinta bg-card shadow-papel">
              <CardHeader>
                <CardTitle className="font-display text-[26px]">
                  Registro de publicaciones
                </CardTitle>
                <CardDescription>
                  Todo lo que entró por la API, con su hora.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {registro.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span className="text-[15px]">{r.note}</span>
                      <span className="num text-[12px] text-tinta-suave">
                        {fechaHora(r.receivedAt)}
                      </span>
                    </li>
                  ))}
                  {registro.length === 0 && (
                    <li className="text-[15px] text-tinta-suave">
                      Aún no llega ninguna publicación.
                    </li>
                  )}
                </ul>
                <Separator className="my-6" />
                <p className="max-w-[70ch] text-[14px] leading-relaxed text-tinta-suave">
                  Paperclip sube publicaciones a{" "}
                  <span className="num">POST /api/publications</span> con la
                  cabecera <span className="num">X-API-Key</span>. La página
                  nunca publica sola: esta lista es la auditoría de lo recibido.
                </p>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
      <Toaster />
    </div>
  );
}
