import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { signalScan } from '../services/scanFeedback';
import type { ScanFlash } from '../components/BarcodeScannerView';

/**
 * Kabul EDİLMEYEN okuma. Toast 3 sn'de kaybolduğu için sebep tarayıcı şeridinde
 * kısa süre GÖRÜNÜR kalır: operatör topu bırakıp döndüğünde "neden almadı"
 * sorusunun cevabı hâlâ ekranda olmalı (WMS'te istisna kaybolmaz).
 */
export interface ScanReject {
  id: number;
  barcode: string;
  reason: string;
}

/** Ret satırının şeritte kalma süresi. */
const REJECT_TTL_MS = 10_000;
/** Mükerrer okumada şerit satırının vurgulanma süresi. */
const DUPLICATE_FLASH_MS = 1400;
/** Merkez bildiriminin ekranda kalma süresi — mükerrer / ret. Ret daha uzun:
 *  orada okunacak bir SEBEP var, mükerrerde yalnız "zaten var". */
const DUPLICATE_NOTICE_MS = 1600;
const REJECT_NOTICE_MS = 2400;

export interface ScanFeedback {
  /** Şeridin en üstünde duran ret satırları (en yeni önce). */
  rejects: ScanReject[];
  /** Az önce mükerrer okutulan barkod — şeritte o satır vurgulanır. */
  duplicateBarcode: string | null;
  /** Kadrajın ORTASINDA duran bildirim — `BarcodeScannerModal.flash`e verilir. */
  flash: ScanFlash | null;
  pushRejects: (items: { barcode: string; reason: string }[]) => void;
  flashDuplicate: (barcode: string) => void;
  dismissReject: (id: number) => void;
  /** Ekran sıfırlanınca (iş emri açıldı, form temizlendi) geri bildirimi de
   *  temizle — yeni akışın üstünde eski ret satırı asılı kalmasın. */
  reset: () => void;
}

/**
 * Okutmanın GÖRSEL geri bildirimi — tek kaynak.
 *
 * `services/scanFeedback` sesi/titreşimi tekleştiriyordu; ekranda ne görüneceği
 * ise ekran ekran kopyalanıyordu (Hızlı İş Emri'nde şerit + vurgu vardı, Fason
 * Sevk'te yalnız kaybolan bir toast). Aynı okutma iki ekranda iki farklı şey
 * söylerse operatör hangisine güveneceğini bilemez — bu hook o kararı tek yerde
 * tutar ve `signalScan`i de kendisi çağırır (çağıran ayrıca çağırmasın, çift
 * bip/titreşim olur).
 *
 * İki yüzey birlikte çalışır ve BİRBİRİNİN yerine geçmez:
 *  • merkez bildirim → "az önce ne oldu" (kadraja bakan göz için, 1-2 sn)
 *  • şerit satırı    → "neden olmadı" (topu bırakıp dönen operatör için, 10 sn)
 */
export function useScanFeedback(): ScanFeedback {
  const [rejects, setRejects] = useState<ScanReject[]>([]);
  const [duplicateBarcode, setDuplicateBarcode] = useState<string | null>(null);
  const [flash, setFlash] = useState<ScanFlash | null>(null);

  const seqRef = useRef(0);
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ekran, ret satırı ekranda dururken kapanabilir (tarayıcıdan çıkış, modal
  // kapanışı) — unmount'tan sonra setState uyarısı ve sızıntı olmasın diye tüm
  // TTL zamanlayıcıları burada toplanır.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      fn();
    }, ms);
    timersRef.current.add(t);
    return t;
  }, []);

  useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current.clear();
      if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  /** Merkez bildirimi göster. `seq` her çağrıda artar → aynı barkod peş peşe
   *  okutulsa bile nesne kimliği değişir ve animasyon yeniden oynar. */
  const showFlash = useCallback(
    (next: Omit<ScanFlash, 'seq'>, ms: number) => {
      seqRef.current += 1;
      setFlash({ ...next, seq: seqRef.current });
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setFlash(null);
      }, ms);
    },
    [],
  );

  const pushRejects = useCallback(
    (items: { barcode: string; reason: string }[]) => {
      if (items.length === 0) return;
      for (const it of items) {
        seqRef.current += 1;
        const id = seqRef.current;
        setRejects((cur) => [{ id, ...it }, ...cur].slice(0, 20));
        // Her satır KENDİ ömrünü sayar — tek ortak zamanlayıcı, arka arkaya
        // gelen retlerden ilkinin süresi dolduğunda hepsini birden silerdi.
        later(() => setRejects((cur) => cur.filter((r) => r.id !== id)), REJECT_TTL_MS);
      }
      signalScan('reject');
      const first = items[0];
      showFlash(
        {
          kind: 'reject',
          title: 'EKLENMEDİ',
          detail:
            items.length === 1
              ? `${first.barcode} · ${first.reason}`
              : `${items.length} top · ${first.reason}`,
        },
        REJECT_NOTICE_MS,
      );
    },
    [later, showFlash],
  );

  const flashDuplicate = useCallback(
    (barcode: string) => {
      setDuplicateBarcode(barcode);
      if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
      dupTimerRef.current = setTimeout(() => {
        dupTimerRef.current = null;
        setDuplicateBarcode(null);
      }, DUPLICATE_FLASH_MS);
      signalScan('duplicate');
      showFlash({ kind: 'duplicate', title: 'ZATEN OKUTULDU', detail: barcode }, DUPLICATE_NOTICE_MS);
    },
    [showFlash],
  );

  const dismissReject = useCallback(
    (id: number) => setRejects((cur) => cur.filter((r) => r.id !== id)),
    [],
  );

  const reset = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current.clear();
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    dupTimerRef.current = null;
    flashTimerRef.current = null;
    setRejects([]);
    setDuplicateBarcode(null);
    setFlash(null);
  }, []);

  return useMemo(
    () => ({
      rejects,
      duplicateBarcode,
      flash,
      pushRejects,
      flashDuplicate,
      dismissReject,
      reset,
    }),
    [rejects, duplicateBarcode, flash, pushRejects, flashDuplicate, dismissReject, reset],
  );
}
