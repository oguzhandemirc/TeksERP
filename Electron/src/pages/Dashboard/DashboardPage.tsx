import { useQuery } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { StationLoad } from "./StationLoad";
import { fetchPano, fetchPanoHareketler } from "./dashboardService";
import { PanoHeader } from "./pano/PanoHeader";
import { PanoKpiSeridi } from "./pano/PanoKpiSeridi";
import { PanoDagilim, PanoEgilim } from "./pano/PanoGrafikKutulari";
import { BoxError, PanoMovementList, PanoHizliEylemler } from "./pano/PanoMovementList";
import { PanoAlacak, PanoBekleyen, PanoEnCok, PanoFason, PanoStok, PanoTezgah } from "./pano/PanoOzetKutulari";
import { Hucre, PanoRow } from "./pano/PanoYerlesim";
import { HIZLI_EYLEMLER } from "./pano/pano-hedefler";
import { usePanoDonem } from "./pano/usePanoDonem";
import { usePanoErisim } from "./pano/usePanoErisim";
import { PANO_HAREKET_UC_IZINLERI, PANO_UC_IZINLERI, type PanoSummary } from "./pano/types";

const egilimVar = (s: PanoSummary) => s.egilim.noktalar.some((n) => n.uretimMetre !== null || n.sevkMetre !== null);
const bekleyenVar = (b: PanoSummary["bekleyen"]) => Boolean(b.onayBekleyenBelge || b.sevkeHazir || b.uretimeGonderilmemisSiparis !== null);

/** Açılış panosu: dönem seçici bütün dönemli kutuları sürer; hareketler dönemden bağımsız ayrı sorgu. */
export function DashboardPage() {
  const { hasAnyPermission, hasPermission } = useRoleAccess();
  const erisim = usePanoErisim();
  const [donem, setDonem] = usePanoDonem();
  const panoIzni = hasAnyPermission(PANO_UC_IZINLERI);
  const hareketIzni = hasAnyPermission(PANO_HAREKET_UC_IZINLERI);
  const pano = useQuery({ queryKey: ["dashboard", "pano", donem], queryFn: () => fetchPano(donem), enabled: panoIzni, staleTime: 60_000 });
  const hareket = useQuery({ queryKey: ["dashboard", "hareketler"], queryFn: fetchPanoHareketler, enabled: hareketIzni, staleTime: 60_000 });
  const s = pano.data;

  return (
    <PageShell>
      <PageBody className="space-y-5 p-6">
        <PanoHeader donem={donem} onDonem={setDonem} donemGoster={panoIzni}
          eylem={<RefreshButton queryKey="dashboard" successMessage="Anasayfa yenilendi" />} />
        {panoIzni && pano.isError && !s ? (
          <div className="rounded-xl border border-card-border bg-card shadow-card"><BoxError onYenile={() => void pano.refetch()} /></div>
        ) : (
          <PanoKpiSeridi kpi={s?.kpi ?? null} donem={donem} erisim={erisim} yukleniyor={panoIzni && pano.isLoading} />
        )}
        {panoIzni && pano.isLoading && <SkeletonRow />}
        <PanoRow>
          {s && egilimVar(s) && <Hucre agirlik={2} genis><PanoEgilim egilim={s.egilim} /></Hucre>}
          {s?.dagilim && <Hucre><PanoDagilim dagilim={s.dagilim} /></Hucre>}
          {s && bekleyenVar(s.bekleyen) && <Hucre><PanoBekleyen b={s.bekleyen} erisim={erisim} /></Hucre>}
        </PanoRow>
        <PanoRow>
          {hareketIzni && (
            <Hucre agirlik={2} genis>
              <PanoMovementList hareketler={hareket.data?.hareketler} yukleniyor={hareket.isLoading} hata={hareket.isError} onYenile={() => void hareket.refetch()} erisim={erisim} />
            </Hucre>
          )}
          {s && (s.enCok.uretilen || s.enCok.sevkEdilen) && <Hucre><PanoEnCok enCok={s.enCok} erisim={erisim} /></Hucre>}
          {HIZLI_EYLEMLER.some((e) => erisim.canGo(e)) && <Hucre><PanoHizliEylemler erisim={erisim} /></Hucre>}
        </PanoRow>
        {s && (
          <PanoRow>
            {s.tezgah && <Hucre><PanoTezgah t={s.tezgah} erisim={erisim} /></Hucre>}
            {s.stokOzeti && <Hucre><PanoStok s={s.stokOzeti} erisim={erisim} /></Hucre>}
            {(s.fasonOzeti || s.emanet) && <Hucre><PanoFason f={s.fasonOzeti} emanet={s.emanet} erisim={erisim} /></Hucre>}
            {s.finans && <Hucre><PanoAlacak f={s.finans} erisim={erisim} /></Hucre>}
          </PanoRow>
        )}
        {/* Eski panodan: istasyon doluluğu (canlı kuyruk/aktif) — izin yoksa bileşen kendini gizler. */}
        {hasPermission("station:read") && <StationLoad />}
      </PageBody>
    </PageShell>
  );
}

function SkeletonRow() {
  return (
    <div className="grid gap-4 md:grid-cols-2 min-[1101px]:grid-cols-4" data-testid="pano-iskelet">
      <div className="skeleton-shimmer h-72 rounded-xl bg-muted md:col-span-2" />
      <div className="skeleton-shimmer h-72 rounded-xl bg-muted" />
      <div className="skeleton-shimmer h-72 rounded-xl bg-muted" />
    </div>
  );
}
