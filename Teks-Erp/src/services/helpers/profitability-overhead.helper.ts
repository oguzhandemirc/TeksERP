// =============================================================================
// KÂRLILIK — GENEL GİDER + İŞÇİLİK HAVUZU (D4-G2b; DALGA4 §8.3 "Genel gider", §9 H, §12.1 genelGiderAnahtari /
// kategoriSiniflari)
// =============================================================================
// Kasa masrafları (evren + kategori anahtarı `expense-summary.helper`/`cashCategoryKey`) ay × sınıf havuzuna toplanır:
//   `kategoriSiniflari` {kategori → ISCILIK | GENEL_GIDER | HARIC}; sınıflanmamış kategori GENEL_GIDER (tasarım §8.3
//   "bağlanmamış EXPENSE havuzu"). HARIC hiçbir yere girmez, ay özetinde görünür.
//   GENEL_GIDER havuzu `genelGiderAnahtari`na göre o ayın FATURALANAN satırlarına dağıtılır (METRE / GELIR /
//   MAKINE_SAATI); `YOK` (varsayılan) → dağıtılmaz, satır payı 0, net = katkı (ay özetinde dağıtılmamış havuz).
//   ISCILIK havuzu (S14: toplam maaş, kişi adı yok) her zaman makine saatine göre dağıtılır.
//   Son pay kalanı alır (Σ pay = havuz, kuruşu kuruşuna); taban ≤ 0 ise havuz dağıtılmamış kalır. İptal satırı pay
//   almaz (gider harcandığı ayda kalır). Masraf bağı (D4-G2c): bağlı pay as-of havuzdan düşer, doğrudan masraf olur
//   (`profitability-allocation.helper`); bağsız masraf burada kalır.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { ProfitCategoryClass, ProfitCategoryClassMap, ProfitOverheadKey } from "../system-setting.service";

const D0 = () => new Prisma.Decimal(0);

export interface ExpenseCell { key: string; label: string; className: string | null; month: string; amountTry: Prisma.Decimal }

export interface PoolCategory { key: string; label: string; categoryClass: ProfitCategoryClass; amountTry: Prisma.Decimal }

export interface MonthPools {
  month: string;
  overheadPoolTry: Prisma.Decimal;
  laborPoolTry: Prisma.Decimal;
  excludedTry: Prisma.Decimal;
  categories: PoolCategory[];
}

/** Hücrenin sınıfı — eşleme finans tarafında `cashCategoryKey` ile yapılır (`className`); eşleşmeyen GENEL_GIDER. */
export function classifyCategory(className: string | null, classes: ProfitCategoryClassMap): ProfitCategoryClass {
  return className !== null ? (classes[className] ?? "GENEL_GIDER") : "GENEL_GIDER";
}

/** Ay başına havuzlar (yalnız verilen aylar; her ay satırı var, masrafsız ay 0). */
export function buildMonthPools(months: string[], cells: ExpenseCell[], classes: ProfitCategoryClassMap): Map<string, MonthPools> {
  const out = new Map<string, MonthPools>(months.map((m) => [m, { month: m, overheadPoolTry: D0(), laborPoolTry: D0(), excludedTry: D0(), categories: [] }]));
  for (const c of cells) {
    const p = out.get(c.month);
    if (!p) continue;
    const cls = classifyCategory(c.className, classes);
    if (cls === "ISCILIK") p.laborPoolTry = p.laborPoolTry.plus(c.amountTry);
    else if (cls === "HARIC") p.excludedTry = p.excludedTry.plus(c.amountTry);
    else p.overheadPoolTry = p.overheadPoolTry.plus(c.amountTry);
    p.categories.push({ key: c.key, label: c.label, categoryClass: cls, amountTry: c.amountTry });
  }
  for (const p of out.values()) p.categories.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/** Havuzu tabana göre böler; son satır kalanı alır. Taban toplamı ≤ 0 → null (dağıtılmadı). */
export function distributePool(pool: Prisma.Decimal, bases: Prisma.Decimal[]): Prisma.Decimal[] | null {
  const total = bases.reduce((a, b) => a.plus(b), D0());
  if (pool.isZero()) return bases.map(() => D0());
  if (bases.length === 0 || total.lte(0)) return null;
  let used = D0();
  return bases.map((b, i) => {
    if (i === bases.length - 1) return pool.minus(used);
    const share = pool.mul(b).div(total);
    used = used.plus(share);
    return share;
  });
}

/** Genel gider dağıtım tabanı (satır ölçüsü). `YOK` çağrılmaz. */
export function overheadBase(key: Exclude<ProfitOverheadKey, "YOK">, row: { meters: Prisma.Decimal; revenueTry: Prisma.Decimal; machineHours: Prisma.Decimal | null }): Prisma.Decimal {
  const v = key === "METRE" ? row.meters : key === "GELIR" ? row.revenueTry : (row.machineHours ?? D0());
  return v.lt(0) ? D0() : v;
}
