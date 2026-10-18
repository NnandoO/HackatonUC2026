"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type BorradorMeta = {
  id: string;
  productId: string;
  caption: string;
  imageUrls: string[];
  status: string;
  publications?: Partial<Record<"facebook" | "instagram", { status: string; remoteId?: string | null; error?: string | null }>>;
};
export type ConexionesMeta = { facebook: boolean; facebookPageName?: string; facebookOAuthConfigured?: boolean; instagram: boolean; publicMedia: boolean; publishEnabled: boolean };

export function BorradoresMeta({
  borradores,
  error,
  conexiones,
}: {
  borradores: BorradorMeta[];
  error: string | null;
  conexiones: ConexionesMeta | null;
}) {
  const router = useRouter();
  const [publicando, setPublicando] = useState<string | null>(null);
  const [facebookBusy, setFacebookBusy] = useState(false);
  const [facebookPages, setFacebookPages] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("facebook");
    if (status === "choose-page") {
      fetch("/api/meta/facebook/pages").then((response) => response.json()).then((result: { pages?: { id: string; name: string }[] }) => setFacebookPages(result.pages ?? [])).catch(() => toast.error("No se pudieron cargar las Páginas de Facebook."));
    } else if (status === "connected") toast.success("Página de Facebook conectada");
    else if (status === "cancelled") toast.info("Conexión con Facebook cancelada");
    else if (status === "failed") toast.error("Facebook no pudo completar la conexión. Revisa la configuración de Meta.");
    else if (status === "login-required") toast.error("Inicia sesión en el panel y vuelve a conectar Facebook.");
  }, []);

  async function conectarFacebook() {
    setFacebookBusy(true);
    try {
      const response = await fetch("/api/meta/facebook/connect", { method: "POST" });
      const result = await response.json() as { authorizationUrl?: string; error?: string | { message?: string } };
      const errorMessage = typeof result.error === "string" ? result.error : result.error?.message;
      if (!response.ok || !result.authorizationUrl) throw new Error(errorMessage || "Configura primero las credenciales OAuth de Meta.");
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      toast.error("No se pudo iniciar Facebook", { description: cause instanceof Error ? cause.message : undefined });
      setFacebookBusy(false);
    }
  }

  async function seleccionarPagina(pageId: string) {
    setFacebookBusy(true);
    try {
      const response = await fetch("/api/meta/facebook/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo conectar la Página.");
      setFacebookPages([]);
      toast.success("Página de Facebook conectada");
      router.refresh();
    } catch (cause) {
      toast.error("No se pudo guardar la Página", { description: cause instanceof Error ? cause.message : undefined });
    } finally { setFacebookBusy(false); }
  }

  async function desconectarFacebook() {
    setFacebookBusy(true);
    try {
      const response = await fetch("/api/meta/facebook", { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo desconectar Facebook.");
      toast.success("Facebook desconectado");
      router.refresh();
    } catch (cause) {
      toast.error("No se pudo desconectar Facebook", { description: cause instanceof Error ? cause.message : undefined });
    } finally { setFacebookBusy(false); }
  }

  async function publicar(id: string, provider: "facebook" | "instagram") {
    const key = `${id}:${provider}`;
    setPublicando(key);
    try {
      const response = await fetch(`/api/social-drafts/${id}/publish-${provider}`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; mediaId?: string };
      if (!response.ok) throw new Error(result.error || `${provider} no confirmó la publicación.`);
      toast.success(`${provider === "facebook" ? "Facebook" : "Instagram"} confirmó la publicación`, { description: result.mediaId });
      router.refresh();
    } catch (cause) {
      toast.error(`No se publicó en ${provider === "facebook" ? "Facebook" : "Instagram"}`, {
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setPublicando(null);
    }
  }

  if (error) return <p className="text-[14px] leading-relaxed text-tinta-suave">{error}</p>;

  return (
    <div>
      <section className="mb-6 rounded-xl border border-linea p-4" aria-label="Conexión con Facebook">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium">Facebook</p>
            <p className="text-[12px] text-tinta-suave">{conexiones?.facebook ? `Conectado: ${conexiones.facebookPageName || "Página configurada"}` : "Conecta una Página para habilitar su publicación."}</p>
          </div>
          {conexiones?.facebook ? (
            <Button type="button" variant="outline" className="rotulo text-[11px]" disabled={facebookBusy} onClick={desconectarFacebook}>Desconectar</Button>
          ) : (
            <Button type="button" variant="outline" className="rotulo text-[11px]" disabled={facebookBusy || !conexiones?.facebookOAuthConfigured} onClick={conectarFacebook}>
              {facebookBusy ? "Conectando…" : conexiones?.facebookOAuthConfigured ? "Conectar Facebook" : "Falta configurar Meta OAuth"}
            </Button>
          )}
        </div>
        {facebookPages.length > 0 && <div className="mt-4 space-y-2" aria-live="polite">
          <p className="text-[12px] text-tinta-suave">Elige la Página que usará ANGIBELL para publicar:</p>
          {facebookPages.map((page) => <Button key={page.id} type="button" variant="outline" className="mr-2 rotulo text-[11px]" disabled={facebookBusy} onClick={() => seleccionarPagina(page.id)}>{page.name}</Button>)}
        </div>}
      </section>
      <p role="status" className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-tinta-suave">
        <span>Facebook: {conexiones?.facebook ? "Página/token configurados" : "falta Página/token"}</span>
        <span>Instagram: {conexiones?.instagram ? "cuenta/token configurados" : "falta cuenta/token"}</span>
        {!conexiones?.publicMedia && <span>Falta URL HTTPS pública para las fotos</span>}
        {!conexiones?.publishEnabled && <span>Publicación externa desactivada en este demo</span>}
      </p>
      {borradores.length === 0 ? (
        <p className="text-[15px] text-tinta-suave">Aún no hay textos preparados para revisar.</p>
      ) : <ul className="divide-y divide-linea">
      {borradores.map((borrador) => (
        <li key={borrador.id} className="py-5 first:pt-0 last:pb-0">
          <p className="mb-3 whitespace-pre-line text-[14px] leading-relaxed">{borrador.caption}</p>
          {Object.entries(borrador.publications ?? {}).map(([provider, publication]) => (
            <p key={provider} className="mb-2 text-[12px] text-tinta-suave">
              {provider === "facebook" ? "Facebook" : "Instagram"}: {publication?.status === "published" ? `publicado (${publication.remoteId})` : publication?.status === "unknown" ? "resultado incierto; verifica Meta antes de reintentar" : publication?.status === "failed" ? `falló: ${publication.error || "revisa la configuración"}` : publication?.status === "publishing" ? "enviando" : "sin publicar"}
            </p>
          ))}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="rotulo text-[11px]"
              onClick={async () => {
                await navigator.clipboard.writeText(borrador.caption);
                toast.success("Texto copiado");
              }}
            >
              Copiar texto
            </Button>
            <Button
              type="button"
              disabled={!conexiones?.publishEnabled || !conexiones.facebook || !conexiones.publicMedia || publicando === `${borrador.id}:facebook` || borrador.publications?.facebook?.status === "published" || borrador.publications?.facebook?.status === "unknown" || borrador.publications?.facebook?.status === "publishing"}
              className="rotulo text-[11px]"
              onClick={() => publicar(borrador.id, "facebook")}
            >
              {publicando === `${borrador.id}:facebook` ? "Enviando a Facebook…" : conexiones?.publishEnabled ? "Publicar en Facebook" : "Facebook desactivado"}
            </Button>
            <Button
              type="button"
              disabled={!conexiones?.publishEnabled || !conexiones.instagram || !conexiones.publicMedia || publicando === `${borrador.id}:instagram` || borrador.publications?.instagram?.status === "published" || borrador.publications?.instagram?.status === "unknown" || borrador.publications?.instagram?.status === "publishing"}
              className="rotulo text-[11px]"
              onClick={() => publicar(borrador.id, "instagram")}
            >
              {publicando === `${borrador.id}:instagram` ? "Enviando a Instagram…" : conexiones?.publishEnabled ? "Publicar en Instagram" : "Instagram desactivado"}
            </Button>
          </div>
        </li>
      ))}
      </ul>}
    </div>
  );
}
