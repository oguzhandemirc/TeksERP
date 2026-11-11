// Kayıt kalıbı — saf yardımcılar (yan panel klavye gezinmesi, odak süzgeci, dışarı tık ayrımı).

/** Yüklü satır sırasında komşu kayıt; uçta durur (dönmez), kayıt listede yoksa null. */
export function neighborId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!current) return null;
  const i = ids.indexOf(current);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

/** Yazı alanındaki ↑/↓ panelin değil alanındır (arama kutusu, seçici, metin). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.closest("input, textarea, select, [role='combobox'], [role='listbox'], [role='menu']") !== null;
}

/**
 * Panel DIŞI tık mı? Panelin kendisi, liste satırları (`data-record-row` — satır kendi kaydını
 * açar), diyalog/menü/bildirim katmanları (panelden açılan diyalog paneli kapatmasın) dış sayılmaz.
 */
const INSIDE_SELECTORS = [
  "[data-record-side-panel]",
  "[data-record-row]",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[data-radix-popper-content-wrapper]",
  "[data-sonner-toaster]",
].join(",");

export function isOutsidePanel(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  return el.closest(INSIDE_SELECTORS) === null;
}
