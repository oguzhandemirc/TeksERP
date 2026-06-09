import { useSyncExternalStore } from "react";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";

/**
 * Tüm "pulse / yanıp sönme" vurgularını TEK paylaşılan saatten besler.
 *
 * Her bileşen kendi `setInterval`'ını ya da kendi `animate-pulse` faz başlangıcını
 * (mount anına göre) kullanırsa vurgular birbirine göre kayar — aynı anda yanıp
 * sönmezler. Bu hook modül düzeyinde TEK bir zamanlayıcı tutar; tüm aboneler aynı
 * `dim` değerini okur ve aynı render commit'inde birlikte güncellenir. Sonuç:
 * alanlar farklı zamanlarda görünür olsa bile (geç açılan kalem alanı, sonradan
 * pulse'a giren buton vb.) hepsi aynı hız + aynı fazda nefes alır.
 */
const HALF_PERIOD_MS = 800; // bir parlama→sönme yarı periyodu (tam nefes ≈ 1.6s)

let dim = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  dim = !dim;
  for (const notify of listeners) notify();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  if (timer === null) timer = setInterval(tick, HALF_PERIOD_MS);
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      dim = false; // hiç abone kalmadıysa fazı sıfırla — sonraki açılış temiz başlar
    }
  };
}

const getSnapshot = () => dim;

// Pasif sekmede saate hiç abone olma: gizli modal her tick'te boşuna re-render
// olmaz ve gizli input'ta süren geçiş aktif sekmeye "hayalet iz" bırakmaz.
const noopSubscribe = () => () => {};
const getFalse = () => false;

/** Paylaşılan pulse saatinin o anki "sönük mü" durumu (true = yarı opaklık). */
export function usePulseSync(): boolean {
  // Sekme aktif değilken pulse'ı dondur (sabit, parlak). `useIsTabActive`
  // sekme sistemi dışında varsayılan `true` döner — normal davranış korunur.
  const active = useIsTabActive();
  return useSyncExternalStore(
    active ? subscribe : noopSubscribe,
    active ? getSnapshot : getFalse,
    getFalse,
  );
}
