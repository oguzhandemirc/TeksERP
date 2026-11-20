// Destek talep TASLAĞI — "Sorun bildir" anındaki ekran görüntüsü, kaynak ekran ve üstüne yapılan çizim. Form ile çizim
// ekranı arasında taşınır; yalnız BELLEKTE durur (diske yazılmaz, uygulama kapanınca kaybolur). clientToken burada
// DEĞİL: mantıksal denemenin kimliği formun kendi ömrüne bağlıdır (`app/(app)/destek/yeni.tsx`).
import { useSyncExternalStore } from "react";
import { BOS_CIZIM, type CizimDurumu } from "./cizim";

export interface YakalananEkran {
  /** JPEG data-uri (uzun kenar ≤ 1920 px). */
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface CizimSonucu {
  /** Gönderilecek JPEG — düz base64 (`data:` öneki yok). */
  readonly base64: string;
  /** Önizleme için data-uri. */
  readonly onizlemeUri: string;
}

export interface DestekTaslagi {
  readonly ekran: YakalananEkran | null;
  readonly ekranAdi: string | null;
  readonly yol: string | null;
  readonly cizim: CizimDurumu;
  /** null → çizim yok, ham ekran görüntüsü gider. */
  readonly sonuc: CizimSonucu | null;
}

const BOS: DestekTaslagi = { ekran: null, ekranAdi: null, yol: null, cizim: BOS_CIZIM, sonuc: null };
let taslak: DestekTaslagi = BOS;
const dinleyiciler = new Set<() => void>();
const yaz = (t: DestekTaslagi) => {
  taslak = t;
  dinleyiciler.forEach((f) => f());
};

export function yeniTaslak(p: { ekran: YakalananEkran | null; ekranAdi: string | null; yol: string | null }): void {
  yaz({ ...BOS, ...p });
}

export function cizimiKaydet(cizim: CizimDurumu, sonuc: CizimSonucu | null): void {
  yaz({ ...taslak, cizim, sonuc });
}

/** "Görüntüyü kaldır": yalnız metinli talep. */
export function ekraniKaldir(): void {
  yaz({ ...taslak, ekran: null, cizim: BOS_CIZIM, sonuc: null });
}

export function taslagiTemizle(): void {
  yaz(BOS);
}

export function taslakAl(): DestekTaslagi {
  return taslak;
}

/** Gönderilecek görüntü: çizim varsa çizimli JPEG, yoksa ham ekran görüntüsü; ikisi de yoksa null. */
export function gonderilecekGoruntu(t: DestekTaslagi): string | null {
  return t.sonuc?.base64 ?? t.ekran?.uri ?? null;
}

export function useDestekTaslagi(): DestekTaslagi {
  return useSyncExternalStore(
    (f) => {
      dinleyiciler.add(f);
      return () => void dinleyiciler.delete(f);
    },
    () => taslak,
    () => taslak,
  );
}
