"use client";

import { useState } from "react";
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
export type ConexionesMeta = { facebook: boolean; instagram: boolean; publicMedia: boolean };

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
      <p role="status" className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-tinta-suave">
        <span>Facebook: {conexiones?.facebook ? "Página/token configurados" : "falta Página/token"}</span>
        <span>Instagram: {conexiones?.instagram ? "cuenta/token configurados" : "falta cuenta/token"}</span>
        {!conexiones?.publicMedia && <span>Falta URL HTTPS pública para las fotos</span>}
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
              disabled={!conexiones?.facebook || !conexiones.publicMedia || publicando === `${borrador.id}:facebook` || borrador.publications?.facebook?.status === "published" || borrador.publications?.facebook?.status === "unknown" || borrador.publications?.facebook?.status === "publishing"}
              className="rotulo text-[11px]"
              onClick={() => publicar(borrador.id, "facebook")}
            >
              {publicando === `${borrador.id}:facebook` ? "Enviando a Facebook…" : "Publicar en Facebook"}
            </Button>
            <Button
              type="button"
              disabled={!conexiones?.instagram || !conexiones.publicMedia || publicando === `${borrador.id}:instagram` || borrador.publications?.instagram?.status === "published" || borrador.publications?.instagram?.status === "unknown" || borrador.publications?.instagram?.status === "publishing"}
              className="rotulo text-[11px]"
              onClick={() => publicar(borrador.id, "instagram")}
            >
              {publicando === `${borrador.id}:instagram` ? "Enviando a Instagram…" : "Publicar en Instagram"}
            </Button>
          </div>
        </li>
      ))}
      </ul>}
    </div>
  );
}
