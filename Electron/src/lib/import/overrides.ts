// =============================================================================
// ELLE DÜZELTMELER — dosyayı değiştirmeden hücre üzerine yazma
// =============================================================================
// Kullanıcı önizlemede hatalı bir hücreyi düzeltince değişiklik BURAYA yazılır,
// `parsed` (ayrıştırılmış dosya) dokunulmadan kalır. Neden ayrı katman:
//
//  • `rows` saf bir TÜRETİMdir (`parsed` + `mapping`). Düzenlemeyi doğrudan
//    `rows`a yazmak, kullanıcı sütun eşlemesini değiştirdiği anda düzeltmeleri
//    SESSİZCE yok ederdi.
//  • Anahtar `rowNo` (dosya satır numarası) çünkü yeniden eşlemeden sağ çıkan
//    tek kimlik odur; sütun anahtarı da dosya sütun İNDEKSİ değil ŞABLON
//    anahtarıdır — kullanıcı "Renk Adı"nı düzeltiyor, "3. sütunu" değil.

import type { ImportRowInput } from "@/services/importService";

/** `rowNo → { sütunAnahtarı: değer }` */
export type CellOverrides = Record<number, Record<string, string>>;

/**
 * Düzeltmeleri satırlara uygular.
 *
 * ⚠️ DÜZELTME YOKSA GİRDİ DİZİSİ AYNEN DÖNER (aynı referans). Önizlemenin
 * bayat olup olmadığı `previewedRows !== rows` ile anlaşılıyor; burada her
 * seferinde yeni dizi üretmek o kontrolü sürekli "bayat" gösterirdi.
 */
export function applyOverrides(rows: ImportRowInput[], overrides: CellOverrides): ImportRowInput[] {
  if (Object.keys(overrides).length === 0) return rows;
  return rows.map((r) => {
    const ov = overrides[r.rowNo];
    return ov ? { rowNo: r.rowNo, cells: { ...r.cells, ...ov } } : r;
  });
}

/** Tek hücreyi düzeltir; boş string de geçerli bir düzeltmedir ("alanı boşalt"). */
export function setOverride(
  overrides: CellOverrides,
  rowNo: number,
  column: string,
  value: string,
): CellOverrides {
  return { ...overrides, [rowNo]: { ...(overrides[rowNo] ?? {}), [column]: value } };
}

/** Düzeltilmiş hücre sayısı — kullanıcıya "N hücre elle düzeltildi" demek için. */
export function countOverrides(overrides: CellOverrides): number {
  return Object.values(overrides).reduce((sum, cols) => sum + Object.keys(cols).length, 0);
}

// ---------------------------------------------------------------------------
// Çoklu değerli hücrelerde tek elemanı değiştirme
// ---------------------------------------------------------------------------
// "Eksik kaydı yarat" akışı, yaratılan kaydın KODUNU hücreye yazar. Hücre
// çoklu ise (`RNK1;MAVI;RNK2`) yalnız EŞLEŞEN eleman değişmeli — hücrenin
// tamamını ezmek diğer referansları siler.
//
// ⚠️ Ayraç kümesi backend'in `splitList`iyle AYNI olmalı (`[;,\n]` + trim +
// boşları at); ayrışırsa panel bir elemanı değiştirdiğini sanırken sunucu
// başka bir bölünme görür.

const SPLIT = /[;,\n]/;

/**
 * Katlanmış karşılaştırmayla eşleşen elemanı yenisiyle değiştirir.
 * Eşleşme yoksa metin AYNEN döner (sessizce bir şey eklemez).
 */
export function replaceListElement(
  raw: string,
  target: string,
  replacement: string,
  fold: (s: string) => string,
): string {
  const parts = raw.split(SPLIT).map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return replacement;
  const wanted = fold(target);
  let hit = false;
  const next = parts.map((p) => {
    if (!hit && fold(p) === wanted) {
      hit = true;
      return replacement;
    }
    return p;
  });
  return hit ? next.join(";") : raw;
}

/** Tek değerli hücre mi çoklu mu — çağıran `column.lookup.multiple` ile bilir. */
export function replaceCellValue(
  raw: string,
  target: string,
  replacement: string,
  multiple: boolean,
  fold: (s: string) => string,
): string {
  if (!multiple) return replacement;
  return replaceListElement(raw, target, replacement, fold);
}
