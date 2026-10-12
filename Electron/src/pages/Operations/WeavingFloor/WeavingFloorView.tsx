// =============================================================================
// TEZGAH SALONU — görünüm (veriden bağımsız)
// =============================================================================
// Veriyi çağıran verir: uygulamada `WeavingFloorPage` (`useLoomFloorLive`, gerçek
// veri), geliştirme önizlemesinde mock. Tasarım: docs/design/DOKUMA-CANLI-EKRAN.md.
// `tv` = salon TV'si kipi: açılışta tam ekran, menü/düğme yok, dokunuş detay açmaz; çıkış köşe
// düğmesi + Esc (`TvExit`). İpuçları (`FloorHint`) TV dışında açık.
// =============================================================================
import { useCallback, useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { TabPortalProvider } from "@/components/layout/tabs/tab-portal";
import { cn } from "@/lib/utils";
import { FloorSummary } from "./FloorSummary";
import { AlarmShiftStrip, LinkedAlarmShiftStrip } from "@/components/AlarmShiftStrip";
import { FullscreenHeader, SampleDataBadge, StatusLegend } from "./FloorChrome";
import { FloorHintProvider } from "./FloorHint";
import { FloorMenuArea, SelectionBar, useFloorSelection, type FloorJobs, type FloorSelectionState } from "./FloorSelection";
import { JobDialogs, type JobDialogState } from "./jobs/JobDialogs";
import { STOP_ACTION_KEYS, type RunActionKey, type StopActionKey } from "./floorActions";
import { StopBulkDialog, type StopDialogMode } from "./stops/StopBulkDialog";
import { HallSection } from "./HallSection";
import { LoomDetailSheet } from "./LoomDetailSheet";
import { OverdueStrip } from "./OverdueStrip";
import { ShowFilterPicker, showFilterPredicate, type ShowFilter } from "./ShowFilterPicker";
import { hsl } from "./palette";
import { shiftStarLoom, summarizeFloor } from "./metrics";
import { TvExitControl, type TvSoundControl } from "./TvExit";
import { TvLaunchMenu } from "./TvLaunchMenu";
import { useFullscreen } from "./useFullscreen";
import type { ClickMods } from "./selection";
import type { FloorState, LiveLoom } from "./types";
import "./weaving-floor.css";

const STOP_MODE: Record<StopActionKey, StopDialogMode> = { stopOpen: "open", stopClose: "close", stopRevoke: "revoke" };
const isStopKey = (k: string): k is StopActionKey => (STOP_ACTION_KEYS as readonly string[]).includes(k);

function bestHallOf(halls: readonly { hall: string; pct: number | null }[]): string | null {
  const ranked = halls.filter((h) => h.pct !== null).sort((a, b) => b.pct! - a.pct!);
  return ranked[0]?.hall ?? null;
}

const noSelect = () => undefined;
const noCardSelect = (_id: string, _mods: ClickMods) => undefined;

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
  /** Verilirse başlıkta "TV kipi" menüsü: bu pencerede (onaylı) ya da ayrı pencerede (Electron). */
  onOpenTv?: () => void;
  /** Onay penceresinde gösterilecek TV adresi (web paneli varsa). */
  tvUrl?: string | null;
  /** TV kipinde görünür çıkış (köşe düğmesi + Esc); `windowed` = ayrı TV penceresi (tam ekran düğmeyle). */
  tvExit?: { onExit: () => void; label: string; windowed?: boolean; sound?: TvSoundControl };
  /** Açılışta detayı açık tezgah (alarm sayfasından "Tezgah Salonunda göster"). */
  initialSelectedId?: string | null;
  /** Verilirse detayda canlı alarmın sayfasına bağlantı (TV kipinde verilmez). */
  onOpenAlarm?: (alarmId: string) => void;
}

interface AppHeaderProps {
  extra: React.ReactNode;
  filter: React.ReactNode;
  tv: React.ReactNode;
  onFullscreen: () => void;
}

