// Modül görünürlüğü — izin kodları bulut kataloğundan (`patron/sunucu/src/catalog/permissions.ts`;
// ayna bekçisi her literali orada arar). İstemci yalnız GİZLER; karar sunucudadır (403 yine gelir).

import { TERIM_AD } from "./terim";
export type ModuleKey =
  | "pano"
  | "raporlar"
  | "siparisler"
  | "teklifler"
  | "standart-maliyetler"
  | "cariler"
  | "sevkiyat"
  | "uretim"
  | "stok"
  | "finans"
  | "gelen-kutusu"
  | "hesaplar"
  | "bildirimler"
  | "profil";

export interface ModuleDef {
  readonly key: ModuleKey;
  /** Ekran başlığı — modül kök ekranı bunu çizer (`Screen` başlıksız çağrılırsa). */
  readonly title: string;
  /** Gezinme adı (sekme · ray · Diğer satırı) yalnız başlıktan kısaysa; yoksa `title`. */
  readonly navTitle?: string;
  /** Diğer/Profil satırının alt metni (tek kaynak). */
  readonly hint?: string;
  readonly route: string;
  /** Bunlardan BİRİ yeter; boş = her hesap. */
  readonly anyOf: readonly string[];
  /** Ayrıca bunların HEPSİ gerekir (ör. maliyet ekranı: kök satır izni + maliyet izni). */
  readonly allOf?: readonly string[];
}

export const FINANCE_READ = ["bulut:kasa:oku", "bulut:cek:oku", "bulut:fatura:oku", "bulut:tahsilat:oku"] as const;

export const MODULES: readonly ModuleDef[] = [
  { key: "pano", title: "Pano", route: "/pano", anyOf: [] },
  { key: "siparisler", title: "Siparişler", route: "/siparisler", anyOf: ["bulut:siparis:oku"] },
  { key: "cariler", title: "Cariler", hint: "Müşteri ve tedarikçiler", route: "/cariler", anyOf: ["bulut:cari:oku", "bulut:cari-bakiye:oku", "bulut:cari:yaz"] },
  { key: "sevkiyat", title: "Sevkiyat", hint: "Sevk edilen ve bekleyen", route: "/sevkiyat", anyOf: ["bulut:sevkiyat:oku"] },
  { key: "uretim", title: "Üretim", route: "/uretim", anyOf: ["bulut:uretim:oku"] },
  { key: "stok", title: "Stok", hint: "Ham ve bitmiş stok", route: "/stok", anyOf: ["bulut:stok:oku"] },
  { key: "finans", title: TERIM_AD.onMuhasebe, navTitle: "Finans", route: "/finans", anyOf: [...FINANCE_READ, "bulut:cari-bakiye:oku", "bulut:maliyet:oku"] },
  { key: "teklifler", title: "Teklifler", hint: "Müşteriye gönderilen teklifler", route: "/teklifler", anyOf: ["bulut:teklif:oku"] },
  { key: "standart-maliyetler", title: "Standart Maliyetler", hint: "Ürün başına metre maliyeti", route: "/standart-maliyetler", anyOf: ["bulut:teklif:oku"], allOf: ["bulut:maliyet:oku"] },
  { key: "raporlar", title: "Raporlar", hint: "Fabrikadan rapor isteyin", route: "/raporlar", anyOf: ["bulut:rapor:oku"] },
  { key: "gelen-kutusu", title: "Gelen Kutusu", hint: "Fabrikaya gönderilen talepler", route: "/gelen-kutusu", anyOf: ["bulut:siparis:yaz", "bulut:cari:yaz"] },
  { key: "hesaplar", title: "Hesaplar", hint: "Kim neyi görür, davetler", route: "/hesaplar", anyOf: ["bulut:hesap:yonet"] },
  { key: "bildirimler", title: TERIM_AD.bildirimAyarlari, hint: "Bu cihazda izin, türler, sessiz saatler", route: "/bildirimler", anyOf: [] },
  { key: "profil", title: "Profil", hint: "Görünüm, parola ve çıkış", route: "/profil", anyOf: [] },
];

export function moduleDef(key: ModuleKey): ModuleDef {
  const m = MODULES.find((x) => x.key === key);
  if (!m) throw new Error(`Tanımsız modül: ${key}`);
  return m;
}

/** Ekran başlığı (tek kaynak; UX-4 P4). */
export function moduleTitle(key: ModuleKey): string {
  return moduleDef(key).title;
}

/** Sekme/ray/Diğer satırı adı: kısa ad varsa o, yoksa ekran başlığı. */
export function moduleNavTitle(key: ModuleKey): string {
  const m = moduleDef(key);
  return m.navTitle ?? m.title;
}

export function can(perms: readonly string[] | ReadonlySet<string>, code: string): boolean {
  return Array.isArray(perms) ? perms.includes(code) : (perms as ReadonlySet<string>).has(code);
}

export function canAny(perms: readonly string[] | ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.length === 0 || codes.some((c) => can(perms, c));
}

function moduleAllowed(perms: readonly string[], m: ModuleDef): boolean {
  return canAny(perms, m.anyOf) && (m.allOf ?? []).every((c) => can(perms, c));
}

export function visibleModules(perms: readonly string[]): ModuleDef[] {
  return MODULES.filter((m) => moduleAllowed(perms, m));
}

export function moduleVisible(perms: readonly string[], key: ModuleKey): boolean {
  const m = MODULES.find((x) => x.key === key);
  return m !== undefined && moduleAllowed(perms, m);
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
