// =============================================================================
// SAYAÇ DEĞER KURALLARI — panelin ALAN YANI uyarısı (2026-09-23)
// =============================================================================
// ⚠️ BACKEND'İN İKİZİ, YERİNE GEÇMEZ: `assertSeriesCounterAllowed` aynı üç kuralı
// zaten uyguluyor (400 `NUMBER_SERIES_COUNTER_INVALID` / `..._RANGE_INVALID`) ve
// DB CHECK'i de var. Buradaki kopya bir GÜVENLİK katmanı değil bir SÖYLEME
// katmanıdır: kullanıcı hatayı Kaydet'e bastıktan sonra kırmızı bir şeritte
// değil, YAZARKEN alanın yanında görsün. Sunucu kuralı değişirse burası da
// değişir — üçlü "çift yüklem" kalıbı (uygulama + DB + ekran).
//
// `null` = AYARLANMAMIŞ (bugünkü davranış) ve her zaman geçerlidir; "boş bırak"
// ile "1 yaz" aynı sonucu verir ama niyet farklıdır.
// =============================================================================
import type { SeriesCounterInput } from "./types";

export interface CounterFieldError {
  alan: "startValue" | "step" | "maxValue" | "wrap";
  mesaj: string;
}

export function counterErrors(c: SeriesCounterInput): CounterFieldError[] {
  const out: CounterFieldError[] = [];
  const tamPozitif = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 1);
  if (!tamPozitif(c.startValue)) out.push({ alan: "startValue", mesaj: "Başlangıç en az 1 olmalı." });
  if (!tamPozitif(c.step)) out.push({ alan: "step", mesaj: "Artış adımı en az 1 olmalı." });
  if (!tamPozitif(c.maxValue)) out.push({ alan: "maxValue", mesaj: "Üst sınır en az 1 olmalı." });
  if (
    c.maxValue !== null &&
    c.startValue !== null &&
    Number.isInteger(c.maxValue) &&
    Number.isInteger(c.startValue) &&
    c.maxValue < c.startValue
  ) {
    out.push({ alan: "maxValue", mesaj: "Üst sınır, başlangıç değerinden küçük olamaz." });
  }
  // Sarma üst sınırsız ANLAMSIZ — sunucu da 400 verir (`NUMBER_SERIES_WRAP_WITHOUT_MAX`).
  if (c.wrap && c.maxValue === null) {
    out.push({ alan: "wrap", mesaj: "Başa dönme için önce üst sınır girilmeli." });
  }
  return out;
}

export function counterFieldError(hatalar: CounterFieldError[], alan: CounterFieldError["alan"]): string | null {
  return hatalar.find((h) => h.alan === alan)?.mesaj ?? null;
}