function AppHeader({ extra, filter, tv, onFullscreen }: AppHeaderProps) {
  return (
    <PageHeader
      title="Tezgah Salonu"
      titleExtra={extra}
      actions={
        <>
          {filter}
          {tv}
          <Button variant="outline" onClick={onFullscreen}>
            <Maximize2 className="mr-1.5 h-4 w-4" />
            Tam ekran
          </Button>
        </>
      }
    />
  );
}

type HallRow = { hall: string; all: LiveLoom[]; visible: LiveLoom[]; pct: number | null };

/** Hol satırları + görünen sıra: Shift aralığı, Ctrl+A ve "bu süzgeçte görünmüyor" sayısı buradan. */
function useFloorModel(floor: FloorState, now: number, filter: ShowFilter) {
  const predicate = showFilterPredicate(filter, now);
  const halls: HallRow[] = floor.halls.map((hall) => {
    const all = floor.looms.filter((t) => t.hall === hall);
    return { hall, all, visible: all.filter(predicate), pct: summarizeFloor(all, now).todayPct };
  });
  const present = useMemo(() => new Set(floor.looms.map((t) => t.id)), [floor.looms]);
  const starId = useMemo(() => shiftStarLoom(floor.looms), [floor.looms]);
  return {
    halls,
    present,
    starId,
    bestHall: bestHallOf(halls),
    order: halls.flatMap((h) => h.visible.map((t) => t.id)),
    hallIds: (name: string) => halls.find((h) => h.hall === name)?.visible.map((t) => t.id) ?? [],
    empty: halls.every((h) => h.visible.length === 0),
  };
}

interface HallsProps {
  model: ReturnType<typeof useFloorModel>;
  now: number;
  columns: number | undefined;
  /** TV kipinde verilmez: seçim/menü/lasso yok, dokunuş detay açmaz. */
  selection: FloorSelectionState | null;
  onCard: (id: string, mods: ClickMods) => void;
  onDetail: (id: string) => void;
  jobs: FloorJobs | undefined;
}

function FloorHalls({ model, now, columns, selection, onCard, onDetail, jobs }: HallsProps) {
  const list = model.halls
    .filter((h) => h.visible.length > 0)
    .map((h) => (
      <HallSection
        key={h.hall}
        hall={h.hall}
        looms={h.visible}
        now={now}
        columns={columns}
        highlight={{ starId: model.starId, bestHall: h.hall === model.bestHall, onSelect: selection ? onCard : noCardSelect }}
        selected={selection?.sel.ids}
        onSelectHall={selection ? (name) => selection.many(model.hallIds(name), false) : undefined}
      />
    ));
  if (!selection) return <>{list}</>;
  return (
    <FloorMenuArea s={selection} onDetail={onDetail} hallIds={model.hallIds} jobs={jobs}>
      <div className="min-h-24 space-y-4 pb-2">{list}</div>
    </FloorMenuArea>
  );
}

function EmptyNote({ total }: { total: number }) {
  return (
    <p className="py-10 text-center text-muted-foreground">
      {total === 0 ? "Salonda gösterilecek dokuma tezgahı yok." : "Bu seçimde tezgah yok — Göster: Tümü ile hepsini açın."}
    </p>
  );
}

