// Salon TV'si — kabuksuz ekran (App `Root` `#/tezgah-tv`te bunu çizer): kapılar `tv-entry`
// (`tvGateOf`), görünüm `WeavingFloorPage tv`. Sayfa başlığı router ister; TV'nin adres
// çubuğuyla bağı yok, bu yüzden kendi bellek router'ı içinde çizilir.
import { MemoryRouter } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { useOperationsVisibilityContext } from "../useOperationsVisibility";
import { TEZGAH_TV_PERMISSION, TEZGAH_TV_SCREEN, tvGateOf, type TvGate } from "./tv-entry";
import { WeavingFloorPage } from "./WeavingFloorPage";

const CLOSED_TEXT: Record<Exclude<TvGate, "OPEN" | "WAIT">, string> = {
  NO_PERMISSION: "Bu hesabın Tezgah Salonu'nu görme izni yok (dokuma canlı izleme). İzin panelden atanır.",
  MODULE_CLOSED: "Tezgah izleme modülü bu kurulumda kapalı.",
};

function TvClosed({ reason }: { reason: Exclude<TvGate, "OPEN" | "WAIT"> }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center" data-testid="tv-closed">
      <p className="max-w-xl text-lg font-semibold">{CLOSED_TEXT[reason]}</p>
      <Button variant="outline" onClick={() => (window.location.hash = "#/")}>
        Uygulamaya dön
      </Button>
    </div>
  );
}

export function WeavingFloorTvScreen() {
  const { hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const gate = tvGateOf({
    permitted: hasPermission(TEZGAH_TV_PERMISSION),
    flagsReady: ctx.flagsReady,
    flagsFailed: ctx.flagsFailed,
    moduleOpen: isRouteModuleOpen(TEZGAH_TV_SCREEN, ctx),
  });
  if (gate === "WAIT") return null;
  return <MemoryRouter>{gate === "OPEN" ? <WeavingFloorPage tv /> : <TvClosed reason={gate} />}</MemoryRouter>;
}
