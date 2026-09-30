// Portal izinleri — satıcı sunucusundaki TEK KAYNAĞIN (satici/sunucu/src/portal/roles.ts) aynası.
// Arayüz yalnız GİZLER (yetkisiz düğme çizilmez); kararı sunucu verir. Bekçi: src/test/mirrors.test.ts.
export type PortalRole = "SATICI_YONETICI" | "SATICI_OPERATOR" | "BAYI";

const VENDOR: readonly PortalRole[] = ["SATICI_YONETICI", "SATICI_OPERATOR"];
const ADMIN: readonly PortalRole[] = ["SATICI_YONETICI"];

export const PORTAL_PERMISSIONS = {
  "portal:oku": VENDOR,
  "musteri:yaz": VENDOR,
  "hak:yaz": VENDOR,
  "kod:uret": VENDOR,
  "yaptirim:yaz": VENDOR,
  "yaptirim:agir": ADMIN,
  "kurulum:yonet": VENDOR,
  "kurulum:iptal": ADMIN,
  "kanal:yonet": ADMIN,
  "bayi:yonet": ADMIN,
  "bayi:anahtar": ADMIN,
  "kullanici:yonet": ADMIN,
  "denetim:oku": VENDOR,
  "dagitim:yaz": VENDOR,
  "yayinci:yonet": ADMIN,
  "yayinci:anahtar": ADMIN,
  "destek:yanitla": VENDOR,
  "anahtar:oku": VENDOR,
  "bildirim:oku": VENDOR,
  "bildirim:yonet": ADMIN,
  "guncelleme:yaz": VENDOR,
  "bayi:portal": ["BAYI"],
} as const satisfies Record<string, readonly PortalRole[]>;

export type PortalPermission = keyof typeof PORTAL_PERMISSIONS;

export function roleHas(role: PortalRole | undefined, permission: PortalPermission): boolean {
  return role !== undefined && (PORTAL_PERMISSIONS[permission] as readonly PortalRole[]).includes(role);
}

/**
 * Yalnız tailnet/geri döngü oturumunda kullanılabilen izinler (hassas sınıf: hesap açma, TOTP ve parola sıfırlama
 * sırları Cloudflare'den geçmez; bayi/yayıncı anahtarı kaydı güven kökü ekler). Sunucudaki `TAILNET_ONLY_PERMISSIONS`
 * aynası; ERİŞİM oturumunda ekran/düğme çizilmez.
 */
export const TAILNET_ONLY_PERMISSIONS: readonly PortalPermission[] = ["kullanici:yonet", "bayi:anahtar", "yayinci:anahtar"];

/** ERİŞİM oturumunda rolü izinli ama dinleyicisi izin vermeyen anahtar kaydı düğmesinin yerine çizilen açıklama. */
export const KEY_REGISTRATION_TAILNET_ONLY =
  "Anahtar kaydı güven kökü ekler ve bu bağlantıdan yapılamaz. Portala tailnet ya da geri döngü tüneliyle (portal-baglan) bağlanın.";

/** Rol izni + oturumun dinleyicisi: ERİŞİM (Cloudflare Access arkası genel yol) oturumunda hassas izin yok. */
export function canUse(role: PortalRole | undefined, permission: PortalPermission, listener: "TAILNET" | "GENEL" | "ERISIM" | undefined): boolean {
  return roleHas(role, permission) && !(listener === "ERISIM" && TAILNET_ONLY_PERMISSIONS.includes(permission));
}
