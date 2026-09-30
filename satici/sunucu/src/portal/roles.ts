// Portal rolleri × izinler × dinleyiciler — TEK KAYNAK. Her portal rotası bir izin beyan eder
// (bekçi: scripts/test_portal_rol_dinleyici.ts). Dinleyici ayrımı KESKİN: satıcı rolleri yalnız
// TAILNET'ten ve ERİŞİM'den (Cloudflare Access arkasındaki genel yol; yalnız izin listesindeki rotalar —
// kök parolalı ve hassas izinli uçlar orada yok), BAYI yalnız GENEL'den girer; oturum doğduğu dinleyiciye bağlıdır.
import type { PortalDinleyici, PortalRolu } from "@prisma/client";

export const PORTAL_ROLES = ["SATICI_YONETICI", "SATICI_OPERATOR", "BAYI"] as const satisfies readonly PortalRolu[];
export type PortalRole = (typeof PORTAL_ROLES)[number];
export type PortalListener = PortalDinleyici;

const VENDOR: readonly PortalRole[] = ["SATICI_YONETICI", "SATICI_OPERATOR"];
const ADMIN: readonly PortalRole[] = ["SATICI_YONETICI"];

export const PORTAL_PERMISSIONS = {
  /** Listeler, ayrıntılar, pano, katalog. */
  "portal:oku": VENDOR,
  /** Müşteri · tesis · kurulum ekle/güncelle/pasif. */
  "musteri:yaz": VENDOR,
  /** HAK taslağı + kök imzalı sürüm (kök parolası formdan). */
  "hak:yaz": VENDOR,
  "kod:uret": VENDOR,
  /** K0–K3 (K3 geri sayımı ≥ 7 gün), uzatma, geçerlilik bitişi, planlı eylem, taksit. */
  "yaptirim:yaz": VENDOR,
  /** K4 · K5 · geri sayımı 7 günden kısa K3 (planlı/taksit dahil; yazarak ikinci onay) · gözlem ↔ zorla. */
  "yaptirim:agir": ADMIN,
  /** Taşıma onay/ret, kopya uyarısı kapatma, DR geri alma. */
  "kurulum:yonet": VENDOR,
  /** Kurulum iptali ve iptalin geri alınması. */
  "kurulum:iptal": ADMIN,
  /** Kanal ana verisi (kod · ad · tür · güncel sürümler). */
  "kanal:yonet": ADMIN,
  "bayi:yonet": ADMIN,
  "kullanici:yonet": ADMIN,
  "denetim:oku": VENDOR,
  /** İlk kurulum bağlantısı · paylaşım bağlantısı · yükleme isteği · dosya yükle/indir (Faz 3d). */
  "dagitim:yaz": VENDOR,
  /** Yayıncı imza anahtarı kaydı ve pasife alınması (yayın bildirimi güveni). */
  "yayinci:yonet": ADMIN,
  /** Destek kutusu: fabrikanın talebine yanıt yazma ve talebi kapatma (okuma `portal:oku`). */
  "destek:yanitla": VENDOR,
  "anahtar:oku": VENDOR,
  /** Bildirimler: kanal durumu + son bildirimler (salt okuma). */
  "bildirim:oku": VENDOR,
  /** Bildirim yönetimi: deneme bildirimi (kanal sırları satıcıda DEĞİL, gönderici yan konteynerde). */
  "bildirim:yonet": ADMIN,
  /** Bayi alt-portalı (yalnız kendi müşterileri). */
  "bayi:portal": ["BAYI"],
} as const satisfies Record<string, readonly PortalRole[]>;
export type PortalPermission = keyof typeof PORTAL_PERMISSIONS;

/**
 * HASSAS sınıf (kök parolalı rotalarla aynı): bu izinlerin rotaları gövdede ya da yanıtta TOTP tohumu / başka
 * kullanıcının parolasını taşır — yalnız tailnet/geri döngüden; ERİŞİM listesine giremez (portal-http.ts
 * `erisimListesiBulgulari`), arayüz ERİŞİM oturumunda bu ekranları çizmez.
 */
export const TAILNET_ONLY_PERMISSIONS: readonly PortalPermission[] = ["kullanici:yonet"];

export const LISTENER_ROLES: Readonly<Record<PortalListener, readonly PortalRole[]>> = {
  TAILNET: VENDOR,
  GENEL: ["BAYI"],
  ERISIM: VENDOR,
};

export function roleHas(role: PortalRole, permission: PortalPermission): boolean {
  return (PORTAL_PERMISSIONS[permission] as readonly PortalRole[]).includes(role);
}

export function roleAllowedOn(role: PortalRole, listener: PortalListener): boolean {
  return LISTENER_ROLES[listener].includes(role);
}

/** Denetim/defterdeki `yapan` metni: rol ailesi + kullanıcı adı. */
export function actorOf(user: { rol: PortalRole; kullaniciAdi: string }): string {
  return `${user.rol === "BAYI" ? "bayi" : "satici"}:${user.kullaniciAdi}`;
}
