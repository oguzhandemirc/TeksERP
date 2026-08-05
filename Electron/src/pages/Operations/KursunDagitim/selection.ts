/**
 * Toplu seçim — SAF yardımcılar (birim testli).
 *
 * Seçim kimliği HER YERDE `workOrderStepId`'dir. Sebep: hem havuzda hem
 * makinelerde satırın tek benzersiz anahtarı odur. `workOrderId` yeterli DEĞİL
 * (bir iş emrinin rotasında teorik olarak iki PROCESS_QC adımı olabilir),
 * `assignmentId` ise yalnız dağıtılmış satırlarda var. Toplu uçlara giden
 * gerçek id'ler (`workOrderId` / `assignmentId`) seçili satırlardan TÜRETİLİR.
 *
 * Dizi kullanılıyor, `Set` değil: bu boyutlarda (onlarca satır) fark ölçülemez
 * ve dizi hem React state'inde referans-eşitliğiyle uyumlu hem de test edilmesi
 * daha kolay.
 */

/** Seçili mi? */
export function isSelected(selected: string[], id: string): boolean {
  return selected.includes(id);
}

/** Tek satırı seçime ekler / çıkarır. */
export function toggleOne(selected: string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((x) => x !== id)
    : [...selected, id];
}

/**
 * "Tümünü seç" kutusu: verilen id'lerin HEPSİ seçiliyse hepsini ÇIKARIR, aksi
 * halde eksik olanları EKLER.
 *
 * ⚠️ Kapsam DIŞINDAKİ seçimlere dokunmaz — sekme değiştirmeden önce seçim
 * temizlense de, savunmacı davranış ucuz ve doğru olan taraftır.
 */
export function toggleAll(selected: string[], ids: string[]): string[] {
  if (ids.length === 0) return selected;
  const allSelected = ids.every((id) => selected.includes(id));
  if (allSelected) return selected.filter((id) => !ids.includes(id));
  const missing = ids.filter((id) => !selected.includes(id));
  return [...selected, ...missing];
}

/** Başlık kutusunun üç durumu. */
export type HeaderCheckState = "none" | "some" | "all";

export function headerState(selected: string[], ids: string[]): HeaderCheckState {
  if (ids.length === 0) return "none";
  const hit = ids.filter((id) => selected.includes(id)).length;
  if (hit === 0) return "none";
  return hit === ids.length ? "all" : "some";
}

/**
 * Seçimi GÖRÜNEN satırlarla kesiştirir.
 *
 * Toplu aksiyonlar bunu kullanır: ekranda olmayan bir satır üzerinde işlem
 * yapmak (liste yenilendi, satır başka sekmeye geçti) sessizce yanlış olurdu.
 */
export function visibleSelection(selected: string[], ids: string[]): string[] {
  return ids.filter((id) => selected.includes(id));
}
