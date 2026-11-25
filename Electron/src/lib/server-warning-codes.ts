// Sunucu `ApiResponse.warnings`e cümle yerine KOD koyabiliyor (teklif kalemi: STANDARD_COST_MISSING, maliyet
// sürümünden gelen TAKEUP_DEFAULTED…). Genel uyarı tostu kodu ham basmasın: tanınan kod Türkçe metne, tanınmayan
// kod genel Türkçe cümleye çevrilir; düz cümle olduğu gibi kalır.
import { MISSING_LABEL, WARNING_LABEL } from "@/pages/Cost/shared/labels";

/** Maliyet etiket kümesinde olmayan, uca özgü uyarı kodları. */
const EXTRA_WARNING_LABEL: Record<string, string> = {
  STANDARD_COST_MISSING: "Ürünün yürürlükte standart maliyeti yok — kalem maliyeti bugünkü girdilerle canlı hesaplandı.",
};

const CODE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** Not bir sunucu kodu mu (BÜYÜK_HARF_ALT_ÇİZGİ)? Cümleler buna uymaz. */
export function isWarningCode(note: string): boolean {
  return CODE_RE.test(note.trim());
}

/** Uyarı notunun ekranda basılacak metni. */
export function warningNoteText(note: string): string {
  const t = note.trim();
  if (!isWarningCode(t)) return note;
  return EXTRA_WARNING_LABEL[t] ?? WARNING_LABEL[t] ?? MISSING_LABEL[t] ?? `Sunucu bir uyarı bildirdi (kod: ${t}).`;
}
