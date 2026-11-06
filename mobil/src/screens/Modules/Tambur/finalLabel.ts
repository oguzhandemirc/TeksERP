// Tambur final etiket kararları (Gülkesim S5) — saf fonksiyonlar, ekran ve jest aynı kaynaktan.
import type { TamburLabelSettings } from '../../../services/tambur.service';
import type { Roll } from '../../../types/models';

/** Ayar okunamazsa (eski backend / ağ) bugünkü davranış: her kesimde bas, tartım yok, öneri yok. */
export const DEFAULT_LABEL_SETTINGS: TamburLabelSettings = {
  customerId: null,
  widthSource: null,
  weighRequired: false,
  splitLengthM: null,
  printTiming: 'EACH',
  labelBatchEnabled: false,
};

/** Kesimden hemen sonra etiket basılsın mı? END'de iş bitince "Basılmayanları bas". */
export function shouldAutoPrintAfterCut(s: Pick<TamburLabelSettings, 'printTiming'> | null | undefined): boolean {
  return (s?.printTiming ?? 'EACH') !== 'END';
}

/** "12,5" → 12.5; boş → null; bozuk/≤0 → NaN (çağıran hata gösterir). */
export function parseKg(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : NaN;
}

/** Kesim gönderilmeden önce tartım denetimi: hata metni ya da null. */
export function weightError(s: Pick<TamburLabelSettings, 'weighRequired'>, kgText: string): string | null {
  const kg = parseKg(kgText);
  if (Number.isNaN(kg)) return "Kg 0'dan büyük bir sayı olmalı.";
  if (s.weighRequired && kg == null) return 'Bu müşterinin topu tartılmadan kesilemez — kg girin.';
  return null;
}

/** 'Bitir' kararı: kalan top doğuran karar (keep_* / scrap) kesimle aynı tartım kuralına tabi; discard top doğurmaz. */
export function finalizeWeightError(
  s: Pick<TamburLabelSettings, 'weighRequired'>,
  kgText: string,
  action: 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard',
): string | null {
  return action === 'discard' ? null : weightError(s, kgText);
}

/**
 * Bölme ölçüsü önerisi: müşterinin ölçüsü (ör. 50 m) kalandan küçükse o, değilse öneri yok
 * (kalanı kesmek zaten "Kalanı Kes" düğmesi). Metin virgüllü ("50" / "50,5").
 */
export function splitSuggestion(splitLengthM: number | null | undefined, remaining: number): string | null {
  if (splitLengthM == null || !(splitLengthM > 0)) return null;
  if (!(remaining > splitLengthM)) return null;
  return String(Math.round(splitLengthM * 100) / 100).replace('.', ',');
}

/** Bu işten çıkıp etiketi hiç basılmamış toplar (END modunda toplu basım listesi). */
export function unprintedRolls(rolls: readonly Roll[]): Roll[] {
  return rolls.filter((r) => !r.labelPrintedAt);
}

/**
 * Etiket bilgisi formu → PUT gövdesi: yalnız DEĞİŞEN anahtarlar. Boş kutu + "boş bas" işareti → "";
 * boş kutu (işaretsiz) → null (kaynak değere dön); dolu → metin.
 */
export function overridePatch(
  current: Readonly<Record<string, string>>,
  edited: Readonly<Record<string, { text: string; blank: boolean }>>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(edited)) {
    const text = v.text.trim();
    const next: string | null = v.blank ? '' : text === '' ? null : text;
    const had = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : null;
    if (next !== had) out[key] = next;
  }
  return out;
}
