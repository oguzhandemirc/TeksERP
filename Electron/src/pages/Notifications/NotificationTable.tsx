// Bildirimler sayfasının tablo hücreleri — geçmiş günlüğü satırı; tablo ortak DataTable (`notificationColumns.tsx`).
import { CircleCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnoozeMenu } from "@/components/bildirim/SnoozeMenu";
import { cn } from "@/lib/utils";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { relativeTime, groupLook, reasonLabel, CLASS_LOOK } from "@/lib/bildirim/format";
import type { useNotificationActions } from "@/lib/bildirim/hooks";
import type { NotificationItem } from "@/lib/bildirim/types";

export type NotificationActions = ReturnType<typeof useNotificationActions>;

export function StatusCell({ b }: { b: NotificationItem }) {
  if (b.cozulduAn)
    return (
      <span className="inline-flex items-center gap-1 rounded-badge bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="h-3 w-3" aria-hidden /> Çözüldü
      </span>
    );
  if (b.erteleBitis && new Date(b.erteleBitis).getTime() > Date.now())
    return <span className="text-xs text-muted-foreground">Ertelendi · {fmtFactoryDateTime(b.erteleBitis)}</span>;
  if (!b.okunduAn)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
        <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Okunmamış
      </span>
    );
  return <span className="text-xs text-muted-foreground">Okundu</span>;
}

/** Durum metni — dosya/ipucu için hücreyle aynı sıra. */
export function statusText(b: NotificationItem): string {
  if (b.cozulduAn) return "Çözüldü";
  if (b.erteleBitis && new Date(b.erteleBitis).getTime() > Date.now()) return `Ertelendi · ${fmtFactoryDateTime(b.erteleBitis)}`;
  return b.okunduAn ? "Okundu" : "Okunmamış";
}

/** Zaman — mutlak + göreli tek satırda. */
export function TimeCell({ b }: { b: NotificationItem }) {
  return (
    <span className="tabular-nums" title={fmtFactoryDateTime(b.sonAn)}>
      {fmtFactoryDateTime(b.sonAn)} <span className="text-xs text-muted-foreground">{relativeTime(b.sonAn)}</span>
    </span>
  );
}

/** Alan — grup simgesi + adı; alarm sınıfı rozeti aynı satırda. */
export function GroupCell({ b }: { b: NotificationItem }) {
  const g = groupLook(b.grup);
  const Ikon = g.ikon;
  const sinif = CLASS_LOOK[b.sinif];
  return (
    <span className="flex items-center gap-2">
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded", g.renk)}>
        <Ikon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="truncate">{b.grup}</span>
      {b.sinif === "ALARM" && <span className={cn("inline-flex shrink-0 rounded-badge border px-1.5 text-[10px] font-medium", sinif.renk)}>{sinif.etiket}</span>}
    </span>
  );
}

/** Bildirim — başlık (açar) + gövde + sebep: bu sütun çok satırlıdır (`meta.wrap`). */
export function TitleCell({ b, onAc }: { b: NotificationItem; onAc: (b: NotificationItem) => void }) {
  const neden = reasonLabel(b.neden);
  return (
    <>
      <button type="button" onClick={() => onAc(b)} className={cn("text-left hover:underline", !b.okunduAn && "font-semibold")}>
        {b.baslik}
        {b.sayac > 1 && <span className="ml-1 font-normal text-muted-foreground">(+{b.sayac - 1})</span>}
      </button>
      {b.govde && <p className="mt-0.5 text-xs text-muted-foreground">{b.govde}</p>}
      {neden && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{neden}</p>}
    </>
  );
}

/** Satır eylemleri — Aç · Okundu/Okunmadı yap · Ertele (alarmda yer tutucu). */
export function ActionsCell({ b, onAc, eylemler }: { b: NotificationItem; onAc: (b: NotificationItem) => void; eylemler: NotificationActions }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onAc(b)}>
        <ExternalLink className="h-3.5 w-3.5" /> Aç
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-[6.25rem] justify-center whitespace-nowrap px-2 text-xs"
        onClick={() => eylemler.okundu.mutate({ id: b.id, okundu: !b.okunduAn })}
      >
        {b.okunduAn ? "Okunmadı yap" : "Okundu"}
      </Button>
      {/* Alarmın kendi susturması var; gelen kutusu ertelemesi alarmı gizlemesin (yer tutucu sütunu hizalı tutar). */}
      {b.sinif === "ALARM" ? (
        <span aria-hidden inert className="invisible">
          <SnoozeMenu onSec={() => undefined} />
        </span>
      ) : (
        <SnoozeMenu onSec={(sure) => eylemler.ertele.mutate({ id: b.id, sure })} />
      )}
    </div>
  );
}
