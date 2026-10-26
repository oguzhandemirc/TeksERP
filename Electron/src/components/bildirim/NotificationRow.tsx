// Zil açılır listesinin satırı — grup ikonu (alan rengi; anlam ikon+metinde), başlık, (+N), göreli saat
// (fabrika dilimi), sebep etiketi, KOSUL çözüldüyse "Çözüldü"; hover/odak eylemleri Aç · Okundu · Ertele.
import type { KeyboardEvent } from "react";
import { Check, CircleCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnoozeMenu } from "@/components/bildirim/SnoozeMenu";
import { UnfollowButton } from "@/components/bildirim/UnfollowButton";
import { cn } from "@/lib/utils";
import { relativeTime, groupLook, reasonLabel } from "@/lib/bildirim/format";
import type { useNotificationActions } from "@/lib/bildirim/hooks";
import type { NotificationItem } from "@/lib/bildirim/types";

export function NotificationRow({
  b,
  onAc,
  onOkundu,
  eylemler,
}: {
  b: NotificationItem;
  onAc: (b: NotificationItem) => void;
  onOkundu: (b: NotificationItem) => void;
  eylemler: ReturnType<typeof useNotificationActions>;
}) {
  const g = groupLook(b.grup);
  const Ikon = g.ikon;
  const okunmamis = !b.okunduAn;
  const neden = reasonLabel(b.neden);
  return (
    <li className="group relative">
      <button
        type="button"
        data-bildirim-satir
        onClick={() => onAc(b)}
        aria-label={`${okunmamis ? "Okunmamış: " : ""}${b.baslik}`}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
      >
        <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
          {okunmamis && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", g.renk)} title={b.grup}>
          <Ikon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", okunmamis ? "font-semibold" : "font-normal text-muted-foreground")}>
              {b.baslik}
              {b.sayac > 1 && <span className="ml-1 font-normal text-muted-foreground">(+{b.sayac - 1})</span>}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relativeTime(b.sonAn)}</span>
          </span>
          {b.govde && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{b.govde}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {b.cozulduAn && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                <CircleCheck className="h-3 w-3" aria-hidden /> Çözüldü
              </span>
            )}
            {neden && <span>{neden}</span>}
          </span>
        </span>
      </button>
      {/* Hover/odak eylemleri — satır düğmesinin üstünde, klavyeyle de erişilir. */}
      <div className="absolute bottom-1.5 right-2 hidden items-center gap-0.5 rounded-md border border-border/60 bg-popover/95 p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onAc(b)}>
          <ExternalLink className="h-3.5 w-3.5" /> Aç
        </Button>
        {okunmamis ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onOkundu(b)}>
            <Check className="h-3.5 w-3.5" /> Okundu
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => eylemler.okundu.mutate({ id: b.id, okundu: false })}
          >
            Okunmadı yap
          </Button>
        )}
        {/* Alarmın kendi susturması var (alarm sayfası); gelen kutusu ertelemesi alarmı gizlemesin. */}
        {b.sinif !== "ALARM" && <SnoozeMenu onSec={(sure) => eylemler.ertele.mutate({ id: b.id, sure })} />}
        <UnfollowButton b={b} />
      </div>
    </li>
  );
}


/** Ok tuşlarıyla satırlar arası odak (Enter = Aç, Esc = Popover kapanır). */
export function handleArrowKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-bildirim-satir]"));
  if (rows.length === 0) return;
  e.preventDefault();
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "ArrowDown" ? (i + 1) % rows.length : i <= 0 ? rows.length - 1 : i - 1;
  rows[next]?.focus();
}
