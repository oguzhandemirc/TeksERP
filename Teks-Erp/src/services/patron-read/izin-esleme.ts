// =============================================================================
// PATRON OKUMA UCU — küme kataloğu + ERP izni → bulut izni eşlemesi (V3a, 2026-11-13)
// =============================================================================
// Patron uygulaması ekran gizlemesini BULUT izin kodlarıyla yapar (`patron/uygulama/src/lib/access.ts`).
// Uygulama ERP'ye doğrudan bağlanınca aynı kodları ERP izinlerinden TÜRETİRİZ; atama yine panelde ERP
// izniyle yapılır, bulut kodu yalnız uygulamanın okuduğu bir görünümdür. Kümenin gerektirdiği bulut
// kodları fabrika kataloğundan türer (elle kopya katalog yok); bulut kataloğuyla eşitliği bekçi ölçer.
// =============================================================================
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { REPORT_PERMISSION_CODES } from "../../constants/permission-catalog";
import {
  RECORD_PROJECTIONS, SNAPSHOT_PROJECTIONS, subRowClasses, subRowName, subRowPermission,
  type ModuleKey, type RecordProjection,
} from "../../cloud-sync/projections";

/** Bu sunucunun verdiği KAYIT kümeleri (sıra = `/auth/me` `patronReadSets` sırası). */
export const PATRON_RECORD_SETS = [
  "siparis", "siparis-kalemi", "cari-kart",
  // V3c: kalan bulut KAYIT kökleri (boyutlar, sevk, üretim, finans, teklif/maliyet).
  "urun", "hizmet", "renk", "depo", "istasyon", "sube", "fason-firma",
  "sevkiyat", "dogrudan-sevk", "cuval", "is-emri",
  "cari-hesap", "cari-hareket", "kasa", "banka", "kasa-hareketi", "cek-senet", "cek-hareketi",
  "fatura", "fatura-kalemi", "tahsilat-odeme", "fiyat",
  "teklif", "teklif-kalemi", "standart-maliyet",
] as const;
/** Bu sunucunun verdiği ANLIK kümeler (bölümlü `ozet` bölüm adıyla). */
export const PATRON_SNAPSHOT_SETS = [
  "ozet.siparis", "ozet.sevkiyat", "ozet.uretim", "ozet.stok", "ozet.fason",
  "ozet-finans", "stok-karnesi", "acik-siparis-karsilama", "tesis",
  "ozet-masraf", "karlilik-ozet", "emanet-bakiye", "fason-acik", "hizmet-geliri", "uretim-akisi", "saglik", "rapor-katalogu",
] as const;

/**
 * Ticaret paketi tablosu okuyan kümeler: modülüne EK olarak `requireTicaretEnabled`den geçer (ERP'de fiyat kartı
 * router'ı ticaret kapısının arkasında). Kapı KÜME BAŞINA — router kapısı patronun bütün ekranını kapatırdı.
 */
export const TICARET_SETS: ReadonlySet<string> = new Set(["fiyat"]);

/**
 * ERP izni → verdiği bulut okuma kodları. TEK tablo; `patron-app:login` girişin kendisidir (her
 * patron oturumunda var) ve örtük oturum + özet kodunu verir — her özet bölümü ayrıca kendi alan iznini ister.
 * Yazma (`bulut:*:yaz`) ve `bulut:hesap:yonet` BİLEREK yok: bu dilimde yazma ucu yoktur (uygulama düğmeyi gizler).
 */
export const ERP_TO_CLOUD: ReadonlyArray<{ readonly erp: string; readonly cloud: readonly string[] }> = [
  { erp: "patron-app:login", cloud: ["bulut:oturum", "bulut:ozet:oku"] },
  { erp: "order:read", cloud: ["bulut:siparis:oku"] },
  { erp: "shipping:read", cloud: ["bulut:sevkiyat:oku"] },
  { erp: "workorder:read", cloud: ["bulut:uretim:oku"] },
  // Stok karnesi ERP'de rapor kapısının arkasında (`reports/stock-scorecard`) — aynı izin.
  { erp: "report:inventory", cloud: ["bulut:stok:oku"] },
  { erp: "customer:read", cloud: ["bulut:cari:oku"] },
  // `finance:read` ERP'nin TUTAR GÖRME kapısıdır: bakiye, kasa, çek, fatura, tahsilat ve sipariş tutarı birlikte.
  {
    erp: "finance:read",
    cloud: ["bulut:cari-bakiye:oku", "bulut:kasa:oku", "bulut:cek:oku", "bulut:fatura:oku", "bulut:tahsilat:oku", "bulut:fiyat:oku"],
  },
  { erp: "quote:read", cloud: ["bulut:teklif:oku"] },
  { erp: "cost:read", cloud: ["bulut:maliyet:oku"] },
];

