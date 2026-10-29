// İçerideki İşler karosu / palet girişi görünürlüğü (saf). Backend kapısı `requireEmanetEnabled`.
// Belirsizken FALSE ("sıfır görünür fark"). Yetki duvarı değil — asıl sed backend'de.
export interface ConsignedWorkVisibilityContext {
  emanetEnabled: boolean;
}

export function isConsignedWorkVisible(ctx: ConsignedWorkVisibilityContext): boolean {
  return ctx.emanetEnabled;
}
