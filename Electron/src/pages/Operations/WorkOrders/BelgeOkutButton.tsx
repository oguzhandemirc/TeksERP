// Yeni iş emri ekranında "Belge okut" (P3 → K6 → S16d): belge fotoğrafı yükle → `onScanned` verilmişse klasik form yerinde
// dolar; verilmemişse belgeden dolan iş emri formuna geçer (kısayol formuyla tek yol). Gelen belge modülü kapalıysa ya da yazma izni yoksa çizilmez.
import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { routeService } from "@/pages/Routes/service";
import { UploadDialog } from "@/pages/Operations/GelenBelgeler/UploadDialog";
import { useTabsStore } from "@/store/tabs";
import { SCAN_ROUTE_REF, WORK_ORDER_NEW_PATH, type OieStart } from "./oie/nav";
import { useScanRouteOption } from "./oie/useScanRouteOption";
import { routeHasKursunStep } from "./oie/service";

interface Props {
  /** Formda seçili rota şablonu (Rota Seç ya da iş emri şablonunun rotası); yoksa düğme pasif. */
  routeTemplateId: string | null;
  className?: string;
  /** S16d: verilirse okutulan belge bu formda YERİNDE dolar (ayrı forma geçilmez). */
  onScanned?: (noteId: string) => void;
}

export const BELGE_OKUT_NO_ROUTE = "Önce Üretim Rotası'ndan kayıtlı bir rota şablonu seçin.";

export function BelgeOkutButton({ routeTemplateId, className, onScanned }: Props) {
  const enabled = useGelenBelgeEnabled();
  const { hasPermission } = useRoleAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // Okut anındaki rota donar: yükleme sürerken formda rota değişse de belge o rotayla açılır. "" = rotasız (K29).
  const [frozenRoute, setFrozenRoute] = useState<string | null>(null);
  // K29 S14b: "Okutmayla" kipinde rota seçilmeden okutulan belge rotasız İE açar (SIRALI'da düğme bugünkü gibi pasif).
  const scanRoute = useScanRouteOption();
  if (!enabled || !hasPermission("gelen-belge:write")) return null;
  const canScan = !!routeTemplateId || scanRoute;
  const onDone = async (noteId: string, routeId: string) => {
    if (onScanned) {
      onScanned(noteId);
      return;
    }
    if (!routeId) {
      navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: { kind: "shortcut", route: SCAN_ROUTE_REF, noteId } satisfies OieStart } });
      return;
    }
    const route = await routeService.getById(routeId).then((r) => r.data ?? null, () => null);
    const start: OieStart = { kind: "shortcut", route: { id: routeId, name: route?.name ?? "Rota", ...(route ? { hasKursun: routeHasKursunStep(route.steps) } : {}) }, noteId };
    navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: start } });
  };
  return (
    <>
      {/* Pasif düğme fare olayı almaz (title görünmez) → neden sarmalayıcıda da durur. */}
      <span className="inline-flex" title={canScan ? undefined : BELGE_OKUT_NO_ROUTE} data-testid="wo-belge-okut-wrap">
        <Button
          type="button"
          onClick={() => setFrozenRoute(routeTemplateId ?? "")}
          disabled={!canScan}
          title={routeTemplateId ? "Belge fotoğrafını okut; form belgeden dolar" : canScan ? `Rota seçilmedi → ${SCAN_ROUTE_REF.name}` : BELGE_OKUT_NO_ROUTE}
          className={className}
          data-testid="wo-belge-okut"
        >
          <ScanLine className="h-4 w-4" />
          {routeTemplateId ? "Belge okut" : canScan ? "Belge okut (rotasız)" : "Belge okut (önce rota)"}
        </Button>
      </span>
      {frozenRoute !== null && (
        <UploadDialog
          open
          autoSend
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
