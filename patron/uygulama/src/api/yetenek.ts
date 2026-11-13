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
  /** ERP kullanıcısının ham izinleri (`/auth/me` `permissions`); bulutta null — yazma işlemleri bulut kodlarından. */
  readonly erpIzinleri: readonly string[] | null;
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
  erpIzinleri: null,
};

const dizeler = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * ERP sunucusu: sunulan kümeler sunucunun beyanından (eski sunucu beyan etmezse BOŞ — fail-closed). Bulut yazma
 * kanalı (gelen kutusu, `:yaz` kodları) yok; ERP yazma işlemleri ham ERP izinlerinden (`islemVar`).
 */
export function erpYetenek(patronReadSets: unknown, erpPermissions?: unknown): Yetenek {
  const kumeler = new Set(dizeler(patronReadSets));
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
    erpIzinleri: dizeler(erpPermissions),
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

/** Telefondan yapılabilen yazma işlemleri; ekran kipi değil işlemi sorar. */
export const ISLEMLER = ["siparis.ekle", "siparis.duzenle", "siparis.iptal", "cari.ekle", "cari.duzenle", "cari.pasif"] as const;
export type Islem = (typeof ISLEMLER)[number];

/** Fabrikanın `matchesPermission` aynası: `*` · `alan:*` · tam kod. */
export function erpIzinVar(perms: readonly string[], code: string): boolean {
  if (perms.includes("*") || perms.includes(code)) return true;
  const colon = code.indexOf(":");
  return colon > 0 && perms.includes(`${code.slice(0, colon)}:*`);
}

/** ERP işlemi → gereken izinler (hepsi) ve sunulması gereken kümeler (form seçicileri/detay). Uçların kendi izinleri. */
const ERP_ISLEM: Readonly<Record<Islem, { readonly izin: readonly (readonly string[])[]; readonly kume: readonly string[] }>> = {
  // `mobile:siparis` yalnız yaratmaya açılır (fabrika rotası `requireAnyPermission("order:write","mobile:siparis")`).
  "siparis.ekle": { izin: [["order:write", "mobile:siparis"]], kume: ["cari-kart", "urun"] },
  "siparis.duzenle": { izin: [["order:write"], ["order:read"]], kume: ["siparis", "cari-kart"] },
  "siparis.iptal": { izin: [["order:write"]], kume: ["siparis"] },
  "cari.ekle": { izin: [["customer:write"]], kume: ["cari-kart"] },
  "cari.duzenle": { izin: [["customer:write"], ["customer:read"]], kume: ["cari-kart"] },
  "cari.pasif": { izin: [["customer:write"]], kume: ["cari-kart"] },
};

/** Bulut: yalnız gelen kutusu yaratması, bugünkü kodlarla (`perms` = oturumun bulut izinleri). */
const BULUT_ISLEM: Readonly<Partial<Record<Islem, string>>> = { "siparis.ekle": "bulut:siparis:yaz", "cari.ekle": "bulut:cari:yaz" };

/** İşlem bu sunucuda ve bu kullanıcıya açık mı. İstemci yalnız GİZLER; karar yine sunucuda. */
export function islemVar(islem: Islem, perms: readonly string[], y: Yetenek = etkin): boolean {
  if (y.erpIzinleri === null) {
    const code = BULUT_ISLEM[islem];
    return code !== undefined && perms.includes(code);
  }
  const d = ERP_ISLEM[islem];
  const izinler = y.erpIzinleri;
  return d.izin.every((anyOf) => anyOf.some((c) => erpIzinVar(izinler, c))) && d.kume.every((k) => kumeSunuluyor(k, y));
}
