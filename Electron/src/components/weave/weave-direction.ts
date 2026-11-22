// Kare ızgara YÖNÜ (karar 1a): panelde varsayılan aşağıdan yukarı — atkı 1 en altta, tezgâhın elektronik
// armür ekranı gibi; düğmeyle çevrilir. Yalnız GÖRÜNÜMÜ çevirir, veri satır sırası değişmez. Tercih cihaza
// kayıtlı (`localStorage`, iş verisi değil); depo okunamazsa varsayılana düşülür. Basılı kart kâğıt gibi kalır.
import { useCallback, useState } from "react";

export type WeaveDirection = "bottom-up" | "top-down";
export const WEAVE_DIRECTION_KEY = "weave.gridDirection";
export const DEFAULT_WEAVE_DIRECTION: WeaveDirection = "bottom-up";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readWeaveDirection(storage: StorageLike | null = defaultStorage()): WeaveDirection {
  try {
    const v = storage?.getItem(WEAVE_DIRECTION_KEY);
    return v === "bottom-up" || v === "top-down" ? v : DEFAULT_WEAVE_DIRECTION;
  } catch {
    return DEFAULT_WEAVE_DIRECTION;
  }
}

export function writeWeaveDirection(dir: WeaveDirection, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(WEAVE_DIRECTION_KEY, dir);
  } catch {
    /* sessiz: kalıcılık kaybı görünümü bozmaz */
  }
}

/** Ekranda yukarıdan aşağı çizim sırası → veri satırı (0-tabanlı). Veri dizisi hiç yeniden sıralanmaz. */
export function rowsInDisplayOrder(rows: number, dir: WeaveDirection): number[] {
  const order = Array.from({ length: Math.max(0, rows) }, (_, i) => i);
  return dir === "bottom-up" ? order.reverse() : order;
}

export function useWeaveDirection(): [WeaveDirection, (d: WeaveDirection) => void] {
  const [dir, setDir] = useState<WeaveDirection>(() => readWeaveDirection());
  const set = useCallback((d: WeaveDirection) => {
    setDir(d);
    writeWeaveDirection(d);
  }, []);
  return [dir, set];
}
