// Rota seçici — saf görünüm yardımcıları (veri değişmez; yalnız gösterilen metin/sütun).
import type { ProductionRoute } from '../../../services/route.service';
import { isScanRoute } from '../GelenBelge/woCreate/woFromDoc';

/** Arama kutusu yalnız seçenek sayısı bunu geçince görünür. */
export const SEARCH_MIN_OPTIONS = 9;

/** Tuşta başlık: " iş emri" eki gösterilmez ("KURŞUN & TAMBUR iş emri" → "KURŞUN & TAMBUR"). */
export function routeButtonTitle(name: string): string {
  const t = name.trim().replace(/\s+i[şs] emri$/i, '').trim();
  return t || name.trim();
}

/** İstasyon adındaki parantezli ek atılır ("TAMBUR-1 (KURŞUN)" → "TAMBUR-1"); yalnız görüntü. */
export function stepDisplayName(name: string): string {
  const t = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return t || name.trim();
}

/** Tek satır açıklama: yalnız adımlar ("Kurşun → Tambur" biçimi adın kendi yazımıyla); rotasız seçenek → "İstasyonda eklenir". */
export function routeStepsLine(route: Pick<ProductionRoute, 'steps'> & { id?: string }): string | undefined {
  if (isScanRoute(route)) return 'İstasyonda eklenir';
  const path = [...(route.steps ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .map((st) => st.station?.name?.trim())
    .filter((n): n is string => !!n)
    .map(stepDisplayName);
  return path.length > 0 ? path.join(' → ') : undefined;
}

/** Genişliğe göre sütun sayısı: telefon dikey 1–2, tablet yatay 3. */
export function routeColumns(width: number): number {
  if (width >= 900) return 3;
  if (width >= 420) return 2;
  return 1;
}
