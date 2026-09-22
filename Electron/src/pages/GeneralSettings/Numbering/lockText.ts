// =============================================================================
// KİLİT CÜMLELERİ — üç sınıf, üç FARKLI cümle (saf, 2026-09-22)
// =============================================================================
// ⚠️ ÜÇÜ AYNI CÜMLEYE İNDİRGENEMEZ çünkü üçü FARKLI GÜN kalkıyor ve yalnız
// BİRİ kullanıcının kendi çözebileceği şey:
//   · YAPISAL  → hiç açılmayabilir           (kimsenin işi değil)
//   · SAYAC    → biz hazırlayınca açılır     (BİZİM işimiz)
//   · ISTEMCI  → saha güncellenince açılır   (KULLANICININ işi)
// "Bu seri kilitli" diye tek cümle yazmak, kullanıcıyı kendi yapabileceği tek
// şeyden habersiz bırakırdı — `uc-sonuc-iki-degil` kuralının yüzeydeki karşılığı.
// =============================================================================
import type { SeriesLockKind } from "./types";

export interface KilitMetni {
  /** Rozet — kısa sınıf adı. */
  rozet: string;
  /** Ne zaman açılacağı; kullanıcı kendi yapabileceğini buradan ayırt eder. */
  neZaman: string;
  /** Eylem KİMDE: kullanıcı yalnız "siz"de bir şey yapabilir. */
  kimde: "kimse" | "biz" | "siz";
}

const METINLER: Record<SeriesLockKind, KilitMetni> = {
  YAPISAL: {
    rozet: "Değiştirilemez",
    neZaman: "Bu serinin biçimi yapısal olarak değişemez.",
    kimde: "kimse",
  },
  SAYAC: {
    rozet: "Hazırlanmadı",
    neZaman: "Bu seri biçim değişimine henüz hazırlanmadı; sonraki sürümlerde açılacak.",
    kimde: "biz",
  },
  ISTEMCI: {
    rozet: "Güncelleme bekliyor",
    neZaman: "Sahadaki panel ve tabletler güncellenince açılır.",
    kimde: "siz",
  },
};

export function kilitMetni(kind: SeriesLockKind): KilitMetni {
  return METINLER[kind];
}

/** Kullanıcının KENDİ çözebileceği kilit mi? (Ekranda ayrı vurgulanır.) */
export function kullaniciCozebilir(kind: SeriesLockKind): boolean {
  return METINLER[kind].kimde === "siz";
}
