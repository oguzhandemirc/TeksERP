// =============================================================================
// TEZGAH SALONU — uygulama ekranı (gerçek veri; `/operations/weaving-floor`)
// =============================================================================
// Kapı: route `loom:live-view` + `ROUTE_MODULE` `tezgahEnabled`; backend aynı iki kapı.
// Veri `useLoomFloorLive` (5 sn yoklama); görünüm `WeavingFloorView`; `tv` = menüsüz TV
// bağlantısı (`#/tezgah-tv`, `WeavingFloorTvScreen`). Örnek veri
// yalnız geliştirme önizlemesinde (`preview/weavingFloorPreview.tsx`).
// =============================================================================
import { WifiOff } from "lucide-react";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatFactory } from "@/lib/factory-time";
import { useLoomFloorLive } from "./useLoomFloorLive";
import { WeavingFloorView } from "./WeavingFloorView";
import { buildTezgahTvUrl, closeTezgahTvWindow, exitTezgahTvHere, isSeparateTvWindow, openTezgahTvHere } from "./tv-entry";

/** Tazeleme koptuğunda eldeki veri gösterilir ama yaşı açıkça yazılır. */
function StaleNotice({ updatedAt }: { updatedAt: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">
      <WifiOff className="h-3.5 w-3.5" />
      Bağlantı yok — son veri {formatFactory(updatedAt, "HH:mm:ss")}
    </span>
  );
}

/** Ayrı TV penceresinde çıkış pencereyi kapatır; aynı pencerede kabuğa döner. */
function tvExitOf() {
  return isSeparateTvWindow()
    ? { onExit: closeTezgahTvWindow, label: "Pencereyi kapat", windowed: true }
    : { onExit: exitTezgahTvHere, label: "TV kipinden çık" };
}

export function WeavingFloorPage({ tv = false }: { tv?: boolean }) {
  const live = useLoomFloorLive();
  if (!live.floor) {
    return (
      <PageShell>
        <PageHeader title="Tezgah Salonu" />
        <PageBody className="p-4">
          <p className="py-10 text-center text-muted-foreground">
            {live.error ? `Salon verisi okunamadı: ${live.error.message}` : "Salon verisi yükleniyor…"}
          </p>
        </PageBody>
      </PageShell>
    );
  }
  return (
    <WeavingFloorView
      floor={live.floor}
      now={live.now}
      sampleData={false}
      tv={tv}
      stale={live.stale}
      notice={live.stale ? <StaleNotice updatedAt={live.floor.updatedAt} /> : undefined}
      onOpenTv={tv ? undefined : openTezgahTvHere}
      tvUrl={tv ? null : buildTezgahTvUrl()}
      tvExit={tv ? tvExitOf() : undefined}
    />
  );
}
