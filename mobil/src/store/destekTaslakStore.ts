// Destek talep TASLAĞI — "Sorun bildir" anındaki ekran görüntüsü ve üstüne
// yapılan çizim. Form ve çizim ekranı arasında taşınır; yalnız bellekte durur
// (diske yazılmaz, uygulama kapanınca kaybolur). clientToken burada DEĞİL:
// mantıksal denemenin kimliği formun kendi ömrüne bağlıdır (useDestekYeni).
import { create } from 'zustand';

import { BOS_CIZIM, type DrawingState } from '../screens/Destek/cizim';

export interface YakalananEkran {
  /** view-shot JPEG data-uri (uzun kenar ≤ 1920 px). */
  uri: string;
  width: number;
  height: number;
}

export interface DrawingResult {
  /** Gönderilecek JPEG — düz base64 (`data:` öneki yok). */
  base64: string;
  /** Önizleme için data-uri. */
  onizlemeUri: string;
}

interface DestekTaslakState {
  ekran: YakalananEkran | null;
  ekranAdi: string | null;
  ekranAnahtari: string | null;
  cizim: DrawingState;
  result: DrawingResult | null;
  yeniTaslak: (p: { ekran: YakalananEkran | null; ekranAdi: string | null; ekranAnahtari: string | null }) => void;
  /** `result` null → çizim yok, ham ekran görüntüsü gider. */
  cizimiKaydet: (cizim: DrawingState, result: DrawingResult | null) => void;
  ekraniKaldir: () => void;
}

export const useDestekTaslakStore = create<DestekTaslakState>((set) => ({
  ekran: null,
  ekranAdi: null,
  ekranAnahtari: null,
  cizim: BOS_CIZIM,
  result: null,
  yeniTaslak: ({ ekran, ekranAdi, ekranAnahtari }) =>
    set({ ekran, ekranAdi, ekranAnahtari, cizim: BOS_CIZIM, result: null }),
  cizimiKaydet: (cizim, result) => set({ cizim, result }),
  ekraniKaldir: () => set({ ekran: null, cizim: BOS_CIZIM, result: null }),
}));
