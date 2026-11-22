// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — A6 levent kartı basımı (S5t): sonuç kartındaki düğme + `devere.beamCardAutoPrint` aynası
// =============================================================================
// OFF (varsayılan = bugün): kabulden sonra kendiliğinden bir şey olmaz, düğme elle basar. ASK: sonuç kartı "basılsın
// mı?" diye öne çıkar. ALWAYS: kabul belgesi başına BİR KEZ sistem penceresi açılır (yeniden çizim tekrar açmaz).
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import type { ReceiveDocResult } from '../../../services/devereKabul.service';
import { printWarpBeamCards, type BeamCardTarget } from '../../../services/warpBeamCardPrint';

export type BeamCardAutoPrint = 'OFF' | 'ASK' | 'ALWAYS';

/** Eski sunucu ayarı göndermez ya da tanınmayan değer → OFF (bugünkü davranış). */
export function normalizeAutoPrint(v: unknown): BeamCardAutoPrint {
  return v === 'ASK' || v === 'ALWAYS' ? v : 'OFF';
}

/** Kabul sonrası levent ETİKETİ kendiliğinden kuyruğa girsin mi? Kart açıksa (ASK/ALWAYS) kart etiketin yerini
 *  alır (çelik leventten etiket düşer — kullanıcı 2026-11-22); OFF = bugünkü davranış, etiket basılır. */
export function labelsAutoQueued(mode: BeamCardAutoPrint): boolean {
  return mode === 'OFF';
}

/** Kabul sonucundaki leventler, belge sırasıyla. */
export function resultBeamTargets(result: ReceiveDocResult | null): BeamCardTarget[] {
  if (!result) return [];
  return result.orders.flatMap((o) => o.receipt.beams.map((b) => ({ id: b.id, beamNo: b.beamNo })));
}

export interface BeamCardPrintState {
  print: () => void;
  printing: boolean;
  /** Bu kabulün kartları pencereye gitti mi (ASK vurgusu söner). */
  printed: boolean;
  /** ASK ve henüz basılmadı → sonuç kartı soruyu öne çıkarır. */
  ask: boolean;
  /** Etiketler kendiliğinden kuyruğa girdi mi (yalnız OFF) — sonuç kartı metni buna uyar. */
  labelsQueued: boolean;
}

export function useBeamCardPrint(result: ReceiveDocResult | null, mode: BeamCardAutoPrint): BeamCardPrintState {
  const [printing, setPrinting] = useState(false);
  const [printedDoc, setPrintedDoc] = useState<string | null>(null);
  const autoDoneFor = useRef<string | null>(null);
  const busy = useRef(false);
  const docNo = result?.docNo ?? null;

  const run = useCallback(async (r: ReceiveDocResult) => {
    if (busy.current) return;
    busy.current = true;
    setPrinting(true);
    try {
      const out = await printWarpBeamCards(resultBeamTargets(r));
      if (out.printed > 0) setPrintedDoc(r.docNo);
      if (out.failed.length > 0) {
        Toast.show({
          type: 'error',
          text1: `${out.failed.length} levent kartı basılamadı`,
          text2: out.failed.map((f) => `${f.beamNo}: ${f.reason}`).join(' · '),
          visibilityTime: 8000,
        });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Levent kartları basılamadı', text2: ((e ?? {}) as { message?: string }).message ?? '', visibilityTime: 7000 });
    } finally {
      busy.current = false;
      setPrinting(false);
    }
  }, []);

  useEffect(() => {
    if (!result || mode !== 'ALWAYS' || autoDoneFor.current === result.docNo) return;
    autoDoneFor.current = result.docNo;
    void run(result);
  }, [result, mode, run]);

  const print = useCallback(() => {
    if (result) void run(result);
  }, [result, run]);
  const printed = docNo !== null && printedDoc === docNo;
  return { print, printing, printed, ask: mode === 'ASK' && !printed, labelsQueued: labelsAutoQueued(mode) };
}
