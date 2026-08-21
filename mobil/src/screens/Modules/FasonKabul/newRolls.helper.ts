/**
 * Fason kabulde "dönen açık kumaş" (newRolls) satır mantığı.
 *
 * Ekrandan ayrı tutulur çünkü saf/test edilebilir: ön-dolu (prefilled) satırların
 * işaretli (gelen) toplara göre yeniden kurulması burada. Saha bug'ı (1 sevk/2 top,
 * iki kısmi kabulde KK2'ye 3 top) tam olarak bu eşitlemenin eksikliğindendi —
 * operatör gelmeyen topu işaretten çıkarsa bile ön-dolu parça kalıyordu.
 */

export interface NewRollRow {
  key: string;
  qty: string; // string state — TextInput; submit'te number'a çevir
  notes: string;
  noteOpen: boolean;
  prefilled: boolean; // sevkten otomatik gelen, henüz dokunulmamış
}

/**
 * Kabul modu — boyahane topları genelde DİKEREK tek parça döndürür:
 * - SINGLE (varsayılan): tek ön-dolu satır, metre = işaretli topların toplamı.
 * - PER_ROLL (istisna, "adet adet geldi"): işaretli her top için bir satır,
 *   metre = o topun sevk metresi.
 */
export type ReceiveMode = 'SINGLE' | 'PER_ROLL';

// Metraj toplamındaki yüzer-nokta gürültüsünü at (0.1+0.2 → 0.30000000000000004).
const round2 = (n: number) => Math.round(n * 100) / 100;

let nrCounter = 0;
export const makeNewRollRow = (qty = '', prefilled = false): NewRollRow => ({
  key: `nr-${Date.now()}-${nrCounter++}`,
  qty,
  notes: '',
  noteOpen: false,
  prefilled,
});

/**
 * Ön-dolu (prefilled) açık-kumaş satırlarını İŞARETLİ toplara ve kabul moduna
 * göre yeniden kurar.
 *
 * - Operatörün elle girdiği/düzenlediği satırlar (`prefilled=false`) AYNEN korunur
 *   — boyahane top açıp birleştirebildiği için parça sayısı top sayısından farklı
 *   olabilir; operatörün iradesi ezilmemeli.
 * - SINGLE: işaretli top varsa TEK ön-dolu satır, metre = toplam sevk metresi.
 * - PER_ROLL: işaretli her top için bir satır, metre = topun sevk metresi.
 *
 * Sonuç sırası: ön-dolu satırlar önce (UX: otomatik satırlar üstte), elle eklenenler
 * sonra (addNewRoll zaten sona ekliyordu).
 */
export function rebuildPrefilledNewRolls(
  current: NewRollRow[],
  checkedQtys: number[],
  mode: ReceiveMode,
): NewRollRow[] {
  const manual = current.filter((r) => !r.prefilled);
  if (mode === 'SINGLE') {
    // TEK PARÇA MODUNDA SATIR SAYISI HER ZAMAN 1'DİR (2026-08-21).
    //
    // Eski hâli ön-dolu satırı manuel satırın YANINA ekliyordu ve şu sırada
    // sessizce ikiye katlıyordu: operatör 250 → 220 yazar (satır "manuel" olur),
    // sonra gelmeyen bir topu işaretten çıkarır → rebuild yeni bir ön-dolu satır
    // üretir ve dönen metraj 220 + 180 = 400 olur. Bant farkı bağırır ama
    // sebebini söylemez; "tek parça" diyen bir modda iki parça satırı zaten
    // kendi içinde çelişkidir.
    //
    // Operatör bir kez sayıyı yazdıysa TOPLAM ONUNDUR: işaret değişse de
    // dokunulmaz (ölçtüğü metre, hangi topların geldiğine göre değişmez).
    if (manual.length > 0) return [manual[0]!];
    const total = round2(checkedQtys.reduce((s, q) => s + (q > 0 ? q : 0), 0));
    return checkedQtys.length > 0
      ? [makeNewRollRow(total > 0 ? String(total) : '', true)]
      : [];
  }
  const prefilled = checkedQtys.map((q) => makeNewRollRow(q > 0 ? String(q) : '', true));
  return [...prefilled, ...manual];
}

/**
 * MOD GEÇİŞİ — parça listesini hedef moda taşır, operatörün yazdığını KORUYARAK.
 *
 * • PER_ROLL → SINGLE: satırlar tek toplama iner (100 + 120 → 220). Elle yazılmış
 *   bir satır varsa sonuç "manuel" sayılır, yani `rebuildPrefilledNewRolls` bir
 *   daha üzerine yazmaz.
 * • SINGLE → PER_ROLL: operatör henüz sayıya DOKUNMADIYSA (tek ön-dolu satır)
 *   top başına ön-dolu satırlara açılır — "adet adet geldi"yi seçmenin bütün
 *   amacı budur. Dokunduysa yazdığı toplam korunur ve parçalamayı kendisi yapar;
 *   ön-dolu satır EKLENMEZ (eklenirse toplam ikiye katlanırdı).
 */
export function switchReceiveMode(
  current: NewRollRow[],
  checkedQtys: number[],
  next: ReceiveMode,
): NewRollRow[] {
  const manual = current.filter((r) => !r.prefilled);
  if (next === 'SINGLE') {
    if (manual.length === 0) return rebuildPrefilledNewRolls([], checkedQtys, 'SINGLE');
    const merged = round2(
      current.reduce((s, r) => {
        const n = parseFloat(r.qty.replace(',', '.'));
        return s + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    );
    const notes = current
      .map((r) => r.notes.trim())
      .filter(Boolean)
      .join(' · ')
      .slice(0, 200);
    return [{ ...manual[0]!, qty: merged > 0 ? String(merged) : '', notes, noteOpen: false, prefilled: false }];
  }
  if (manual.length > 0) return manual;
  return rebuildPrefilledNewRolls([], checkedQtys, 'PER_ROLL');
}
