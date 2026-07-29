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
  let prefilled: NewRollRow[];
  if (mode === 'SINGLE') {
    const total = round2(checkedQtys.reduce((s, q) => s + (q > 0 ? q : 0), 0));
    prefilled =
      checkedQtys.length > 0
        ? [makeNewRollRow(total > 0 ? String(total) : '', true)]
        : [];
  } else {
    prefilled = checkedQtys.map((q) => makeNewRollRow(q > 0 ? String(q) : '', true));
  }
  return [...prefilled, ...manual];
}
