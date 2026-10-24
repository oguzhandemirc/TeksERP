// Zil açılır panelinin içeriği — sekmeler (Tümü · Okunmamış; Alarmlar F2), gün grupları, alt şerit
// ("Tümünü okundu say" onaysız + 6 sn geri al · "Tüm bildirimler"). RowList yalnız panel açıkken çekilir.
import { useState } from "react";
import { ArrowRight, Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import { splitByDay, badgeText } from "@/lib/bildirim/format";
import { useNotificationActions, useNotificationList } from "@/lib/bildirim/hooks";
import type { NotificationItem, NotificationTab } from "@/lib/bildirim/types";
import { NotificationRow } from "./NotificationRow";

const BELL_LIMIT = 20;
type BellTab = Extract<NotificationTab, "tumu" | "okunmamis">;

function BellTabs({ sekme, onSekme, sayi }: { sekme: BellTab; onSekme: (s: BellTab) => void; sayi: number }) {
  const tabs: ReadonlyArray<readonly [BellTab, string]> = [
    ["tumu", "Tümü"],
    ["okunmamis", sayi > 0 ? `Okunmamış ${badgeText(sayi)}` : "Okunmamış"],
  ];
  return (
    <div role="tablist" aria-label="Bildirim süzgeci" className="flex gap-1 border-b border-border/60 px-2 py-1.5">
      {tabs.map(([k, ad]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={sekme === k}
          onClick={() => onSekme(k)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            sekme === k ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
          )}
        >
          {ad}
        </button>
      ))}
    </div>
  );
}

function RowList({ items, status, onAc, eylemler }: {
  items: NotificationItem[];
  status: "yukleniyor" | "hata" | "hazir";
  onAc: (b: NotificationItem) => void;
  eylemler: ReturnType<typeof useNotificationActions>;
}) {
  if (status === "yukleniyor") return <p className="px-3 py-6 text-center text-xs text-muted-foreground">Yükleniyor…</p>;
  if (status === "hata") return <p className="px-3 py-6 text-center text-xs text-muted-foreground">Bildirimler okunamadı.</p>;
  if (items.length === 0)
    return (
      <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
        <Bell className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium">Yeni bildirim yok</p>
        <p className="text-xs text-muted-foreground">Yeni bir şey olduğunda burada görünür.</p>
      </div>
    );
  return (
    <>
      {splitByDay(items).map((gun) => (
        <section key={gun.grup} aria-label={gun.grup}>
          <h3 className="sticky top-0 z-10 bg-popover/95 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {gun.grup}
          </h3>
          <ul>
            {gun.items.map((b) => (
              <NotificationRow
                key={b.id}
                b={b}
                onAc={onAc}
                onOkundu={(x) => eylemler.okundu.mutate({ id: x.id, okundu: true })}
                eylemler={eylemler}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function BellPanel({ okunmamis, onKapat }: { okunmamis: number; onKapat: () => void }) {
  const [sekme, setSekme] = useState<BellTab>("tumu");
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const list = useNotificationList({ sekme, limit: BELL_LIMIT }, true);
  const eylemler = useNotificationActions();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const git = (yol: string) => {
    onKapat();
    navigateActive(yol);
  };
  const ac = (b: NotificationItem) => {
    if (!b.okunduAn) eylemler.okundu.mutate({ id: b.id, okundu: true });
    git(b.yol);
  };
  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <p className="text-sm font-semibold">Bildirimler</p>
      </div>
      <BellTabs sekme={sekme} onSekme={setSekme} sayi={okunmamis} />
      <div className="max-h-[min(480px,60vh)] overflow-y-auto">
        <RowList items={items} status={list.isLoading ? "yukleniyor" : list.isError ? "hata" : "hazir"} onAc={ac} eylemler={eylemler} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={okunmamis === 0 || eylemler.tumunuOkundu.isPending}
          onClick={() => eylemler.tumunuOkundu.mutate()}
        >
          <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu say
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => git("/notifications")}>
          Tüm bildirimler <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </>
  );
}
