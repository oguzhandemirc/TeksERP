// =============================================================================
// TEZGAH SALONU — görünüm (veriden bağımsız)
// =============================================================================
// Veriyi çağıran verir: uygulamada `WeavingFloorPage` (`useLoomFloorLive`, gerçek
// veri), geliştirme önizlemesinde mock. Tasarım: docs/design/DOKUMA-CANLI-EKRAN.md.
// `tv` = salon TV'si kipi: açılışta tam ekran, menü/düğme/çıkış yok, dokunuş detay açmaz.
// =============================================================================
import { useCallback, useMemo, useState } from "react";
import { Maximize2, Tv } from "lucide-react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { TabPortalProvider } from "@/components/layout/tabs/tab-portal";
import { cn } from "@/lib/utils";
import { FloorSummary } from "./FloorSummary";
import { FullscreenHeader, SampleDataBadge, StatusLegend } from "./FloorChrome";
import { HallSection } from "./HallSection";
import { LoomDetailSheet } from "./LoomDetailSheet";
import { OverdueStrip } from "./OverdueStrip";
import { ShowFilterPicker, showFilterPredicate, type ShowFilter } from "./ShowFilterPicker";
import { hsl } from "./palette";
import { shiftStarLoom, summarizeFloor } from "./metrics";
import { useFullscreen } from "./useFullscreen";
import type { FloorState } from "./types";
import "./weaving-floor.css";

function bestHallOf(halls: readonly { hall: string; pct: number | null }[]): string | null {
  const ranked = halls.filter((h) => h.pct !== null).sort((a, b) => b.pct! - a.pct!);
  return ranked[0]?.hall ?? null;
}

const noSelect = () => undefined;

interface ViewProps {
  floor: FloorState;
  now: number;
  /** Önizleme verisi — "Örnek veri" rozeti basılır. */
  sampleData: boolean;
  tv?: boolean;
  /** Başlıkta veri durumu (örn. "bağlantı koptu") — opsiyonel. */
  notice?: React.ReactNode;
  /** Veri tazelenemiyor — tam ekran başlığındaki "Canlı" damgası uyarıya döner. */
  stale?: boolean;
  /** Verilirse başlıkta "TV kipi" düğmesi (onaylı) — bu pencereyi menüsüz TV kipine geçirir. */
  onOpenTv?: () => void;
  /** Onay penceresinde gösterilecek TV adresi (web paneli varsa). */
  tvUrl?: string | null;
}

function TvButton({ onOpenTv, tvUrl }: { onOpenTv: () => void; tvUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const where = tvUrl ? ` Salon TV'sinin tarayıcısında bu adresi açın: ${tvUrl}` : "";
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Tv className="mr-1.5 h-4 w-4" />
        TV kipi
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Bu pencere TV kipine geçsin mi?"
        description={`TV kipinde menü, düğme ve çıkış yoktur; ekran kendini tazeler. Çıkmak için uygulamayı yeniden açın ya da adresi değiştirin.${where}`}
        confirmLabel="TV kipine geç"
        onConfirm={() => {
          setOpen(false);
          onOpenTv();
        }}
      />
    </>
  );
}

export function WeavingFloorView({ floor, now, sampleData, tv = false, notice, stale = false, onOpenTv, tvUrl = null }: ViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShowFilter>("ALL");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(root, { locked: tv });
  const select = useCallback((id: string) => setSelectedId(id), []);
  const onSelect = tv ? noSelect : select;

  const predicate = showFilterPredicate(filter, now);
  const halls = floor.halls.map((hall) => {
    const all = floor.looms.filter((t) => t.hall === hall);
    return { hall, all, visible: all.filter(predicate), pct: summarizeFloor(all, now).todayPct };
  });
  const bestHall = bestHallOf(halls);
  const starId = useMemo(() => shiftStarLoom(floor.looms), [floor.looms]);
  const selected = floor.looms.find((t) => t.id === selectedId) ?? null;
  const empty = halls.every((h) => h.visible.length === 0);
  // Tam ekranda bütün holler aynı kolon ızgarasında: en kalabalık hol tek satıra sığar.
  const columns = fullscreen.active ? Math.max(...halls.map((h) => h.all.length)) : undefined;

  return (
    <PageShell>
      <div
        ref={setRoot}
        className={cn("relative flex min-h-0 flex-1 flex-col", fullscreen.active && "fixed inset-0 z-[60] text-[1.3rem]")}
        style={{ background: hsl("var(--ds-floor)") }}
      >
        <TabPortalProvider value={root}>
          {fullscreen.active ? (
            <FullscreenHeader
              now={now}
              sampleData={sampleData}
              updatedAt={floor.updatedAt}
              stale={stale}
              onExit={tv ? undefined : fullscreen.exit}
              legend={<StatusLegend />}
            />
          ) : (
            <PageHeader
              title="Tezgah Salonu"
              titleExtra={sampleData ? <SampleDataBadge /> : notice}
              actions={
                <>
                  <ShowFilterPicker value={filter} onChange={setFilter} />
                  {onOpenTv && <TvButton onOpenTv={onOpenTv} tvUrl={tvUrl} />}
                  <Button variant="outline" onClick={fullscreen.enter}>
                    <Maximize2 className="mr-1.5 h-4 w-4" />
                    Tam ekran
                  </Button>
                </>
              }
            />
          )}
          <PageBody className={cn("min-h-0 space-y-4 p-4", fullscreen.active && "space-y-3 px-6 pt-3")}>
            <FloorSummary floor={floor} now={now} />
            <OverdueStrip looms={floor.looms} now={now} onSelect={onSelect} />
            {halls
              .filter((h) => h.visible.length > 0)
              .map((h) => (
                <HallSection
                  key={h.hall}
                  hall={h.hall}
                  looms={h.visible}
                  now={now}
                  columns={columns}
                  highlight={{ starId, bestHall: h.hall === bestHall, onSelect }}
                />
              ))}
            {empty && (
              <p className="py-10 text-center text-muted-foreground">
                {floor.looms.length === 0
                  ? "Salonda gösterilecek dokuma tezgahı yok."
                  : "Bu seçimde tezgah yok — Göster: Tümü ile hepsini açın."}
              </p>
            )}
            {!fullscreen.active && <StatusLegend />}
          </PageBody>
          <LoomDetailSheet loom={selected} now={now} onClose={() => setSelectedId(null)} />
        </TabPortalProvider>
      </div>
    </PageShell>
  );
}
