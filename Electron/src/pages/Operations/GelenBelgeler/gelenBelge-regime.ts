// Gelen Belgeler karosu / palet girişi görünürlüğü (saf). ETKİN değer bağlamda çözülür
// (`emanet && gelenBelge`, `useOperationsVisibilityContext`); backend kapısı `requireGelenBelgeEnabled`.
// Belirsizken FALSE ("sıfır görünür fark"). Yetki duvarı değil — asıl sed backend'de.
export interface IncomingDocumentVisibilityContext {
  gelenBelgeEnabled: boolean;
}

export function isIncomingDocumentVisible(ctx: IncomingDocumentVisibilityContext): boolean {
  return ctx.gelenBelgeEnabled;
}
