// Bu tabletten gönderilen sayfaların yerel kopyası (sha256 → dosya). Tanıtma ekranı okunmuş taramayı bu fotoğrafla çizer;
// tek form / masa satırı `useDocScan.done.sent`e erişemediği için gönderim burada da kaydedilir (bellek-içi, uygulama ömrü).
const MAX = 200;
const pages = new Map<string, string>();

export function rememberLocalPages(list: readonly { sha256: string; uri: string }[]): void {
  for (const p of list) {
    pages.delete(p.sha256);
    pages.set(p.sha256, p.uri);
  }
  // En eskiler düşer (Map ekleme sırasını korur).
  while (pages.size > MAX) pages.delete(pages.keys().next().value as string);
}

export function localPagesFor(sha256s: readonly string[]): { sha256: string; uri: string }[] {
  return sha256s.flatMap((sha256) => {
    const uri = pages.get(sha256);
    return uri ? [{ sha256, uri }] : [];
  });
}

/** Testler için. */
export function clearLocalPages(): void {
  pages.clear();
}
