// =============================================================================
// LEVENT / LOT EKSENİ — URL durumu + istek parametreleri (R5b-b2 panel yarısı)
// =============================================================================
// İki eksen ama TEK sözleşme: `warpBeamId` TEK seçim (uuid; kaynağı raporun
// `meta.leventler`i), `lotNo` SERBEST METİN (lot listesi ucu yok — arama kutusu
// dürüst olandır, olmayan bir seçeneği vaat etmez). İkisi birlikte KESİŞİMDİR.
//
// ⚠️ Boş değer istekte anahtar OLARAK GİTMEZ: süzgeçsiz istek bayt bayt eskisi.
// Bilinmeyen levent/lot 404 değil BOŞ rapor döner (1e hükmü) — ekranda bunu
// söyleyen cümle `beamLotNotes`ta.
// =============================================================================
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface BeamLotState {
  beamId: string;
  lotNo: string;
  /** İsteğe eklenecek parametreler — boş eksen HİÇ gitmez. */
  params: { warpBeamId?: string; lotNo?: string };
  setBeam: (id: string) => void;
  setLot: (lot: string) => void;
  any: boolean;
}

export const LOT_MAX = 64;

export function useBeamLot(): BeamLotState {
  const [sp, setSp] = useSearchParams();
  const beamId = sp.get("beam") ?? "";
  // Sunucu `trim().min(1).max(64)` bekliyor; kırpma İSTEMCİDE de yapılır ki
  // yanlışlıkla eklenen boşluk 400 yerine sessizce doğru süzgece dönüşsün.
  const lotNo = (sp.get("lot") ?? "").trim().slice(0, LOT_MAX);

  const yaz = useCallback(
    (key: string, value: string) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value) n.set(key, value);
          else n.delete(key);
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );

  const params = useMemo(
    () => ({ ...(beamId ? { warpBeamId: beamId } : {}), ...(lotNo ? { lotNo } : {}) }),
    [beamId, lotNo],
  );

  return {
    beamId,
    lotNo,
    params,
    setBeam: useCallback((id: string) => yaz("beam", id), [yaz]),
    setLot: useCallback((lot: string) => yaz("lot", lot.trim().slice(0, LOT_MAX)), [yaz]),
    any: beamId !== "" || lotNo !== "",
  };
}
