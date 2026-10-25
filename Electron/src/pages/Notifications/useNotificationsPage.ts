// Bildirimler sayfasının durum/süzgeç mantığı — süzgeç seçimi SUNUCUYA gider (`sekme`, `filter[tur]`).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { bildirimService } from "@/services/bildirimService";
import { UNDO_WINDOW_MS, useNotificationActions, useNotificationCatalog, useNotificationList, useNotificationBell } from "@/lib/bildirim/hooks";
import type { NotificationGroup } from "@/lib/bildirim/types";
import { NOTIFICATION_GROUP_ORDER } from "./group-order";
import type { PageTab } from "./NotificationFilters";

const PAGE_LIMIT = 50;

export function useNotificationsPage() {
  const zil = useNotificationBell();
  const [sekme, setSekmeHam] = useState<PageTab>("tumu");
  const [gruplar, setGruplar] = useState<Set<NotificationGroup>>(new Set());
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [topluCalisiyor, setTopluCalisiyor] = useState(false);
  const calisir = zil.bayrak && zil.hazir && zil.destek && zil.enabled;
  const katalog = useNotificationCatalog(calisir);
  const eylemler = useNotificationActions();

  const katalogGruplari = useMemo(() => {
    const present = new Set((katalog.data?.turler ?? []).map((t) => t.grup));
    return NOTIFICATION_GROUP_ORDER.filter((g) => present.has(g));
  }, [katalog.data]);
  const turler = useMemo(
    () => (gruplar.size === 0 ? [] : (katalog.data?.turler ?? []).filter((t) => gruplar.has(t.grup)).map((t) => t.kod)),
    [gruplar, katalog.data],
  );
  const list = useNotificationList({ sekme, turler, limit: PAGE_LIMIT }, calisir && (gruplar.size === 0 || katalog.isSuccess));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const grupDegis = (g: NotificationGroup | null) => {
    setSecili(new Set());
    setGruplar((onceki) => {
      if (g === null) return new Set();
      const yeni = new Set(onceki);
      if (yeni.has(g)) yeni.delete(g);
      else yeni.add(g);
      return yeni;
    });
  };
  const setSekme = (s: PageTab) => {
    setSecili(new Set());
    setSekmeHam(s);
  };
  const seciliOkunmamis = items.filter((b) => secili.has(b.id) && !b.okunduAn).map((b) => b.id);

  /** Toplu okundu: tek tek atomik uçla; değişenler 6 sn geri alınabilir. */
  async function topluOkundu() {
    setTopluCalisiyor(true);
    const degisen: string[] = [];
    try {
      for (const id of seciliOkunmamis) {
        const r = await bildirimService.okundu(id).catch(() => null);
        if (r?.degisti) degisen.push(id);
      }
    } finally {
      setTopluCalisiyor(false);
      setSecili(new Set());
      void list.refetch();
    }
    if (degisen.length === 0) return;
    toast.success(`${degisen.length} bildirim okundu sayıldı.`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Geri al", onClick: () => eylemler.geriAl.mutate(degisen) },
    });
  }

  return {
    zil, calisir, sekme, setSekme, gruplar, grupDegis, katalogGruplari, liste: list, items,
    toplam: list.data?.pages[0]?.sayi ?? 0, secili, setSecili, eylemler,
    topluAcik: seciliOkunmamis.length > 0 && !topluCalisiyor, topluOkundu,
  };
}
