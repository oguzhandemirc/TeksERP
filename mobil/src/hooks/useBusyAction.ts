// =============================================================================
// useBusyAction — "en az N sn dönen" aksiyon + unmount temizliği
// =============================================================================
// SAHA GEREKÇESİ: sunucu 40 ms'de cevap verdiğinde düğme bir kare boyunca
// yanıp sönüyor ve operatör "bastım mı, basmadım mı?" diye tekrar basıyordu.
// Bu yüzden meşguliyet bir TABANA oturtuldu.
//
// ⚠️ ASGARİ SÜRE TAVAN DEĞİLDİR: iş 5 sn sürerse spinner 5 sn döner. Sabit
// `setTimeout(2000)` gecikmesi DEĞİL — önce iş biter, sonra kalan süre kadar
// beklenir. (Sabit gecikme, uzun süren işte cevabı 2 sn geciktirirdi.)
//
// ⚠️ UNMOUNT: operatör asgari süre dolmadan geri tuşuna basarsa
//   · bekleyen timer TEMİZLENİR (sızıntı yok — `jest.getTimerCount()` ile ölçülü),
//   · sonuç geri çağrısı ÇAĞRILMAZ (ekranda olmayan yere toast basmak, sonraki
//     ekranda sebepsiz bir bildirim olarak görünürdü).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';

/** Düğmenin en az bu kadar dönmesi garanti (kullanıcı kararı, 2026-09-04). */
export const ASGARI_ISLEM_MS = 2000;

export interface BusyActionSecenekleri<T> {
  /** Asgari meşguliyet süresi (ms). 0 verilirse taban yok. */
  asgariMs?: number;
  /** İş bittikten VE asgari süre dolduktan sonra — yalnız ekran hâlâ canlıysa. */
  bitince?: (sonuc: T) => void;
  /** İş hata fırlattıysa — asgari süre yine koşar, ekran canlıysa çağrılır. */
  hataOlunca?: (hata: unknown) => void;
}

export interface BusyAction {
  /** Düğmenin spinner'ı bu bayrakla döner. */
  busy: boolean;
  /** Düğmenin `onPress`i. Meşgulken ikinci basış YUTULUR (çift koşum yok). */
  tetikle: () => void;
}

export function useBusyAction<T>(
  calis: () => Promise<T>,
  secenekler: BusyActionSecenekleri<T> = {},
): BusyAction {
  const asgariMs = secenekler.asgariMs ?? ASGARI_ISLEM_MS;

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const canliRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bekleyen asgari-süre promise'ini erken çözer (unmount'ta kilitlenme olmasın). */
  const serbestBirakRef = useRef<(() => void) | null>(null);

  // Geri çağrılar ve iş, her render'da tazelenir — `tetikle`nin kimliği sabit
  // kalsın diye ref üzerinden okunur (aksi halde her render'da yeni düğme
  // handler'ı doğar ve Paper Button gereksiz yeniden çizilir).
  const calisRef = useRef(calis);
  calisRef.current = calis;
  const secRef = useRef(secenekler);
  secRef.current = secenekler;

  useEffect(() => {
    canliRef.current = true;
    return () => {
      canliRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      serbestBirakRef.current?.();
      serbestBirakRef.current = null;
    };
  }, []);

  const bekle = useCallback(
    (ms: number) =>
      new Promise<void>((cozul) => {
        serbestBirakRef.current = cozul;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          serbestBirakRef.current = null;
          cozul();
        }, ms);
      }),
    [],
  );

  const tetikle = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    void (async () => {
      const baslangic = Date.now();
      let sonuc: T | undefined;
      let hata: unknown;
      let hataVar = false;
      try {
        sonuc = await calisRef.current();
      } catch (e) {
        hata = e;
        hataVar = true;
      }

      const kalan = asgariMs - (Date.now() - baslangic);
      if (kalan > 0) await bekle(kalan);

      busyRef.current = false;
      // Ekrandan çıkıldıysa: ne state ne toast. Sessizce biter.
      if (!canliRef.current) return;
      setBusy(false);

      if (hataVar) secRef.current.hataOlunca?.(hata);
      else secRef.current.bitince?.(sonuc as T);
    })();
  }, [asgariMs, bekle]);

  return { busy, tetikle };
}
