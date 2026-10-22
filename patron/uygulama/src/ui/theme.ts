// GEÇİCİ uyum katmanı: yeni kaynak `tokens.ts` + `useTokens()`. Henüz geçmemiş ekranlar (giriş, davet, hesap
// ayrıntısı) eski `color` adlarını okur; değerler etkin temadan gelir. Son kullanıcı geçince bu dosya silinir.
import { activeTokens } from "./theme-context";

export { space, TOUCH, WIDE_MIN } from "./tokens";

export const color = {
  get bg() { return activeTokens().bg; },
  get card() { return activeTokens().surface; },
  get text() { return activeTokens().text; },
  get muted() { return activeTokens().textMuted; },
  get line() { return activeTokens().separator; },
  get primary() { return activeTokens().tint; },
  get primaryText() { return activeTokens().onTint; },
  get danger() { return activeTokens().status.kritik.fill; },
  get warn() { return activeTokens().status.uyari.text; },
  get warnBg() { return activeTokens().status.uyari.bg; },
  get offBg() { return activeTokens().status.bilgi.bg; },
  get ok() { return activeTokens().status.iyi.fill; },
};
