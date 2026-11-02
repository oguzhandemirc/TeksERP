// Yeni iş emri ekranında "Belge okut" (P3): seçilen rota şablonuyla belge fotoğrafı yükle → okunan taslağı tek kartta
// onayla → iş emri sunucuda o rotayla açılır. Gelen belge modülü kapalıysa ya da yazma izni yoksa düğme çizilmez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { routeService } from "@/pages/Routes/service";
import { BelgeOkutDialog } from "@/pages/Operations/GelenBelgeler/BelgeOkutDialog";
import { UploadDialog } from "@/pages/Operations/GelenBelgeler/UploadDialog";

interface Props {
  /** Formda seçili rota şablonu (Rota Seç ya da iş emri şablonunun rotası); yoksa düğme pasif. */
  routeTemplateId: string | null;
  className?: string;
}

export const BELGE_OKUT_NO_ROUTE = "Önce Üretim Rotası'ndan kayıtlı bir rota şablonu seçin.";

export function BelgeOkutButton({ routeTemplateId, className }: Props) {
  const enabled = useGelenBelgeEnabled();
  const { hasPermission } = useRoleAccess();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  // Okut anındaki rota donar: kart açıkken formda rota değişse de onay o rotayla gider.
  const [frozenRoute, setFrozenRoute] = useState<string | null>(null);
  const route = useQuery({
    queryKey: ["routes", "detail", frozenRoute],
    queryFn: () => routeService.getById(frozenRoute!),
    enabled: !!frozenRoute,
    staleTime: 60_000,
  });
  if (!enabled || !hasPermission("gelen-belge:write")) return null;
  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setFrozenRoute(routeTemplateId);
          setUploadOpen(true);
        }}
        disabled={!routeTemplateId}
        title={routeTemplateId ? "Belge fotoğrafını okut, onayla ve bu rotayla aç" : BELGE_OKUT_NO_ROUTE}
        className={className}
        data-testid="wo-belge-okut"
      >
        <ScanLine className="h-4 w-4" />
        Belge okut
      </Button>
      {uploadOpen && (
        <UploadDialog
          open
          onOpenChange={setUploadOpen}
          target={{ kind: "new" }}
          onDone={(note) => setNoteId(note.id)}
        />
      )}
      {noteId && frozenRoute && (
        <BelgeOkutDialog
          open
          noteId={noteId}
          routeTemplateId={frozenRoute}
          routeName={route.data?.data?.name ?? null}
          onOpenChange={(o) => {
            if (!o) setNoteId(null);
          }}
        />
      )}
    </>
  );
}
