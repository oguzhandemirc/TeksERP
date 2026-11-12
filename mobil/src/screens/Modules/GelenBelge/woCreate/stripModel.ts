// Belge şeridi (2026-11-09 sadeleşme): yalnız İŞ GEREKTİREN satırlar — belge tanınmadıysa tek uyarı + "Tanıt"; çok partili
// belgede kip satırı ("2 parti → 2 iş emri" + "Değiştir" düğmesi — kip değiştirmenin TEK yolu). Tanınmış tek partili belgede
// model boş → şerit hiç çizilmez. Saf: sunucunun `tanima` bloğu + tanıtma girişi + parti taslağı.
import type { Tanima } from '../../../../services/inboundDoc.service';
import type { TeachEntry } from '../tanit/useTeachEntry';
import { modeRuleLine, type MultiPartyDraft } from './partyDraft';

export interface StripModel {
  /** Tanınmadı (ortada soru, başlıkta Tanıt ikonu); `teach` = bu cihazda fotoğraf var. Tanınmış / hazır şablonda null. */
  unrecognized: { teach: boolean } | null;
  /** Çok parti kip satırı; `canChange` = "Değiştir" etkin (kayıt sürmüyor/bitmedi). */
  rule: { text: string; touched: boolean; canChange: boolean } | null;
}

export interface StripInput {
  tanima: Tanima | undefined;
  entry: Pick<TeachEntry, 'kind' | 'noPhoto'>;
  /** Satır bu tablette yeni şablonla doldu (sunucu özeti henüz eski). */
  localTaught: boolean;
  multi: MultiPartyDraft | null | undefined;
  /** Kayıt sürüyor / bitti: kip değiştirilemez. */
  locked: boolean;
}

/** Şerit modeli; sunucu `tanima` göndermiyorsa (eski sunucu / okunmuş sayfa yok) null → bugünkü ad etiketi + amber şerit. */
export function stripModel(i: StripInput): StripModel | null {
  const t = i.tanima;
  if (!t) return null;
  const known = i.localTaught || ((t.durum === 'TANITILDI' || t.durum === 'SISTEM') && !!t.template);
  // Fotoğrafsız tanınmamış belgede açıklama amber şeritte (panel yolu); burada tekrar edilmez.
  const unrecognized = known || i.entry.noPhoto ? null : { teach: i.entry.kind === 'untaught' };
  return { unrecognized, rule: modeRule(i.multi, i.locked) };
}

const modeRule = (multi: MultiPartyDraft | null | undefined, locked: boolean): StripModel['rule'] =>
  multi ? { ...modeRuleLine(multi), canChange: !locked } : null;

/**
 * Çizilecek şerit: tanıma modeli yoksa (eski sunucu / belgesiz / okuma bitmedi) da çok partide yalnız kip satırı —
 * parti altındaki kip düğmeleri kaldırıldı (2026-11-10), şerit tek yol; hiçbir kurulumda kip seçimi kaybolmaz.
 */
export function shownStrip(model: StripModel | null, multi: MultiPartyDraft | null | undefined, locked: boolean): StripModel | null {
  if (model) return model;
  const rule = modeRule(multi, locked);
  return rule ? { unrecognized: null, rule } : null;
}

/** Şeritte gösterilecek satır var mı (yoksa boş gri alan da kalmaz). Tanınmadı uyarısı şeritte değil, ortada soru (`TeachPrompt`). */
export const stripHasContent = (m: StripModel | null): m is StripModel => !!m && !!m.rule;
