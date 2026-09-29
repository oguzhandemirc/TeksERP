// Bulut adresi derleme anında verilir (EXPO_PUBLIC_PATRON_API); tek mağaza uygulaması — hangi
// fabrikanın verisi göründüğü adresten değil HESAPTAN gelir. Adres yoksa uygulama giriş yapmaz (fail-closed).
export function apiBaseUrl(): string | null {
  const v = process.env.EXPO_PUBLIC_PATRON_API;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v.replace(/\/+$/, "") : null;
}
