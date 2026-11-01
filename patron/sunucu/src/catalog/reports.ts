// RAPOR ANAHTARI → BULUT İZNİ (sözleşme §7) — güvenlik kararı BULUTTADIR ve RAPOR BAŞINADIR: aile düzeyi
// izin aynı ailedeki dar izinli raporu (sevkiyat karnesi, çek vadesi) geniş izne açıyordu. Eşlenmeyen anahtar
// RED (fail-closed). Küme fabrikanın `REMOTE_REPORTS` listesiyle birebir (bekçi `test_bulut_tel_aynasi` §8).
// Audit ailesi buluta HİÇ gitmez; kişi adı taşıyan rapor (ya da varyant) listeye girmez. v2 anahtarlarının
// sonucu fabrikada kurulmuş `RaporSunumu`dur (tel tipi `wire/api.ts`); bulut yalnız saklar, hesaplamaz.
import { PARA_BIRIMLERI } from "../wire/api";
import { isCloudPermission, type CloudPermission } from "./permissions";

export const REPORT_KEY_PERMISSION: Readonly<Record<string, CloudPermission>> = {
  "sales/order-intake": "bulut:siparis:oku",
  "sales/shipment-scorecard": "bulut:sevkiyat:oku",
  "customer/scorecard": "bulut:siparis:oku",
  "quality/scorecard": "bulut:uretim:oku",
  "subcontract/scorecard": "bulut:uretim:oku",
  "inventory/scorecard": "bulut:stok:oku",
  "finance/aging": "bulut:cari-bakiye:oku",
  "finance/cheque-due": "bulut:cek:oku",
  // Raporlar v2 temel raporları (R1-BULUT)
  "sales/siparis-talep": "bulut:siparis:oku",
  "sales/sevkiyat": "bulut:sevkiyat:oku",
  "sales/termin": "bulut:sevkiyat:oku",
  "sales/acik-siparisler": "bulut:siparis:oku",
  "sales/vazgecilen-is": "bulut:siparis:oku",
  "quality/kalite": "bulut:uretim:oku",
  "quality/kayip": "bulut:uretim:oku",
  "inventory/depo": "bulut:stok:oku",
  "subcontract/fasoncular": "bulut:uretim:oku",
  "dokuma/tezgah-randimani": "bulut:uretim:oku",
  "dokuma/duruslar": "bulut:uretim:oku",
  "dokuma/levent-dengesi": "bulut:uretim:oku",
  "production/makine-duruslari": "bulut:uretim:oku",
  "finance/alacaklar": "bulut:cari-bakiye:oku",
  // D4-G4 (S15 a): kârlılık — maliyet tabanı ticari sır, yalnız maliyet okuma izinli hesap.
  "maliyet/karlilik": "bulut:maliyet:oku",
};

/** Buluttan İSTENEMEYEN raporlar (aile ya da tam anahtar). */
export const REPORTS_NOT_IN_CLOUD: readonly string[] = ["audit/*", "production/operator-performance", "production/uretim-akisi"];

const KEY_PATTERN = /^([a-z][a-z0-9-]{0,39})\/([a-z0-9][a-z0-9-]{0,79})$/;
const REPORT_READ: CloudPermission = "bulut:rapor:oku";

/** Rapor sonucunun RLS adı — rapor BAŞINA (`rapor.<aile>-<ad>`); tekilliği bekçi ölçer. */
export function reportProjectionName(key: string): string {
  return `rapor.${key.replace("/", "-")}`;
}

export type ReportVerdict =
  | { readonly ok: true; readonly family: string; readonly permission: CloudPermission; readonly projection: string }
  | { readonly ok: false; readonly reason: "BICIM" | "BULUTTA_YOK" | "RAPOR_BILINMIYOR" };

export function reportVerdict(key: string): ReportVerdict {
  const m = KEY_PATTERN.exec(key);
  if (!m) return { ok: false, reason: "BICIM" };
  const family = m[1]!;
  if (REPORTS_NOT_IN_CLOUD.includes(key) || REPORTS_NOT_IN_CLOUD.includes(`${family}/*`)) return { ok: false, reason: "BULUTTA_YOK" };
  const permission = Object.hasOwn(REPORT_KEY_PERMISSION, key) ? REPORT_KEY_PERMISSION[key] : undefined;
  if (!permission) return { ok: false, reason: "RAPOR_BILINMIYOR" };
  return { ok: true, family, permission, projection: reportProjectionName(key) };
}

/**
 * Raporu okumak için gereken izinler: `bulut:rapor:oku` + bulutun anahtar izni + (varsa) fabrikanın kataloğunda
 * beyan ettiği izin — ikisi ayrışırsa DAR olan (ikisi birden) uygulanır; tanınmayan beyan RED (`null`).
 */
export function requiredReportPermissions(permission: CloudPermission, factoryDeclared: unknown): CloudPermission[] | null {
  const out = new Set<CloudPermission>([REPORT_READ, permission]);
  if (factoryDeclared !== undefined && factoryDeclared !== null) {
    if (typeof factoryDeclared !== "string" || !isCloudPermission(factoryDeclared)) return null;
    out.add(factoryDeclared);
  }
  return [...out];
}