/** Kullanıcının ETKİN bulut kodları (sıralı, tekil). Rapor kodu: herhangi bir `report:*`. */
export function effectiveCloudPermissions(erpPermissions: readonly string[]): string[] {
  const out = new Set<string>();
  for (const row of ERP_TO_CLOUD) if (matchesPermission(erpPermissions, row.erp)) for (const c of row.cloud) out.add(c);
  if (REPORT_PERMISSION_CODES.some((p) => matchesPermission(erpPermissions, p))) out.add("bulut:rapor:oku");
  return [...out].sort();
}

export interface SetDef {
  readonly name: string;
  readonly kind: "KAYIT" | "ANLIK";
  /** Okumak için gereken bulut kodlarının HEPSİ (bulut `readableDef` ile aynı küme). */
  readonly requires: readonly string[];
  /** Kümeyi kapatan modül (adlı kapıdan geçer). */
  readonly module?: ModuleKey;
  /** Kümenin bütün adlı kapıları sırayla (modül + ticaret tablosu okuyorsa ticaret). */
  readonly gates: readonly GateKey[];
  /** ANLIK: fabrika kurucusunun kök adı (`ozet.stok` → `ozet`). */
  readonly builder?: string;
  /** KAYIT: alt satır adı → gereken bulut kodları. */
  readonly subRows?: Readonly<Record<"finans" | "kisisel", readonly string[] | undefined>>;
  readonly projection?: RecordProjection;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Adlı kapı anahtarı: projeksiyon modülü ya da ticaret paketi (route `MODULE_GATES` haritası). */
export type GateKey = ModuleKey | "ticaret.enabled";
const gatesOf = (name: string, module: ModuleKey | undefined): GateKey[] =>
  [...(module ? [module] : []), ...(TICARET_SETS.has(name) ? (["ticaret.enabled"] as const) : [])];

function recordDef(name: string): SetDef {
  const p = RECORD_PROJECTIONS.find((x) => x.name === name);
  if (!p) throw new Error(`Patron okuma: fabrika kataloğunda KAYIT yok (${name})`);
  const subRows: Record<"finans" | "kisisel", readonly string[] | undefined> = { finans: undefined, kisisel: undefined };
  for (const cls of subRowClasses(p)) {
    const key = subRowName(p, cls).slice(p.name.length + 1) as "finans" | "kisisel";
    subRows[key] = uniq([p.permission, subRowPermission(p, cls)]);
  }
  return { name, kind: "KAYIT", requires: [p.permission], module: p.module, gates: gatesOf(name, p.module), subRows, projection: p };
}

function snapshotDef(name: string): SetDef {
  for (const s of SNAPSHOT_PROJECTIONS) {
    const sec = s.sections?.find((x) => x.name === name);
    const module = sec ? sec.module ?? s.module : s.module;
    if (sec) return { name, kind: "ANLIK", requires: uniq([s.permission, sec.permission]), module, gates: gatesOf(name, module), builder: s.name };
    if (!s.sections && s.name === name) return { name, kind: "ANLIK", requires: [s.permission], module, gates: gatesOf(name, module), builder: s.name };
  }
  throw new Error(`Patron okuma: fabrika kataloğunda ANLIK yok (${name})`);
}

/** Açılışta kurulur: katalogda olmayan küme adı süreci KALDIRMAZ, modül yüklenirken fırlatır (fail-closed). */
const SETS: ReadonlyMap<string, SetDef> = new Map([
  ...PATRON_RECORD_SETS.map((n) => [n, recordDef(n)] as const),
  ...PATRON_SNAPSHOT_SETS.map((n) => [n, snapshotDef(n)] as const),
]);

export function patronSet(name: string, kind: "KAYIT" | "ANLIK"): SetDef | undefined {
  const d = SETS.get(name);
  return d && d.kind === kind ? d : undefined;
}

export const canRead = (cloud: ReadonlySet<string>, codes: readonly string[]): boolean => codes.every((c) => cloud.has(c));

/** `GET /oturum` `projeksiyonlar`: okunabilir kök + alt satır adları (bulut `readableProjections` biçimi). */
export function readableSetNames(cloud: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const d of SETS.values()) {
    if (!canRead(cloud, d.requires)) continue;
    out.push(d.name);
    for (const sub of ["finans", "kisisel"] as const) {
      const req = d.subRows?.[sub];
      if (req && canRead(cloud, req)) out.push(`${d.name}.${sub}`);
    }
  }
  return out;
}

export const PATRON_READ_SETS: readonly string[] = [...PATRON_RECORD_SETS, ...PATRON_SNAPSHOT_SETS];
