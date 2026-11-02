// Bildirimler sayfasının tablosu — geçmiş günlüğü satırları; kaydırıcı sayfanın ListBody'sidir (kart yok).
import { CircleCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SnoozeMenu } from "@/components/bildirim/SnoozeMenu";
import { cn } from "@/lib/utils";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { relativeTime, groupLook, reasonLabel, CLASS_LOOK } from "@/lib/bildirim/format";
import type { useNotificationActions } from "@/lib/bildirim/hooks";
import type { NotificationItem } from "@/lib/bildirim/types";

function StatusCell({ b }: { b: NotificationItem }) {
  if (b.cozulduAn)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
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

function NotificationTableRow({ b, secili, onSec, onAc, eylemler }: {
  b: NotificationItem;
  secili: boolean;
  onSec: (v: boolean) => void;
  onAc: (b: NotificationItem) => void;
  eylemler: ReturnType<typeof useNotificationActions>;
}) {
  const g = groupLook(b.grup);
  const Ikon = g.ikon;
  const sinif = CLASS_LOOK[b.sinif];
  const neden = reasonLabel(b.neden);
  return (
    <tr className={cn("border-t border-border/60 align-top", !b.okunduAn && "bg-primary/[0.03]")}>
      <td className="px-3 py-2.5">
        <Checkbox aria-label={`Seç: ${b.baslik}`} checked={secili} onCheckedChange={(v) => onSec(v === true)} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="tabular-nums">{fmtFactoryDateTime(b.sonAn)}</div>
        <div className="text-xs text-muted-foreground">{relativeTime(b.sonAn)}</div>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className={cn("flex h-6 w-6 items-center justify-center rounded", g.renk)}>
            <Ikon className="h-3.5 w-3.5" aria-hidden />
          </span>
          {b.grup}
        </span>
        {b.sinif === "ALARM" && (
          <span className={cn("mt-1 inline-flex rounded border px-1.5 text-[10px] font-medium", sinif.renk)}>{sinif.etiket}</span>
        )}
      </td>
      <td className="min-w-[14rem] px-3 py-2.5">
        <button type="button" onClick={() => onAc(b)} className={cn("text-left hover:underline", !b.okunduAn && "font-semibold")}>
          {b.baslik}
          {b.sayac > 1 && <span className="ml-1 font-normal text-muted-foreground">(+{b.sayac - 1})</span>}
        </button>
        {b.govde && <p className="mt-0.5 text-xs text-muted-foreground">{b.govde}</p>}
        {neden && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{neden}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <StatusCell b={b} />
      </td>
      <td className="px-3 py-2.5">
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
      </td>
    </tr>
  );
}

export function NotificationTable({ items, secili, setSecili, onAc, eylemler }: {
  items: NotificationItem[];
  secili: ReadonlySet<string>;
  setSecili: (s: Set<string>) => void;
  onAc: (b: NotificationItem) => void;
  eylemler: ReturnType<typeof useNotificationActions>;
}) {
  const tumuSecili = items.length > 0 && items.every((b) => secili.has(b.id));
  const sec = (id: string, v: boolean) => {
    const y = new Set(secili);
    if (v) y.add(id);
    else y.delete(id);
    setSecili(y);
  };
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="w-10 px-3 py-2">
            <Checkbox
              aria-label="Tümünü seç"
              checked={tumuSecili}
              onCheckedChange={(v) => setSecili(v ? new Set(items.map((b) => b.id)) : new Set())}
            />
          </th>
          <th className="whitespace-nowrap px-3 py-2 font-medium">Zaman</th>
          <th className="px-3 py-2 font-medium">Alan</th>
          <th className="px-3 py-2 font-medium">Bildirim</th>
          <th className="px-3 py-2 font-medium">Durum</th>
          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((b) => (
          <NotificationTableRow key={b.id} b={b} secili={secili.has(b.id)} onSec={(v) => sec(b.id, v)} onAc={onAc} eylemler={eylemler} />
        ))}
      </tbody>
    </table>
  );
}
