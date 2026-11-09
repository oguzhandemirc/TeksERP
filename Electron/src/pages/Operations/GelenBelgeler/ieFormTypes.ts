// Gülkesim K30 S16a — iş emri tek formu ayarları ve okuma özeti alanları; backend aynası (`gelen-belge-ayar.service.ts`,
// `gelen-belge-okuma-ozeti.service.ts`). Eski backend alanları göndermez → istemci bugünkü davranışta kalır.

/** Okunan desen/renk yazısı — KAPALI kullanılmaz · ONER kayıt önerilir (varsayılan) · NOT iş emri notuna eklenir. */
export type DesenRenkEslesmeMode = "KAPALI" | "ONER" | "NOT";
/** Tablet iş emri girişi — IKISI (varsayılan, bugünkü) · BELGE yalnız belge okutma · TOP yalnız top okutma. */
export type TabletIeGirisiMode = "IKISI" | "BELGE" | "TOP";
/** Tanıtılan belgeye güven (K30-B) — SOR (varsayılan, bugünkü) okunanlar onaylatılır · SORMA tanıtılan belge sorusuz dolar. */
export type TanitimGuveniMode = "SOR" | "SORMA";

export interface IeFormSettings {
  desenRenkEslesme?: DesenRenkEslesmeMode;
  defaultDesenRenkEslesme?: DesenRenkEslesmeMode;
  tabletIeGirisi?: TabletIeGirisiMode;
  defaultTabletIeGirisi?: TabletIeGirisiMode;
  tanitimGuveni?: TanitimGuveniMode;
  defaultTanitimGuveni?: TanitimGuveniMode;
}
