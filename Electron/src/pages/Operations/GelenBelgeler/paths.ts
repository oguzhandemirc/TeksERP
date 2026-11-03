// Gelen belge alt ekran adresleri — karo ve sayfa içi bağlantılar sabiti okur; route tablosu yazıyı taşır
// (kaynak-metin bekçileri için) ve `__tests__/paths.test.ts` ikisini eşitliğe bağlar.
export const CUSTOMER_DEFAULTS_PATH = "/operations/gelen-belgeler/varsayilan-urunler";
/** Belge tipi tanıtma (S1b): `:id` = gelen belge; `?sablon=u-…` = o kullanıcı şablonunu bu belgeyle güncelle. */
export const TEACH_ROUTE = "/operations/gelen-belgeler/:id/tanit";
export function teachPath(noteId: string, templateCode?: string | null): string {
  const base = TEACH_ROUTE.replace(":id", noteId);
  return templateCode ? `${base}?sablon=${encodeURIComponent(templateCode)}` : base;
}
