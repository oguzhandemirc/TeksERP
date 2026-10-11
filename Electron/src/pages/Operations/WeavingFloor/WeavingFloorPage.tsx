// =============================================================================
// TEZGAH SALONU — uygulama ekranı (gerçek veri; `/operations/weaving-floor`)
// =============================================================================
// Kapı: route `loom:live-view` + `ROUTE_MODULE` `tezgahEnabled`; backend aynı iki kapı.
// Veri `useLoomFloorLive` (5 sn yoklama); görünüm `WeavingFloorView`; `tv` = menüsüz TV
// bağlantısı (`#/tezgah-tv`, `WeavingFloorTvScreen`). Örnek veri
// yalnız geliştirme önizlemesinde (`preview/weavingFloorPreview.tsx`).
// =============================================================================
import { useCallback, useMemo, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTezgahAlarmEnabled } from "@/hooks/usePricingEnabled";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLoomAlarmAccess } from "@/pages/Operations/LoomAlarms/alarm-access";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatFactory } from "@/lib/factory-time";
import { useLoomFloorLive } from "./useLoomFloorLive";
import { WeavingFloorView } from "./WeavingFloorView";
import { readTvSound, useTvAlarmSound, writeTvSound } from "./tv-alarm-sound";
import type { TvSoundControl } from "./TvExit";
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
function tvExitOf(sound: TvSoundControl | undefined) {
  return isSeparateTvWindow()
    ? { onExit: closeTezgahTvWindow, label: "Pencereyi kapat", windowed: true, sound }
    : { onExit: exitTezgahTvHere, label: "TV kipinden çık", sound };
}

/** TV kipinin opsiyonel alarm sesi — varsayılan kapalı; düğme yalnız alarm açık kurulumda. */
function useTvSound(tv: boolean, looms: Parameters<typeof useTvAlarmSound>[0]): TvSoundControl | undefined {
  const alarmOn = useTezgahAlarmEnabled();
  const [on, setOn] = useState(readTvSound);
  const toggle = useCallback(() => {
    setOn((v) => {
      writeTvSound(!v);
      return !v;
    });
  }, []);
  useTvAlarmSound(tv && alarmOn ? looms : undefined, on);
  return useMemo(() => (tv && alarmOn ? { on, toggle } : undefined), [tv, alarmOn, on, toggle]);
}

/** `?tezgah=<id>` detayı açar; alarm bağlantısı yalnız alarm bayrağı + `loom:alarm-view` ile. */
function useFloorDeepLinks(tv: boolean) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { canView } = useLoomAlarmAccess();
  return {
    initialSelectedId: tv ? null : params.get("tezgah"),
    onOpenAlarm: !tv && canView ? (id: string) => navigate(`/operations/loom-alarms/${id}`) : undefined,
  };
}

export function WeavingFloorPage({ tv = false }: { tv?: boolean }) {
  const live = useLoomFloorLive();
  const links = useFloorDeepLinks(tv);
  const sound = useTvSound(tv, live.floor?.looms);
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
      tvExit={tv ? tvExitOf(sound) : undefined}
      initialSelectedId={links.initialSelectedId}
      onOpenAlarm={links.onOpenAlarm}
    />
  );
}
