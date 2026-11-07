// Kartela sayfasının sekme durumu: derin bağlantı (`?tab=`), izin düşüşü ve sekmeler arası URL temizliği.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { isKartelaTabKey, KARTELA_TABS, type KartelaTabKey } from "./tabs-config";

/** Sekme değişiminde URL'den silinen liste parametreleri (`filter[...]` dışında). */
const LIST_PARAMS = ["search", "sortBy", "sortOrder", "dateField", "dateFrom", "dateTo"];

/** `onLeave`: sekme değişince (açık detay paneli eski sekmenin belgesidir) çağrılır. */
export function useKartelaTab(onLeave: () => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTab] = useState<KartelaTabKey>(isKartelaTabKey(urlTab) ? urlTab : "dispatches");
  const { hasPermission } = useRoleAccess();
  const need = KARTELA_TABS.find((t) => t.key === tab)?.permission;
  const allowed = !need || hasPermission(need);

  // Sekmeler aynı URL'i paylaşır: bir sekmenin süzgeci/sıralaması ötekinin listesini bozmasın.
  // Router yazımı sekme state'inden geç çizilir; o ana dek yeni sekme bağlanmaz (`settled`) —
  // yoksa eski süzgeci derin bağlantı sanıp kendi kaydını uygulamaz ve boşalınca kaydı silerdi.
  const [pending, setPending] = useState(false);
  const changeTab = (next: KartelaTabKey) => {
    if (next === tab) return;
    const sp = new URLSearchParams(searchParams);
    const listKeys = listKeysOf(sp);
    if (listKeys.length > 0) {
      for (const k of listKeys) sp.delete(k);
      setSearchParams(sp, { replace: true });
      setPending(true);
    }
    setTab(next);
    onLeave();
  };
  const clean = listKeysOf(searchParams).length === 0;
  useEffect(() => {
    if (pending && clean) setPending(false);
  }, [pending, clean]);
  // İzinsiz derin bağlantı (ör. `?tab=stock`, roll:read yok) varsayılan sekmeye düşer.
  useEffect(() => {
    if (!allowed) setTab("dispatches");
  }, [allowed]);
  // Sayfa açıkken gelen `?tab=` (komut paleti) sekmeyi değiştirir.
  useEffect(() => {
    if (!isKartelaTabKey(urlTab)) return;
    setTab(urlTab);
    onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız URL sekmesi tetikler
  }, [urlTab]);
  return { tab, changeTab, settled: !pending || clean };
}

function listKeysOf(sp: URLSearchParams): string[] {
  return [...sp.keys()].filter((k) => k.startsWith("filter[") || LIST_PARAMS.includes(k));
}

/** Yenile düğmesinin hedefi; "kartela" anahtarı Hareketler sorgularını da kapsar. */
export function kartelaRefreshKey(tab: KartelaTabKey): string | string[] {
  if (tab === "dispatches") return "kartela-dispatches";
  if (tab === "receipts") return "kartela-receipts";
  if (tab === "rolls") return "rolls:KARTELA_SENT";
  if (tab === "stock") return ["rolls", "KARTELA_STOCK"];
  return "kartela";
}
