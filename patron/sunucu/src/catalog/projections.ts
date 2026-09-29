// BULUT PROJEKSİYON KATALOĞU — projeksiyon → izin eşlemesinin TEK KAYNAĞI (sözleşme §3, §9.5, §10).
// Kolon listesinin tek kaynağı FABRİKADADIR (`Teks-Erp/src/cloud-sync/projections.ts`); bulut kolon
// bilmez, satırı jsonb saklar. Burada yalnız bulutun kendi kararları durur:
//   · izin (alt satır: `.finans`, `.kisisel`) — eşlenmeyen projeksiyon RED (fail-closed)
//   · saklama tarihi alanı (OLGU; BOYUT ve durum-benzeri OLGU budanmaz) + sıralama alanı
//   · kök satırda BULUNAMAYACAK alan adları (FINANS/KISISEL sınıflı kolonlar alt satıra bölünür;
//     fabrika hatası kök satıra tutar sızdırırsa bulut o girdiyi REDDEDER)
//   · alt kaydın ebeveyni (ebeveyni budanan kalem öksüz kalmaz)
import type { CloudPermission } from "./permissions";

export type ProjectionKind = "BOYUT" | "OLGU" | "ANLIK";
export type SubRow = "finans" | "kisisel";

export interface RootProjection {
  readonly name: string;
  readonly kind: ProjectionKind;
  /** Kök satırı okumak için gereken izinlerin HEPSİ. */
  readonly permissions: readonly CloudPermission[];
  /** Saklama tarihi: ilk dolu alan (ISO) — fabrika kataloğunun `retention.wireFields`iyle BİREBİR (uzlaştırma iki ucu aynı tarihle süzer; bekçi `test_bulut_tel_aynasi`). */
  readonly retentionFields?: readonly string[];
  /** Liste sıralaması: ilk dolu alan (ISO); yoksa paketin ufku. */
  readonly sortFields?: readonly string[];
  readonly subRows?: readonly SubRow[];
  /** Kök satırda YASAK tel alanları (FINANS/KISISEL sınıfı — alt satıra aittir). */
  readonly forbiddenRootFields?: readonly string[];
  /** Kalem → üst belge: üstü canlı değilse kalem öksüzdür (bakım budar). */
  readonly parent?: { readonly projection: string; readonly field: string };
  /** Saklama tarihi kalemin kendisinde yok, ÜST belgeden gelir (fabrika `retention.parent`, S23) — uzlaştırma üstün ufkuyla süzer. */
  readonly retentionFromParent?: boolean;
}

const OTURUM: readonly CloudPermission[] = ["bulut:oturum"];
const FINANS_KOLONU: CloudPermission = "bulut:fiyat:oku";
const KISISEL_KOLONU: CloudPermission = "bulut:cari:oku";

/** Finans projeksiyonları: `.finans` alt satırı KENDİ izniyle açılır (fiyat izniyle değil). */
const FINANCE_FAMILY: ReadonlySet<string> = new Set([
  "cari-hesap",
  "cari-hareket",
  "kasa",
  "banka",
  "kasa-hareketi",
  "cek-senet",
  "fatura",
  "fatura-kalemi",
  "tahsilat-odeme",
  "fiyat",
]);

