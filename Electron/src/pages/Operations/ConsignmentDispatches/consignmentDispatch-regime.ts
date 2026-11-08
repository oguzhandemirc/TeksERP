// Emanet Çıkış karosu / palet girişi görünürlüğü (saf). Backend kapısı `requireEmanetEnabled`; belirsizken FALSE
// (fabrikada karo bir an belirip kaybolmasın). Yetki duvarı değil — asıl sed backend'de.
export interface ConsignmentDispatchVisibilityContext {
  emanetEnabled: boolean;
}

export function isConsignmentDispatchVisible(ctx: ConsignmentDispatchVisibilityContext): boolean {
  return ctx.emanetEnabled;
}

export const CONSIGNMENT_DISPATCHES_PATH = "/operations/emanet-cikis";
