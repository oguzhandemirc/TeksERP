// Modül görünürlüğü — izin kodları bulut kataloğundan (`patron/sunucu/src/catalog/permissions.ts`;
// ayna bekçisi her literali orada arar). İstemci yalnız GİZLER; karar sunucudadır (403 yine gelir).

export type ModuleKey =
  | "pano"
  | "raporlar"
  | "siparisler"
  | "cariler"
  | "sevkiyat"
  | "uretim"
  | "stok"
  | "finans"
  | "gelen-kutusu"
  | "hesaplar"
  | "profil";

export interface ModuleDef {
  readonly key: ModuleKey;
  readonly title: string;
  readonly route: string;
  /** Bunlardan BİRİ yeter; boş = her hesap. */
  readonly anyOf: readonly string[];
}

export const FINANCE_READ = ["bulut:kasa:oku", "bulut:cek:oku", "bulut:fatura:oku", "bulut:tahsilat:oku"] as const;

export const MODULES: readonly ModuleDef[] = [
  { key: "pano", title: "Pano", route: "/pano", anyOf: [] },
  { key: "siparisler", title: "Siparişler", route: "/siparisler", anyOf: ["bulut:siparis:oku"] },
  { key: "cariler", title: "Cariler", route: "/cariler", anyOf: ["bulut:cari:oku", "bulut:cari-bakiye:oku", "bulut:cari:yaz"] },
  { key: "sevkiyat", title: "Sevkiyat", route: "/sevkiyat", anyOf: ["bulut:sevkiyat:oku"] },
  { key: "uretim", title: "Üretim", route: "/uretim", anyOf: ["bulut:uretim:oku"] },
  { key: "stok", title: "Stok", route: "/stok", anyOf: ["bulut:stok:oku"] },
  { key: "finans", title: "Finans", route: "/finans", anyOf: [...FINANCE_READ, "bulut:cari-bakiye:oku"] },
  { key: "raporlar", title: "Raporlar", route: "/raporlar", anyOf: ["bulut:rapor:oku"] },
  { key: "gelen-kutusu", title: "Gelen kutusu", route: "/gelen-kutusu", anyOf: ["bulut:siparis:yaz", "bulut:cari:yaz"] },
  { key: "hesaplar", title: "Hesaplar", route: "/hesaplar", anyOf: ["bulut:hesap:yonet"] },
  { key: "profil", title: "Profil", route: "/profil", anyOf: [] },
];

export function can(perms: readonly string[] | ReadonlySet<string>, code: string): boolean {
  return Array.isArray(perms) ? perms.includes(code) : (perms as ReadonlySet<string>).has(code);
}

export function canAny(perms: readonly string[] | ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.length === 0 || codes.some((c) => can(perms, c));
}

export function visibleModules(perms: readonly string[]): ModuleDef[] {
  return MODULES.filter((m) => canAny(perms, m.anyOf));
}

export function moduleVisible(perms: readonly string[], key: ModuleKey): boolean {
  const m = MODULES.find((x) => x.key === key);
  return m !== undefined && canAny(perms, m.anyOf);
}

/** Pano kartları: anlık özet → gereken izinlerin HEPSİ (sunucu kataloğuyla aynı küme). */
export const DASHBOARD_CARDS: readonly { readonly projection: string; readonly title: string; readonly allOf: readonly string[] }[] = [
  { projection: "ozet.siparis", title: "Siparişler", allOf: ["bulut:ozet:oku", "bulut:siparis:oku"] },
  { projection: "ozet.sevkiyat", title: "Sevkiyat", allOf: ["bulut:ozet:oku", "bulut:sevkiyat:oku"] },
  { projection: "ozet.uretim", title: "Üretim", allOf: ["bulut:ozet:oku", "bulut:uretim:oku"] },
  { projection: "ozet.stok", title: "Stok", allOf: ["bulut:ozet:oku", "bulut:stok:oku"] },
  { projection: "ozet.fason", title: "Fason", allOf: ["bulut:ozet:oku", "bulut:uretim:oku"] },
  { projection: "ozet-finans", title: "Finans", allOf: ["bulut:cari-bakiye:oku"] },
];

export function visibleCards(perms: readonly string[]) {
  return DASHBOARD_CARDS.filter((c) => c.allOf.every((p) => can(perms, p)));
}