export const ROOT_PROJECTIONS: readonly RootProjection[] = [
  // ---- BOYUT (sözlükler; her hesap) ----
  { name: "urun", kind: "BOYUT", permissions: OTURUM },
  { name: "renk", kind: "BOYUT", permissions: OTURUM },
  { name: "depo", kind: "BOYUT", permissions: OTURUM },
  { name: "istasyon", kind: "BOYUT", permissions: OTURUM },
  { name: "cari-kart", kind: "BOYUT", permissions: OTURUM, subRows: ["kisisel"], forbiddenRootFields: ["yetkili", "telefon"] },
  { name: "sube", kind: "BOYUT", permissions: OTURUM },
  { name: "fason-firma", kind: "BOYUT", permissions: OTURUM },
  // ---- OLGU ----
  {
    name: "siparis",
    kind: "OLGU",
    permissions: ["bulut:siparis:oku"],
    retentionFields: ["siparisTarihi"],
    sortFields: ["siparisTarihi", "olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["tutar"],
  },
  {
    name: "siparis-kalemi",
    kind: "OLGU",
    permissions: ["bulut:siparis:oku"],
    retentionFields: ["olusturulma"],
    sortFields: ["olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["birimFiyat"],
    parent: { projection: "siparis", field: "siparisId" },
  },
  { name: "sevkiyat", kind: "OLGU", permissions: ["bulut:sevkiyat:oku"], retentionFields: ["cikisTarihi", "olusturulma"], sortFields: ["cikisTarihi", "olusturulma"] },
  { name: "dogrudan-sevk", kind: "OLGU", permissions: ["bulut:sevkiyat:oku"], retentionFields: ["cikisTarihi", "olusturulma"], sortFields: ["cikisTarihi", "olusturulma"] },
  { name: "cuval", kind: "OLGU", permissions: ["bulut:sevkiyat:oku"], retentionFields: ["olusturulma"], sortFields: ["olusturulma"] },
  { name: "is-emri", kind: "OLGU", permissions: ["bulut:uretim:oku"], retentionFields: ["olusturulma"], sortFields: ["olusturulma"] },
  {
    name: "cari-hesap",
    kind: "OLGU",
    permissions: ["bulut:cari-bakiye:oku"],
    subRows: ["finans"],
    forbiddenRootFields: ["vadeGun", "riskLimiti", "bakiyeler", "gecikmis"],
  },
  {
    name: "cari-hareket",
    kind: "OLGU",
    permissions: ["bulut:cari-bakiye:oku"],
    retentionFields: ["tarih"],
    sortFields: ["tarih", "olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["borc", "alacak", "tutarTl", "kur"],
  },
  { name: "kasa", kind: "OLGU", permissions: ["bulut:kasa:oku"], subRows: ["finans"], forbiddenRootFields: ["bakiye"] },
  { name: "banka", kind: "OLGU", permissions: ["bulut:kasa:oku"], subRows: ["finans"], forbiddenRootFields: ["bakiye"] },
  {
    name: "kasa-hareketi",
    kind: "OLGU",
    permissions: ["bulut:kasa:oku"],
    retentionFields: ["tarih"],
    sortFields: ["tarih", "olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["tutar", "tutarTl"],
  },
  {
    name: "cek-senet",
    kind: "OLGU",
    permissions: ["bulut:cek:oku"],
    retentionFields: ["vade", "olusturulma"],
    sortFields: ["vade", "olusturulma"],
    subRows: ["finans", "kisisel"],
    forbiddenRootFields: ["tutar", "tutarTl", "eslesen", "kesideci"],
  },
  {
    name: "cek-hareketi",
    kind: "OLGU",
    permissions: ["bulut:cek:oku"],
    retentionFields: ["tarih"],
    sortFields: ["tarih", "olusturulma"],
    parent: { projection: "cek-senet", field: "cekId" },
  },
  {
    name: "fatura",
    kind: "OLGU",
    permissions: ["bulut:fatura:oku"],
    retentionFields: ["tarih"],
    sortFields: ["tarih", "olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["kur", "araToplam", "iskonto", "kdv", "tevkifat", "genelToplam", "genelToplamTl", "odenen", "acikTutar"],
  },
  {
    name: "fatura-kalemi",
    kind: "OLGU",
    permissions: ["bulut:fatura:oku"],
    subRows: ["finans"],
    forbiddenRootFields: ["birimFiyat", "iskontoOrani", "kdvOrani", "tevkifatOrani", "tutar", "kdvTutari"],
    parent: { projection: "fatura", field: "faturaId" },
    retentionFromParent: true,
  },
  {
    name: "tahsilat-odeme",
    kind: "OLGU",
    permissions: ["bulut:tahsilat:oku"],
    retentionFields: ["tarih"],
    sortFields: ["tarih", "olusturulma"],
    subRows: ["finans"],
    forbiddenRootFields: ["tutar", "tutarTl", "eslesen", "eslesmemis"],
  },
  { name: "fiyat", kind: "OLGU", permissions: ["bulut:fiyat:oku"], subRows: ["finans"], forbiddenRootFields: ["fiyat"] },
  // ---- ANLIK (tek satır; her turda bütünüyle yeniden hesaplanır) ----
  { name: "ozet.stok", kind: "ANLIK", permissions: ["bulut:ozet:oku", "bulut:stok:oku"] },
  { name: "ozet.siparis", kind: "ANLIK", permissions: ["bulut:ozet:oku", "bulut:siparis:oku"] },
  { name: "ozet.uretim", kind: "ANLIK", permissions: ["bulut:ozet:oku", "bulut:uretim:oku"] },
  { name: "ozet.sevkiyat", kind: "ANLIK", permissions: ["bulut:ozet:oku", "bulut:sevkiyat:oku"] },
  { name: "ozet.fason", kind: "ANLIK", permissions: ["bulut:ozet:oku", "bulut:uretim:oku"] },
  { name: "ozet-finans", kind: "ANLIK", permissions: ["bulut:cari-bakiye:oku"] },
  { name: "stok-karnesi", kind: "ANLIK", permissions: ["bulut:stok:oku"] },
  { name: "acik-siparis-karsilama", kind: "ANLIK", permissions: ["bulut:siparis:oku"] },
  { name: "rapor-katalogu", kind: "ANLIK", permissions: OTURUM },
  { name: "uretim-akisi", kind: "ANLIK", permissions: ["bulut:uretim:oku"] },
  { name: "saglik", kind: "ANLIK", permissions: ["bulut:ozet:oku"] },
];

export interface ProjectionDef {
  /** Tam ad (`siparis` · `siparis.finans` · `ozet.stok`). */
  readonly name: string;
  readonly root: RootProjection;
  /** Alt satırsa türü; kök ya da ANLIK ise null. */
  readonly subRow: SubRow | null;
  readonly permissions: readonly CloudPermission[];
}

function subRowPermissions(root: RootProjection, sub: SubRow): readonly CloudPermission[] {
  const extra: CloudPermission = sub === "kisisel" ? KISISEL_KOLONU : FINANCE_FAMILY.has(root.name) ? root.permissions[0]! : FINANS_KOLONU;
  return [...new Set<CloudPermission>([...root.permissions, extra])];
}

function buildCatalog(): ReadonlyMap<string, ProjectionDef> {
  const out = new Map<string, ProjectionDef>();
  for (const root of ROOT_PROJECTIONS) {
    if (out.has(root.name)) throw new Error(`Projeksiyon kataloğunda tekrar: ${root.name}`);
    if (root.permissions.length === 0) throw new Error(`Projeksiyon izinsiz: ${root.name}`);
    out.set(root.name, { name: root.name, root, subRow: null, permissions: root.permissions });
    for (const sub of root.subRows ?? []) {
      const name = `${root.name}.${sub}`;
      out.set(name, { name, root, subRow: sub, permissions: subRowPermissions(root, sub) });
    }
  }
  for (const def of out.values()) {
    const parent = def.root.parent;
    if (parent && !out.has(parent.projection)) throw new Error(`Ebeveyn projeksiyon katalogda yok: ${parent.projection}`);
  }
  return out;
}

/** Açılışta kurulur: tutarsız katalog sunucuyu KALDIRMAZ (fail-closed). */
export const PROJECTION_CATALOG: ReadonlyMap<string, ProjectionDef> = buildCatalog();

export function projectionDef(name: string): ProjectionDef | undefined {
  return PROJECTION_CATALOG.get(name);
}

/** Hesabın okuyabileceği projeksiyon adları (izin kümesi ⊇ gereken). */
export function readableProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  const out: string[] = [];
  for (const def of PROJECTION_CATALOG.values()) if (def.permissions.every((p) => permissions.has(p))) out.push(def.name);
  return out;
}

/** Katalogdaki bütün adlar (bakım/eşitleme kapsamı; `*` yerine açık liste). */
export function allProjectionNames(): string[] {
  return [...PROJECTION_CATALOG.keys()];
}

/** Satırın ilk dolu ISO alanı (saklama/sıralama tarihi); biçimsizse yok sayılır. */
export function firstDate(data: Readonly<Record<string, unknown>>, fields: readonly string[] | undefined): Date | null {
  for (const f of fields ?? []) {
    const v = data[f];
    if (typeof v !== "string" || v.length === 0) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return null;
}
