// =============================================================================
// Etiket Stüdyosu — koşullu basım düzenleme kuralları (saf; ConditionSection kullanır)
// =============================================================================
// NEDEN AYRI DOSYA: burada bir ARA DURUM problemi var ve sahada ısırdı (2026-08-02).
// Kullanıcı önce MODU seçiyor ("Yalnız seçili kalitelerde bas"), kaliteyi sonra
// işaretliyor. Mod seçimi elemana HEMEN yazılırsa `showIf.values` bir an BOŞ kalır;
// o hâliyle canlı önizleme isteği gider ve backend haklı olarak 400 döner
// ("showIf.values en az 1 değer içermeli") — kullanıcı hiçbir hata yapmadan
// kırmızı görür, Kaydet de patlar.
//
// KURAL: yarım koşul elemana ASLA yazılmaz. Değer seçilene kadar mod yalnız
// PANELDE (bekleyen mod) yaşar. Aynı simetriyle: son kutucuğun işareti kalkınca
// koşul elemandan silinir ama panel modu açık kalır (liste kapanıp kullanıcıyı
// "Her zaman bas"a fırlatmasın).

import type { ElementCondition } from "@/types/label-canvas";

export type ConditionMode = "always" | "in" | "notIn";

export interface ConditionEdit {
  /** Elemana yazılacak değer: `ElementCondition` = kur · `undefined` = koşulu kaldır
   *  · `null` = ELEMANA DOKUNMA (yalnız panel durumu değişti). */
  showIf: ElementCondition | null | undefined;
  /** Panelde tutulacak bekleyen mod (değer seçilene kadar elemana yazılmaz). */
  pending: ConditionMode | null;
}

/** Mod değişimi. Koşul zaten varsa yön değişir (seçim KORUNUR); yoksa mod yalnız
 *  panelde bekler — boş değerli koşul elemana yazılmaz. */
export function editMode(cond: ElementCondition | undefined, mode: ConditionMode): ConditionEdit {
  if (mode === "always") {
    return { showIf: cond ? undefined : null, pending: null };
  }
  if (cond) return { showIf: { ...cond, op: mode }, pending: null };
  return { showIf: null, pending: mode };
}

/** Kalite kutucuğu işaretle/kaldır. Liste boşalırsa koşul SİLİNİR (eleman her zaman
 *  basılır) ama panel modu korunur → kullanıcı yeniden seçebilir. */
export function editValue(
  cond: ElementCondition | undefined,
  mode: ConditionMode,
  code: string,
  on: boolean,
): ConditionEdit {
  const current = cond?.values ?? [];
  const values = on ? [...current.filter((c) => c !== code), code] : current.filter((c) => c !== code);
  const keep: ConditionMode = mode === "always" ? "in" : mode;
  if (values.length === 0) return { showIf: cond ? undefined : null, pending: keep };
  return { showIf: { field: "qualityGrade", op: keep, values }, pending: null };
}
