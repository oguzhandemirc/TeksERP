// Bulut adresi derleme anında verilir (EXPO_PUBLIC_PATRON_API); tek mağaza uygulaması — hangi
// fabrikanın verisi göründüğü adresten değil HESAPTAN gelir. Adres yoksa uygulama giriş yapmaz (fail-closed).
// Web sürümü API ile aynı kökenden sunulur: `koken` değeri adres olarak sayfanın http(s) kökenini alır;
// kökeni olmayan ortamda (telefon uygulaması) yine null.
export const AYNI_KOKEN = "koken";

function sayfaKokeni(): string | null {
  const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin;
  return typeof origin === "string" ? origin : null;
}

export function apiBaseUrl(deger: string | undefined = process.env.EXPO_PUBLIC_PATRON_API, koken: string | null = sayfaKokeni()): string | null {
  const v = deger === AYNI_KOKEN ? koken : deger;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v.replace(/\/+$/, "") : null;
}