export function WeavingFloorView({ floor, now, sampleData, tv = false, notice, stale = false, onOpenTv, tvUrl = null, tvExit, initialSelectedId = null, onOpenAlarm }: ViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(tv ? null : initialSelectedId);
  const [filter, setFilter] = useState<ShowFilter>("ALL");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(root, { locked: tv, autoReal: !tvExit?.windowed });
  const select = useCallback((id: string) => setSelectedId(id), []);
  const model = useFloorModel(floor, now, filter);
  const [job, setJob] = useState<JobDialogState | null>(null);
  const [stop, setStop] = useState<{ mode: StopDialogMode; looms: readonly LiveLoom[] } | null>(null);
  const selection = useFloorSelection({ order: model.order, present: model.present, root, enabled: !tv, escBlocked: selectedId !== null });
  // Pencere açıldığı anın kopyasını alır: canlı tazeleme önizlemeyi ve satır işaretlerini sıfırlamasın.
  const openAction = useCallback(
    (kind: RunActionKey | StopActionKey, ids: string[]) => {
      const looms = floor.looms.filter((l) => ids.includes(l.id));
      if (isStopKey(kind)) setStop({ mode: STOP_MODE[kind], looms });
      else setJob({ kind, looms });
    },
    [floor.looms],
  );
  // Koşum ve duruş eylemleri yalnız gerçek veride; örnek veri ve TV'de yok.
  const jobs: FloorJobs | undefined = tv || sampleData ? undefined : { online: !stale, looms: floor.looms, bulkStops: floor.bulkStops === true, onAction: openAction };
  const { click } = selection;
  const onCard = useCallback((id: string, mods: ClickMods) => click(id, mods) && setSelectedId(id), [click]);
  const selected = floor.looms.find((t) => t.id === selectedId) ?? null;
  // Tam ekranda bütün holler aynı kolon ızgarasında: en kalabalık hol tek satıra sığar.
  const columns = fullscreen.active ? Math.max(...model.halls.map((h) => h.all.length)) : undefined;

  return (
    <PageShell>
      <div
        ref={setRoot}
        className={cn("relative flex min-h-0 flex-1 flex-col", fullscreen.active && "fixed inset-0 z-[60] text-[1.3rem]")}
        style={{ background: hsl("var(--ds-floor)") }}
      >
        <TabPortalProvider value={root}>
          <FloorHintProvider enabled={!tv}>
            {tv && tvExit && <TvExitControl {...tvExit} onToggleFullscreen={tvExit.windowed ? fullscreen.toggleReal : undefined} />}
            {fullscreen.active ? (
              <FullscreenHeader now={now} sampleData={sampleData} updatedAt={floor.updatedAt} stale={stale} onExit={tv ? undefined : fullscreen.exit} legend={<StatusLegend />} />
            ) : (
              <AppHeader
                extra={sampleData ? <SampleDataBadge /> : notice}
                filter={<ShowFilterPicker value={filter} onChange={setFilter} />}
                tv={onOpenTv && <TvLaunchMenu onOpenHere={onOpenTv} tvUrl={tvUrl} />}
                onFullscreen={fullscreen.enter}
              />
            )}
            <PageBody className={cn("min-h-0 space-y-4 p-4", fullscreen.active && "space-y-3 px-6 pt-3")}>
              {floor.alarmNotice && (tv ? <AlarmShiftStrip notice={floor.alarmNotice} linkVisible={false} /> : <LinkedAlarmShiftStrip notice={floor.alarmNotice} />)}
              <FloorSummary floor={floor} now={now} />
              <OverdueStrip looms={floor.looms} now={now} onSelect={tv ? noSelect : select} />
              <FloorHalls model={model} now={now} columns={columns} selection={tv ? null : selection} onCard={onCard} onDetail={select} jobs={jobs} />
              {model.empty && <EmptyNote total={floor.looms.length} />}
              {!fullscreen.active && <StatusLegend />}
            </PageBody>
            {!tv && <SelectionBar s={selection} onDetail={select} order={model.order} jobs={jobs} />}
            {job && <JobDialogs state={job} online={!stale} onClose={() => setJob(null)} />}
            {stop && <StopBulkDialog open mode={stop.mode} looms={stop.looms} online={!stale} onOpenChange={(o) => !o && setStop(null)} />}
            <LoomDetailSheet loom={selected} now={now} onClose={() => setSelectedId(null)} onOpenAlarm={tv ? undefined : onOpenAlarm} />
          </FloorHintProvider>
        </TabPortalProvider>
      </div>
    </PageShell>
  );
}
