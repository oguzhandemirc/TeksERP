// Etiket alıcısı (2026-11-10) — saf metinler ve seçici bölümleri; ekran ve jest aynı kaynaktan.
// K5: "Etiket kimin için" ASLA boş görünmez — varsayılan malın sahibidir ("HHL MC (malın sahibi)").
import { foldSearchText, foldedIncludes } from '../../../utils/searchFold';
import { upperTr } from '../../../utils/trCase';
import { LABEL_TEXT_MAX, normalizeLabelText } from './labelTexts';

/** Sunucu sınırı (CONSIGNEE_NAME_MAX = 80) etiket metinleriyle aynı. */
export const CONSIGNEE_NAME_MAX = LABEL_TEXT_MAX;

export function normalizeConsigneeName(raw: string | null | undefined): string | null {
  return normalizeLabelText(raw);
}

/** Kartta/düğmede görünen seçim: alıcı adı, yoksa "<sahip> (malın sahibi)". */
export function consigneeChoiceText(ownerName: string, consigneeName: string | null | undefined): string {
  const c = normalizeConsigneeName(consigneeName);
  return c ?? `${ownerName} (malın sahibi)`;
}

const BACK_VOWELS = 'aıouAIOU';
const VOWELS = 'aeıioöuüAEIİOÖUÜ';
/** Kısaltmanın son harfinin okunuşu: ünsüz harfler "-e" ile okunur (MC → "em-ce" → 'ye). */
function isAcronym(word: string): boolean {
  return word.length <= 5 && word === upperTr(word) && /[A-ZÇĞİÖŞÜ]/.test(word);
}

/** Yönelme eki kesme işaretiyle: "HHL MC" → "HHL MC'ye", "Ayhan" → "Ayhan'a", "Kaya" → "Kaya'ya". */
export function dativeOf(name: string): string {
  const n = name.trim();
  const word = n.split(/\s+/).pop() ?? n;
  const last = word.slice(-1);
  let vowel: string | null = null;
  let endsWithVowel = VOWELS.includes(last);
  if (isAcronym(word) && !endsWithVowel) {
    vowel = 'e';
    endsWithVowel = true;
  } else {
    for (let i = word.length - 1; i >= 0; i--) {
      if (VOWELS.includes(word[i]!)) {
        vowel = word[i]!;
        break;
      }
    }
  }
  const suffix = vowel != null && BACK_VOWELS.includes(vowel) ? 'a' : 'e';
  return `${n}'${endsWithVowel ? 'y' : ''}${suffix}`;
}

/** Sahibe dönüş düğmesi (K5: "düz etiket" denmez). */
export function backToOwnerText(ownerName: string): string {
  return `${dativeOf(ownerName)} dön`;
}

export interface PickerSection {
  title: string;
  items: string[];
}

/**
 * Ad/renk seçici bölümleri: "Gelen belgede" (beyan) önce → "Daha önce basılan" (beyanla çakışmayan) → arama süzer;
 * aramayla birebir eşleşen yoksa `newValue` = yazılan (yeni ad). Katlama Türkçe (`searchFold`).
 */
export function labelPickerSections(p: { declared?: string | null; recent: readonly string[]; search?: string }): {
  sections: PickerSection[];
  newValue: string | null;
} {
  const q = (p.search ?? '').trim();
  const declared = normalizeLabelText(p.declared);
  const match = (v: string) => q === '' || foldedIncludes(v, q);
  const seen = new Set<string>();
  const take = (v: string) => {
    const k = foldSearchText(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const sections: PickerSection[] = [];
  if (declared && match(declared) && take(declared)) sections.push({ title: 'Gelen belgede', items: [declared] });
  const recent = p.recent.map((v) => normalizeLabelText(v)).filter((v): v is string => !!v && match(v) && take(v));
  if (recent.length > 0) sections.push({ title: 'Daha önce basılan', items: recent });
  const typed = normalizeLabelText(q);
  const exact = typed != null && seen.has(foldSearchText(typed));
  return { sections, newValue: typed && !exact ? typed : null };
}
