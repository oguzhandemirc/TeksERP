// Yeni iş emri ekranında "Belge okut" (P3 → K6): seçilen rota şablonuyla belge fotoğrafı yükle → aynı sayfa belgeden
// dolan iş emri formuna geçer (kısayol formuyla tek yol). Gelen belge modülü kapalıysa ya da yazma izni yoksa çizilmez.
import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { routeService } from "@/pages/Routes/service";
import { UploadDialog } from "@/pages/Operations/GelenBelgeler/UploadDialog";
import { useTabsStore } from "@/store/tabs";
import { WORK_ORDER_NEW_PATH, type OieStart } from "./oie/nav";

interface Props {
  /** Formda seçili rota şablonu (Rota Seç ya da iş emri şablonunun rotası); yoksa düğme pasif. */
  routeTemplateId: string | null;
  className?: string;
}

export const BELGE_OKUT_NO_ROUTE = "Önce Üretim Rotası'ndan kayıtlı bir rota şablonu seçin.";

export function BelgeOkutButton({ routeTemplateId, className }: Props) {
  const enabled = useGelenBelgeEnabled();
  const { hasPermission } = useRoleAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // Okut anındaki rota donar: yükleme sürerken formda rota değişse de belge o rotayla açılır.
  const [frozenRoute, setFrozenRoute] = useState<string | null>(null);
  if (!enabled || !hasPermission("gelen-belge:write")) return null;
  const onDone = async (noteId: string, routeId: string) => {
    const name = await routeService.getById(routeId).then((r) => r.data?.name ?? "Rota", () => "Rota");
    const start: OieStart = { kind: "shortcut", route: { id: routeId, name }, noteId };
    navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: start } });
  };
  return (
    <>
      <Button
        type="button"
        onClick={() => setFrozenRoute(routeTemplateId)}
        disabled={!routeTemplateId}
        title={routeTemplateId ? "Belge fotoğrafını okut; form belgeden dolar" : BELGE_OKUT_NO_ROUTE}
        className={className}
        data-testid="wo-belge-okut"
      >
        <ScanLine className="h-4 w-4" />
        Belge okut
      </Button>
      {frozenRoute && (
        <UploadDialog
          open
          onOpenChange={(o) => !o && setFrozenRoute(null)}
          target={{ kind: "new" }}
          onDone={(note) => {
            const routeId = frozenRoute;
            setFrozenRoute(null);
            void onDone(note.id, routeId);
          }}
        />
      )}
    </>
  );
}
