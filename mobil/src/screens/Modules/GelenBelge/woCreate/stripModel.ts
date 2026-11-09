// Belge şeridi (2026-11-09 sadeleşme): yalnız İŞ GEREKTİREN satırlar — belge tanınmadıysa tek uyarı + "Tanıt"; çok partili
// belgede kip satırı ("2 parti → 2 iş emri (şablon kuralı)" + "Bu sefer değiştir"). Tanınmış tek partili belgede model boş
// → şerit hiç çizilmez. Saf: sunucunun `tanima` bloğu + tanıtma girişi + parti taslağı.
import type { Tanima } from '../../../../services/inboundDoc.service';
import type { TeachEntry } from '../tanit/useTeachEntry';
import { modeRuleLine, type MultiPartyDraft } from './partyDraft';

export interface StripModel {
  /** Tanınmadı (ortada soru, başlıkta Tanıt ikonu); `teach` = bu cihazda fotoğraf var. Tanınmış / hazır şablonda null. */
  unrecognized: { teach: boolean } | null;
  /** Çok parti kip satırı; `canChange` = "Bu sefer değiştir" (kayıt sürmüyor/bitmedi). */
  rule: { text: string; sourceText: string; touched: boolean; canChange: boolean } | null;
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
  const rule = i.multi ? { ...modeRuleLine(i.multi), canChange: !i.locked } : null;
  return { unrecognized, rule };
}

/** Şeritte gösterilecek satır var mı (yoksa boş gri alan da kalmaz). Tanınmadı uyarısı şeritte değil, ortada soru (`TeachPrompt`). */
export const stripHasContent = (m: StripModel | null): m is StripModel => !!m && !!m.rule;
