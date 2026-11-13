// Yetenek: bağlanılan sunucunun NE sunduğu (kip değil). Bulut bugünkü her şeyi sunar; ERP okuma ucu yalnız
// `/auth/me` `patronReadSets` kümelerini ve okumayı sunar. Görünürlük (`lib/access.ts`) ve veri katmanı buna bakar;
// ekran "hangi kip" diye sormaz, istemci yalnız GİZLER — karar yine sunucudadır.

export interface Yetenek {
  /** Sunulan veri kümeleri; null = hepsi (bulut — sunucu kendi beyanıyla 404 verir). */
  readonly kumeler: ReadonlySet<string> | null;
  /** Veri canlı (eşitleme yok): "son eşitleme" yerine "son güncelleme"; eşitleme gecikmesi bandı yok. */
  readonly canli: boolean;
  /** Girişte doğrulama kodu HER ZAMAN istenir (bulut); değilse sunucu isterse (409 TOTP_REQUIRED). */
  readonly kodHerZaman: boolean;
  readonly yazma: boolean;
  readonly gelenKutusu: boolean;
  readonly rapor: boolean;
  readonly bildirim: boolean;
  /** Açılış zili (`POST /tazele`) ve değişim akışı (`GET /degisim`). */
  readonly tazele: boolean;
  readonly hesapYonetimi: boolean;
  readonly parolaDegistir: boolean;
  readonly hesapSil: boolean;
  readonly tesisGecisi: boolean;
}

export const BULUT_YETENEK: Yetenek = {
  kumeler: null,
  canli: false,
  kodHerZaman: true,
  yazma: true,
  gelenKutusu: true,
  rapor: true,
  bildirim: true,
  tazele: true,
  hesapYonetimi: true,
  parolaDegistir: true,
  hesapSil: true,
  tesisGecisi: true,
};

/** ERP okuma ucu (V3a): yalnız okuma; sunulan kümeler sunucunun beyanından (eski sunucu beyan etmezse BOŞ — fail-closed). */
export function erpYetenek(patronReadSets: unknown): Yetenek {
  const kumeler = new Set(Array.isArray(patronReadSets) ? patronReadSets.filter((x): x is string => typeof x === "string") : []);
  return {
    kumeler,
    canli: true,
    kodHerZaman: false,
    yazma: false,
    gelenKutusu: false,
    rapor: false,
    bildirim: false,
    tazele: false,
    hesapYonetimi: false,
    parolaDegistir: false,
    hesapSil: false,
    tesisGecisi: false,
  };
}

let etkin: Yetenek = BULUT_YETENEK;

/** Oturum bağlamı bağlantı değişince çağırır; görünürlük yardımcıları (`access.ts`) bunu okur. */
export function setYetenek(y: Yetenek): void {
  etkin = y;
}

export function yetenek(): Yetenek {
  return etkin;
}

/** Küme adı (`ozet.siparis`, `siparis`) bu sunucuda var mı. */
export function kumeSunuluyor(ad: string, y: Yetenek = etkin): boolean {
  return y.kumeler === null || y.kumeler.has(ad);
}

/**
 * Sunucunun verdiği izin kodlarından yeteneği OLMAYAN özelliklerin kodları düşer (düğme/ekran açılmasın):
 * yazma (`:yaz`), hesap yönetimi, rapor. Bulutta liste aynen döner.
 */
export function izinleriSuz(perms: readonly string[], y: Yetenek = etkin): readonly string[] {
  return perms.filter((p) => {
    if (!y.yazma && p.endsWith(":yaz")) return false;
    if (!y.hesapYonetimi && p === "bulut:hesap:yonet") return false;
    if (!y.rapor && p === "bulut:rapor:oku") return false;
    return true;
  });
}
