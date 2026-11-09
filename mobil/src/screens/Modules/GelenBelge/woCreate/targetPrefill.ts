// Belgeden okunan gelen değerlerin HEDEF kutularıyla ilişkisi (SAF): varsayılanda kopyalanmaz (kutu boş, silik ipucu
// "belgede 241 m"); kişisel ⚙ anahtarı açıksa bugünkü kopyalama. Kapalı fabrika ayarı (hedef en / metraj-kg) kutuyu da kapatır.
import type { DocFormFields } from '../../../../services/inboundDoc.service';
import { parseFormNumber, type DocCopy } from './woForm';

export interface TargetPrefillCtx {
  /** Kişisel ⚙ anahtarı `tabletIeForm.hedefDoldur`. */
  fill: boolean;
  /** `workorder.targetWidthEnabled`. */
  widthEnabled: boolean;
  /** `workorder.targetQuantityEnabled`. */
  quantityEnabled: boolean;
}

/** Hangi alana belge değeri YAZILIR: anahtar açık VE alanın fabrika ayarı açık (gizli kutuya sessiz yazım yok). */
export function docCopy(c: TargetPrefillCtx): DocCopy {
  return { width: c.fill && c.widthEnabled, targetQuantity: c.fill && c.quantityEnabled, targetWeight: c.fill && c.quantityEnabled };
}

export interface TargetHints {
  width: string | null;
  targetQuantity: string | null;
  targetWeight: string | null;
}

const fmt = (n: number | null, unit: string): string | null => (n === null ? null : `belgede ${String(Math.round(n * 1000) / 1000).replace('.', ',')} ${unit}`);

/** Boş hedef kutusunun silik ipucu; yalnız kopyalanmayan alan için, belgede değer varsa. */
export function targetHints(fields: DocFormFields | null | undefined, c: TargetPrefillCtx): TargetHints {
  const copy = docCopy(c);
  const f = fields ?? {};
  return {
    width: copy.width ? null : fmt(parseFormNumber(f.en), 'cm'),
    targetQuantity: copy.targetQuantity ? null : fmt(parseFormNumber(f.hedefMetraj), 'm'),
    targetWeight: copy.targetWeight ? null : fmt(parseFormNumber(f.hedefKg), 'kg'),
  };
}

/** Hedef metrajda "gelen metre" türetilmiş gösterimi yalnız kopyalama açık + ayar açıkken. */
export const showDerivedQuantity = (c: TargetPrefillCtx): boolean => c.fill && c.quantityEnabled;
