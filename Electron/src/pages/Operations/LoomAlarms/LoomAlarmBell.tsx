// =============================================================================
// ALARM ZİLİ — üst çubukta "Son Aktivite" zilinden AYRI (tasarım §A.6)
// =============================================================================
// Aktif alarm sayısı rozeti + açılır kısa liste (tezgah · sebep · süre/hedef · kademe) + kişisel
// ses aç/kapa. Yoklama 15 sn, şeritle ortak (`alarm-bell-query`). FAIL-CLOSED: bayrak kapalı / izin yok / sunucu "kapalı" derse zil HİÇ
// çizilmez ve hata toast'ı basılmaz (yoklama sessizdir).
// =============================================================================
import { Siren, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import { isAlarmClosedError, useLoomAlarmAccess, useServerNow } from "./alarm-access";
import { durationVsTarget, isPastTarget, reasonText, tierShort } from "./alarm-format";
import { useLoomAlarmBellQuery } from "./alarm-bell-query";
import { useLoomAlarmSoundPref } from "./useLoomAlarmSoundPref";
import type { LoomAlarmItem } from "./types";

export { LOOM_ALARM_BELL_QUERY_KEY, LOOM_ALARM_BELL_POLL_MS } from "./alarm-bell-query";
const BELL_LIMIT = 8;

function BellRow({ a, now, onOpen }: { a: LoomAlarmItem; now: number; onOpen: (id: string) => void }) {
  const late = isPastTarget(a, now);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(a.id)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {a.machine.code} <span className="font-normal text-muted-foreground">· {a.machine.hallName}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{reasonText(a)}</p>
          <p className={cn("mt-0.5 text-xs font-medium tabular-nums", late ? "text-destructive" : "text-foreground")}>
            {durationVsTarget(a, now)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              a.tier >= 2 ? "bg-destructive text-destructive-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            {tierShort(a.tier)}
          </span>
          {a.ackedBy && <span className="max-w-24 truncate text-[10px] text-muted-foreground">{a.ackedBy.name}</span>}
        </div>
      </button>
    </li>
  );
}

export function LoomAlarmBell() {
  const access = useLoomAlarmAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const now = useServerNow(15_000);
  const q = useLoomAlarmBellQuery(access.canView);
  const sound = useLoomAlarmSoundPref();

  if (!access.canView || isAlarmClosedError(q.error)) return null;

  const items = (q.data?.items ?? []).slice(0, BELL_LIMIT);
  const summary = q.data?.summary;
  const count = summary?.total ?? 0;
  const urgent = (summary?.open ?? 0) > 0 || (summary?.escalated ?? 0) > 0;
  const label = count > 0 ? `Tezgah alarmları: ${count} aktif` : "Tezgah alarmları: aktif alarm yok";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={label} title={label}>
          <Siren className={cn("h-4 w-4", count > 0 && urgent && "text-destructive")} />
          {count > 0 && (
            <span
              data-testid="loom-alarm-badge"
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                urgent ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white",
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Tezgah Alarmları</p>
          <div className="flex items-center gap-2">
            {summary && (
              <span className="text-xs text-muted-foreground">
                {summary.open} açık · {summary.acked} üstlenildi
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-pressed={sound.on}
              aria-label={sound.on ? "Alarm sesi açık — kapat" : "Alarm sesi kapalı — aç"}
              title={sound.on ? "Alarm sesi açık (yalnız sizin için) — kapatmak için tıklayın" : "Alarm sesi kapalı (yalnız sizin için) — açmak için tıklayın"}
              onClick={sound.toggle}
            >
              {sound.on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            </Button>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {q.isError ? "Alarmlar okunamadı — bağlantıyı kontrol edin." : "Aktif alarm yok."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((a) => (
                <BellRow key={a.id} a={a} now={now} onOpen={(id) => navigateActive(`/operations/loom-alarms/${id}`)} />
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigateActive("/operations/loom-alarms")}
          className="block w-full border-t px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Tümünü gör{count > items.length ? ` (${count})` : ""}
        </button>
      </PopoverContent>
    </Popover>
  );
}
