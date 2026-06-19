// Bir DOM hedefi metin girişi mi? (input / textarea / select / contentEditable)
// `useGlobalShortcuts` ve `useScannerWedge` ortak kullanır — tek kaynak olsun ki
// "odaklı input'ta kısayol/scan tetikleme" davranışı iki yerde sapmasın.

export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
}
