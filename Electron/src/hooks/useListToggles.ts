import { useCallback, useMemo, useState } from "react";

/**
 * Liste görünürlük anahtarları — "İptalleri göster" + "Tamamlananları göster".
 *
 * ⚠️ İKİ AYRI BAYRAK, tek anahtar değil (2026-08-17): planlamacı bitmiş işleri
 * gizleyip iptalleri görmek isteyebilir. Tek anahtara bağlasaydık biri açılınca
 * diğeri de açılırdı ve kullanıcı sebebini göremezdi.
 *
 * KALICILIK — `localStorage`, sunucu DEĞİL. Gerekçe: bu bir GÖRÜNÜM tercihidir,
 * iş verisi değil; her liste açılışında sunucuya sorup yazmak (kullanıcı
 * tercihleri blob'u) ölçülebilir bir fayda getirmeden istek üretirdi. Tercih
 * makineye bağlı kalır — aynı operatör başka bilgisayarda varsayılanla başlar,
 * bu kabul edilebilir (ekran başına bir tık).
 *
 * Bayrakların YÖNÜ bilinçli: sunucuya GİZLEME isteği gider (`hideCancelled` /
 * `hideCompleted`), gösterme değil. Parametre hiç gelmezse eski davranış korunur
 * → mobil ve entegrasyon istemcileri etkilenmez (bkz. hidden-status.helper).
 */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    // localStorage erişilemezse (gizli mod / kilitli profil) varsayılana düş —
    // tercih kalıcı olmaz ama liste çalışmaya devam eder.
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    /* sessiz: kalıcılık kaybı listeyi bozmaz */
  }
}

interface Options {
  /** Tercihi ayrı saklamak için ekran adı ("work-orders", "orders"…). */
  scope: string;
  /** "Tamamlananları göster" anahtarı da sunulsun mu (yalnız iş emri listesi). */
  withCompleted?: boolean;
}

export function useListToggles({ scope, withCompleted = false }: Options) {
  const cancelledKey = `list.${scope}.showCancelled`;
  const completedKey = `list.${scope}.showCompleted`;

  const [showCancelled, setShowCancelledState] = useState(() => readFlag(cancelledKey));
  const [showCompleted, setShowCompletedState] = useState(() =>
    withCompleted ? readFlag(completedKey) : true,
  );

  const setShowCancelled = useCallback(
    (v: boolean) => {
      setShowCancelledState(v);
      writeFlag(cancelledKey, v);
    },
    [cancelledKey],
  );

  const setShowCompleted = useCallback(
    (v: boolean) => {
      setShowCompletedState(v);
      writeFlag(completedKey, v);
    },
    [completedKey],
  );

  const forceFilters = useMemo<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    if (!showCancelled) f.hideCancelled = "true";
    if (withCompleted && !showCompleted) f.hideCompleted = "true";
    return f;
  }, [showCancelled, showCompleted, withCompleted]);

  return { showCancelled, setShowCancelled, showCompleted, setShowCompleted, forceFilters };
}
