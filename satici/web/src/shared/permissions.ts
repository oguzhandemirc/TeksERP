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
  "kullanici:yonet": ADMIN,
  "denetim:oku": VENDOR,
  "dagitim:yaz": VENDOR,
  "yayinci:yonet": ADMIN,
  "anahtar:oku": VENDOR,
  "bayi:portal": ["BAYI"],
} as const satisfies Record<string, readonly PortalRole[]>;

export type PortalPermission = keyof typeof PORTAL_PERMISSIONS;

export function roleHas(role: PortalRole | undefined, permission: PortalPermission): boolean {
  return role !== undefined && (PORTAL_PERMISSIONS[permission] as readonly PortalRole[]).includes(role);
}
