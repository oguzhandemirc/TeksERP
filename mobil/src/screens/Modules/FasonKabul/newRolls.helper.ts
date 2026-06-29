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

let nrCounter = 0;
export const makeNewRollRow = (qty = '', prefilled = false): NewRollRow => ({
  key: `nr-${Date.now()}-${nrCounter++}`,
  qty,
  notes: '',
  noteOpen: false,
  prefilled,
});

/**
 * Ön-dolu (prefilled) açık-kumaş satırlarını İŞARETLİ toplara göre yeniden kurar.
 *
 * - Operatörün elle girdiği/düzenlediği satırlar (`prefilled=false`) AYNEN korunur
 *   — boyahane top açıp birleştirebildiği için parça sayısı top sayısından farklı
 *   olabilir; operatörün iradesi ezilmemeli.
 * - Ön-dolu satırlar = işaretli her top için bir satır, metre = topun sevk metresi.
 *
 * Sonuç sırası: ön-dolu satırlar önce (UX: otomatik satırlar üstte), elle eklenenler
 * sonra (addNewRoll zaten sona ekliyordu).
 */
export function rebuildPrefilledNewRolls(
  current: NewRollRow[],
  checkedQtys: number[],
): NewRollRow[] {
  const manual = current.filter((r) => !r.prefilled);
  const prefilled = checkedQtys.map((q) =>
    makeNewRollRow(q > 0 ? String(q) : '', true),
  );
  return [...prefilled, ...manual];
}
