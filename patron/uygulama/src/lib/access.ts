// Modül görünürlüğü — izin kodları bulut kataloğundan (`patron/sunucu/src/catalog/permissions.ts`;
// ayna bekçisi her literali orada arar). İstemci yalnız GİZLER; karar sunucudadır (403 yine gelir).
// İzne ek olarak bağlanılan sunucunun YETENEĞİ (`api/yetenek.ts`): modülün ana kümesi ya da özelliği sunulmuyorsa
// modül görünmez (bulutta her şey sunulur — bugünkü davranış).

import { islemVar, kumeSunuluyor, yetenek, type Islem, type Yetenek } from "../api/yetenek";
import { TERIM_AD } from "./terim";

type Ozellik = { [K in keyof Yetenek]: Yetenek[K] extends boolean ? K : never }[keyof Yetenek];
export type ModuleKey =
  | "pano"
  | "raporlar"
  | "siparisler"
  | "teklifler"
  | "standart-maliyetler"
  | "cariler"
  | "renkler"
  | "urunler"
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
  /** Modülün ekranı bu veri kümeleri olmadan çalışmaz (hepsi sunulmalı). */
  readonly sets?: readonly string[];
  /** Modül bu sunucu özelliğini ister (rapor, gelen kutusu…). */
  readonly feature?: Ozellik;
  /** Tanım ekranı: bu yazma işlemlerinden BİRİ açık olmalı (`islemVar`; bulutta kapalı). */
  readonly islemler?: readonly Islem[];
  /** `feature` sunulmuyor ama bu özellik sunuluyorsa modül YİNE görünür, bu ad ve alt metinle (aynı ekran, ör. ERP'de
   *  bildirim ayarı yok, gelen bildirim kutusu var). */
  readonly alt?: { readonly feature: Ozellik; readonly title: string; readonly hint: string };
}

export const FINANCE_READ = ["bulut:kasa:oku", "bulut:cek:oku", "bulut:fatura:oku", "bulut:tahsilat:oku"] as const;

export const MODULES: readonly ModuleDef[] = [
  { key: "pano", title: "Pano", route: "/pano", anyOf: [] },
  { key: "siparisler", title: "Siparişler", route: "/siparisler", anyOf: ["bulut:siparis:oku"], sets: ["siparis"] },
  { key: "cariler", title: "Cariler", hint: "Müşteri ve tedarikçiler", route: "/cariler", anyOf: ["bulut:cari:oku", "bulut:cari-bakiye:oku", "bulut:cari:yaz"], sets: ["cari-kart"] },
  { key: "renkler", title: "Renkler", hint: "Renk tanımları", route: "/renkler", anyOf: [], sets: ["renk"], islemler: ["renk.ekle", "renk.duzenle"] },
  { key: "urunler", title: "Ürünler", hint: "Ürün ve fiyatlar", route: "/urunler", anyOf: [], sets: ["urun"], islemler: ["fiyat.yaz", "urun.ekle", "urun.duzenle"] },
  { key: "sevkiyat", title: "Sevkiyat", hint: "Sevk edilen ve bekleyen", route: "/sevkiyat", anyOf: ["bulut:sevkiyat:oku"], sets: ["sevkiyat"] },
  { key: "uretim", title: "Üretim", route: "/uretim", anyOf: ["bulut:uretim:oku"], sets: ["is-emri"] },
  { key: "stok", title: "Stok", hint: "Ham ve bitmiş stok", route: "/stok", anyOf: ["bulut:stok:oku"], sets: ["stok-karnesi"] },
  { key: "finans", title: TERIM_AD.onMuhasebe, navTitle: "Finans", route: "/finans", anyOf: [...FINANCE_READ, "bulut:cari-bakiye:oku", "bulut:maliyet:oku"], sets: ["kasa"] },
  { key: "teklifler", title: "Teklifler", hint: "Müşteriye gönderilen teklifler", route: "/teklifler", anyOf: ["bulut:teklif:oku"], sets: ["teklif"] },
  { key: "standart-maliyetler", title: "Standart Maliyetler", hint: "Ürün başına metre maliyeti", route: "/standart-maliyetler", anyOf: ["bulut:teklif:oku"], allOf: ["bulut:maliyet:oku"], sets: ["standart-maliyet"] },
  { key: "raporlar", title: "Raporlar", hint: "Fabrikadan rapor isteyin", route: "/raporlar", anyOf: ["bulut:rapor:oku"], feature: "rapor" },
  { key: "gelen-kutusu", title: "Gelen Kutusu", hint: "Fabrikaya gönderilen talepler", route: "/gelen-kutusu", anyOf: ["bulut:siparis:yaz", "bulut:cari:yaz"], feature: "gelenKutusu" },
  { key: "hesaplar", title: "Hesaplar", hint: "Kim neyi görür, davetler", route: "/hesaplar", anyOf: ["bulut:hesap:yonet"], feature: "hesapYonetimi" },
  { key: "bildirimler", title: TERIM_AD.bildirimAyarlari, hint: "Bu cihazda izin, türler, sessiz saatler", route: "/bildirimler", anyOf: [], feature: "bildirim",
    alt: { feature: "bildirimKutusu", title: "Bildirimler", hint: "Fabrikanın size gönderdiği bildirimler" } },
  { key: "profil", title: "Profil", hint: "Görünüm, parola ve çıkış", route: "/profil", anyOf: [] },
];

/** Modül tanımı; ana özellik yok ama `alt` özellik varsa adı/alt metni alternatiften. */
export function moduleDef(key: ModuleKey, y: Yetenek = yetenek()): ModuleDef {
  const m = MODULES.find((x) => x.key === key);
  if (!m) throw new Error(`Tanımsız modül: ${key}`);
  return altActive(m, y) && m.alt ? { ...m, title: m.alt.title, navTitle: undefined, hint: m.alt.hint } : m;
}

function altActive(m: ModuleDef, y: Yetenek): boolean {
  return m.alt !== undefined && m.feature !== undefined && !y[m.feature] && y[m.alt.feature];
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

/** Sunucu bu modülü karşılıyor mu (izinden bağımsız). */
export function moduleServed(m: ModuleDef, y: Yetenek = yetenek()): boolean {
  return (m.sets ?? []).every((k) => kumeSunuluyor(k, y)) && (m.feature === undefined || y[m.feature] || altActive(m, y));
}

function moduleAllowed(perms: readonly string[], m: ModuleDef): boolean {
  const islem = m.islemler === undefined || m.islemler.some((i) => islemVar(i, perms));
  return canAny(perms, m.anyOf) && (m.allOf ?? []).every((c) => can(perms, c)) && moduleServed(m) && islem;
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
  return DASHBOARD_CARDS.filter((c) => c.allOf.every((p) => can(perms, p)) && kumeSunuluyor(c.projection));
}