/** Rapor ailesine göre gruplu anahtarlar (geçiş adı `rapor.<aile>` için). */
function familyKeys(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of Object.keys(REPORT_KEY_PERMISSION)) {
    const family = key.split("/")[0]!;
    out.set(family, [...(out.get(family) ?? []), key]);
  }
  return out;
}

/**
 * Hesabın okuyabileceği rapor sonucu projeksiyonları — `bulut:rapor:oku` şart. Rapor başına ad + GEÇİŞ: eski
 * aile adlı sonuç satırı (`rapor.<aile>`) yalnız ailenin BÜTÜN raporlarını okuyabilen hesaba açıktır (sızıntı yok);
 * eski satırlar `RAPOR_SONUC_SAKLAMA_GUN` sonunda budanınca bu kol işlevsizleşir.
 */
export function readableReportProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  if (!permissions.has(REPORT_READ)) return [];
  const perKey = Object.entries(REPORT_KEY_PERMISSION)
    .filter(([, p]) => permissions.has(p))
    .map(([key]) => reportProjectionName(key));
  const legacy = [...familyKeys()]
    .filter(([, keys]) => keys.every((k) => permissions.has(REPORT_KEY_PERMISSION[k]!)))
    .map(([family]) => `rapor.${family}`);
  return [...perKey, ...legacy];
}

/** Bütün rapor sonucu adları (rapor başına + geçiş aile adları) — bakım budaması bunların hepsini görmeli. */
export function allReportProjections(): string[] {
  return [...Object.keys(REPORT_KEY_PERMISSION).map(reportProjectionName), ...[...familyKeys().keys()].map((f) => `rapor.${f}`)];
}

// PARA ALANLARI FİNANS SINIFIDIR (K-BULUT; kolon opt-in kalıbı `projections.ts` FINANS_KOLONU ile aynı): finans DIŞI
// raporda para birimli HER alan `bulut:fiyat:oku` ister — yan sayı, tablo kolonu (satır/toplam hücresiyle), para eksenli
// grafik ve fabrikanın `paraIcerir` işaretlediği anlatı cümlesi. Finans ailesi raporu KENDİ izniyle açar. Bulut hesap
// yapmaz — yalnız alanı düşürür (sayı değiştirmez, yeniden sıralamaz). Ana sayı zorunlu alandır, düşürülmez.
const FINANS_SINIFI: CloudPermission = "bulut:fiyat:oku";
const FINANCE_REPORT_PERMISSIONS: ReadonlySet<CloudPermission> = new Set<CloudPermission>(["bulut:cari-bakiye:oku", "bulut:cek:oku"]);
const PARA: ReadonlySet<string> = new Set<string>(PARA_BIRIMLERI);

const nesne = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const paraBirimli = (v: unknown): boolean => nesne(v) && PARA.has(String(v.birim));

function hucreleriAyikla(satir: unknown, dusen: ReadonlySet<string>): unknown {
  if (!nesne(satir)) return satir;
  return Object.fromEntries(Object.entries(satir).filter(([k]) => !dusen.has(k)));
}

function tabloyuKirp(tablo: unknown): unknown {
  if (!nesne(tablo) || !Array.isArray(tablo.kolonlar)) return tablo;
  const dusen = new Set(tablo.kolonlar.filter(paraBirimli).map((k) => String((k as { anahtar?: unknown }).anahtar)));
  if (dusen.size === 0) return tablo;
  return {
    ...tablo,
    kolonlar: tablo.kolonlar.filter((k) => !paraBirimli(k)),
    satirlar: Array.isArray(tablo.satirlar) ? tablo.satirlar.map((r) => hucreleriAyikla(r, dusen)) : tablo.satirlar,
    ...(tablo.toplam !== undefined ? { toplam: hucreleriAyikla(tablo.toplam, dusen) } : {}),
  };
}

export function stripMoneySideFigures(veri: unknown, reportPermission: CloudPermission, permissions: ReadonlySet<string>): unknown {
  if (FINANCE_REPORT_PERMISSIONS.has(reportPermission) || permissions.has(FINANS_SINIFI)) return veri;
  if (!nesne(veri) || !Array.isArray(veri.yanSayilar)) return veri; // sunum değil (v1 sonucu): dokunulmaz
  const out: Record<string, unknown> = { ...veri, yanSayilar: veri.yanSayilar.filter((y) => !paraBirimli(y)) };
  if (Array.isArray(veri.anlati)) out.anlati = veri.anlati.filter((c) => !(nesne(c) && c.paraIcerir === true));
  if ("tablo" in veri) out.tablo = tabloyuKirp(veri.tablo);
  if (nesne(veri.grafik) && nesne(veri.grafik.eksen) && paraBirimli(veri.grafik.eksen.y)) out.grafik = null;
  return out;
}
