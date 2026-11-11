import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fetchPanoCatalog } from "./dashboardService";
import { PanoAddSheet } from "./pano/PanoAddSheet";
import { PanoBoard } from "./pano/PanoBoard";
import { BoxFailed } from "./pano/PanoBoxFrame";
import { PanoHeader } from "./pano/PanoHeader";
import { HIZLI_EYLEMLER } from "./pano/pano-hedefler";
import { usePanoBoxData, type AgendaParams } from "./pano/usePanoBoxData";
import { usePanoDonem } from "./pano/usePanoDonem";
import { usePanoErisim } from "./pano/usePanoErisim";
import { usePanoLayout } from "./pano/usePanoLayout";
import { PANO_UC_IZINLERI } from "./pano/types";

const NO_CATALOG: never[] = [];

/**
 * Açılış panosu — kutu (widget) düzeni. Katalog bir kez; yalnız ekli kutuların verisi istenir (aynı tikteki
 * kutular tek istekte). Düzen kullanıcı tercihinde; düzenleme kipinde veri isteği atılmaz.
 */
export function DashboardPage() {
  const { hasAnyPermission, hasPermission } = useRoleAccess();
  const erisim = usePanoErisim();
  const [donem, setDonem] = usePanoDonem();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [agenda, setAgenda] = useState<AgendaParams>({});
  const panoIzni = hasAnyPermission(PANO_UC_IZINLERI);
  const catalog = useQuery({ queryKey: ["pano-catalog"], queryFn: fetchPanoCatalog, enabled: panoIzni, staleTime: Infinity });

  const quickOk = HIZLI_EYLEMLER.some((e) => erisim.canGo(e));
  const stationOk = hasPermission("station:read");
  const localAvailable = useMemo(() => new Set([...(quickOk ? ["hizliIslemler"] : []), ...(stationOk ? ["istasyonDoluluk"] : [])]), [quickOk, stationOk]);
  const layout = usePanoLayout(panoIzni ? catalog.data : NO_CATALOG, localAvailable);
  const states = usePanoBoxData(layout.boxes, donem, agenda, panoIzni && !editing);
  const added = useMemo(() => new Set(layout.boxes.map((b) => b.anahtar)), [layout.boxes]);
  const periodic = layout.boxes.some((b) => b.donemli);

  return (
    <PageShell>
      <PageBody className="space-y-5 p-6">
        <PanoHeader donem={donem} onDonem={setDonem} donemGoster={panoIzni && periodic}
          eylem={<RefreshButton queryKey="dashboard" successMessage="Anasayfa yenilendi" />}
          edit={layout.available.length > 0 ? {
            editing, isDefault: layout.isDefault,
            onStart: () => setEditing(true), onDone: () => { setEditing(false); setAdding(false); },
            onAdd: () => setAdding(true), onReset: layout.reset,
          } : undefined} />
        {panoIzni && catalog.isError && !catalog.data ? (
          <BoxFailed title="Pano" onRetry={() => void catalog.refetch()} />
        ) : panoIzni && catalog.isLoading ? (
          <BoardSkeleton />
        ) : (
          <PanoBoard boxes={layout.boxes} states={states} editing={editing}
            ctx={{ donem, erisim, onAgenda: setAgenda, agendaLoading: states.ajanda?.fetching ?? false }}
            onRemove={layout.remove} onReorder={layout.reorder} />
        )}
        {editing && layout.boxes.length === 0 && (
          <p className="rounded-xl border-2 border-dashed border-card-border py-10 text-center text-sm text-muted-foreground">Panoda kutu yok — “Kutu ekle” ile başla.</p>
        )}
        <PanoAddSheet open={adding} onOpenChange={setAdding} available={layout.available} added={added}
          onToggle={(key, add) => (add ? layout.add(key) : layout.remove(key))} />
      </PageBody>
    </PageShell>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" data-testid="pano-iskelet">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-shimmer h-28 rounded-xl bg-muted" />)}
      </div>
      <div className="grid gap-4 md:grid-cols-2 min-[1101px]:grid-cols-12">
        <div className="skeleton-shimmer h-72 rounded-xl bg-muted md:col-span-2 min-[1101px]:col-span-8" />
        <div className="skeleton-shimmer h-72 rounded-xl bg-muted min-[1101px]:col-span-4" />
      </div>
    </div>
  );
}
