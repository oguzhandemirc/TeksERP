// =============================================================================
// MASRAF ÖZETİ — tek kaynak (D4-H1; ister 4.3 / 5.3, 1e kararı K18)
// =============================================================================
// "Bu ay neye ne harcadık" sorusunun TEK hesabı. Özet FABRİKADA hesaplanır; bulut
// toplama yapmaz (patron projeksiyonu D4-H2 bu helper'ı okur, kendisi toplamaz).
//
// ── KATEGORİ ANAHTARI TEK YERDE ──────────────────────────────────────────────
// `cashCategoryKey` kasa hareketinin serbest kategori metnini gruplama anahtarına
// çevirir (`CAT:<trim'li metin>`; boş → `CAT:` "Kategorisiz"). Kasa defteri
// (`cash-book.report.ts`) kırılımı da BURADAN okur: iki ayrı anahtar kuralı yazılsaydı
// masraf özeti ile defter kırılımı aynı metni farklı kovaya koyardı. Harf katlanmaz
// (gerekçe `cash-book.report.ts` başlığı: katlama "katalog zamanı geldi" sinyalini gizler).
// AST bekçisi: `test_masraf_ozeti §5` — bu dosya dışında `CAT:` anahtarı yazılamaz.
//
// ── EVREN = KASA DEFTERİNİN EXPENSE SATIRLARI ────────────────────────────────
// Asıl satır `txnDate` ayında +, iptal `cancelledAt` ayında − (defter kronolojisi:
// geçmiş ayın rakamı iptalle DEĞİŞMEZ, ters etki iptal ayına düşer). Tutar `amountTry`
// (döviz masrafı fişteki kurla TL). `test_masraf_ozeti §1` aynı aralıkta Σ özet =
// kasa defteri EXPENSE toplamı eşitliğini ölçer — TRY hesaplarda; döviz hesabında defter
// hesap para birimiyle (`amount`), özet TL karşılığıyla (`amountTry`) toplar, sayılar ayrışır.
// =============================================================================

import { Prisma, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryMonthSql, factoryYmd } from "../../constants/time";
import { D, D0 } from "./finance.helper";
import { readFinanceExpenseCategorySuggestions } from "../system-setting.service";

export const UNCATEGORIZED_LABEL = "Kategorisiz";
const CATEGORY_KEY_PREFIX = "CAT:";

/** Serbest kategori metni → gruplama anahtarı + gösterim etiketi (yalnız trim; harf katlanmaz). */
export function cashCategoryKey(raw: string | null | undefined): { key: string; label: string } {
  const text = (raw ?? "").trim();
  return { key: `${CATEGORY_KEY_PREFIX}${text}`, label: text || UNCATEGORIZED_LABEL };
}

export interface ExpenseSummaryParams {
  range: { from: Date; to: Date };
  /** Masrafın ASIL para birimi süzgeci (varyant `paraBirimi` hücresi); yoksa hepsi. Tutar yine TL karşılığıdır. */
  currency?: Currency[];
}

export interface ExpenseSummaryCell {
  /** Fabrika ayı `YYYY-MM`. */
  month: string;
  /** Net TL (asıl − iptal), 2 haneli dize. */
  amountTry: string;
  expenseCount: number;
  cancelCount: number;
}

export interface ExpenseSummaryCategory {
  key: string;
  label: string;
  totalTry: string;
  expenseCount: number;
  cancelCount: number;
  cells: ExpenseSummaryCell[];
}

export interface ExpenseSummary {
  /** Aralıktaki fabrika ayları (artan); hareketsiz ay da listelenir. */
  months: string[];
  /** Sıra: net TL azalan, eşitlikte anahtar (bayt sırası). */
  categories: ExpenseSummaryCategory[];
  totalTry: string;
  /** Ay başına net TL (`months` sırasıyla). */
  monthTotals: Array<{ month: string; amountTry: string }>;
  expenseCount: number;
  cancelCount: number;
  /** Asıl para birimine göre net TL (varyant havuzu); sıra TL azalan, eşitlikte kod. */
  currencies: Array<{ currency: string; totalTry: string }>;
}

interface SummaryRow {
  category: string | null;
  currency: string;
  month: string;
  amount: string;
  expenseCount: number;
  cancelCount: number;
}

/** Aralığı kapsayan fabrika ayları — iki uç `YYYY-MM` arası (uçlar dahil). */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Sıralama: net TL azalan, eşitlikte anahtar (yerel karşılaştırma YOK — belirlenimli bayt sırası). */
export function compareExpenseCategories(a: { key: string; totalTry: string }, b: { key: string; totalTry: string }): number {
  const byAmount = D(b.totalTry).comparedTo(D(a.totalTry));
  if (byAmount !== 0) return byAmount;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export async function getExpenseSummary(params: ExpenseSummaryParams): Promise<ExpenseSummary> {
  const { from, to } = params.range;
  const currencyFilter = params.currency && params.currency.length > 0
    ? Prisma.sql`AND ct.currency::text IN (${Prisma.join(params.currency)})`
    : Prisma.empty;
  // Kasa defterinin EXPENSE dalları (`cash-book.report.ts` 2 + 2b) — aynı evren, TL tutarla.
  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH mv AS (
      SELECT ct.category, ct.currency::text AS currency, ct."txnDate" AS dt, ct."amountTry" AS amt, 0 AS cancelled
        FROM cash_transactions ct
       WHERE ct.kind = 'EXPENSE' AND ct."paymentId" IS NULL
         AND COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL ${currencyFilter}
      UNION ALL
      SELECT ct.category, ct.currency::text, ct."cancelledAt", -ct."amountTry", 1
        FROM cash_transactions ct
       WHERE ct.kind = 'EXPENSE' AND ct."paymentId" IS NULL
         AND ct.status = 'CANCELLED' AND ct."cancelledAt" IS NOT NULL
         AND COALESCE(ct."cashBoxId", ct."bankAccountId") IS NOT NULL ${currencyFilter}
    )
    SELECT mv.category,
           mv.currency,
           to_char(${factoryMonthSql("mv.dt")}, 'YYYY-MM') AS month,
           SUM(mv.amt)::text AS amount,
           (COUNT(*) FILTER (WHERE mv.cancelled = 0))::int AS "expenseCount",
           (COUNT(*) FILTER (WHERE mv.cancelled = 1))::int AS "cancelCount"
      FROM mv
     WHERE mv.dt >= ${from} AND mv.dt <= ${to}
     GROUP BY 1, 2, 3
  `);

  const months = monthsBetween(factoryYmd(from).slice(0, 7), factoryYmd(to).slice(0, 7));

  const byKey = new Map<string, { key: string; label: string; cells: Map<string, { amt: Prisma.Decimal; e: number; c: number }> }>();
  const byCurrency = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? D0()).plus(D(r.amount)));
    const cat = cashCategoryKey(r.category);
    const entry = byKey.get(cat.key) ?? { ...cat, cells: new Map() };
    const cell = entry.cells.get(r.month) ?? { amt: D0(), e: 0, c: 0 };
    cell.amt = cell.amt.plus(D(r.amount));
    cell.e += r.expenseCount;
    cell.c += r.cancelCount;
    entry.cells.set(r.month, cell);
    byKey.set(cat.key, entry);
  }

  const monthSums = new Map(months.map((m) => [m, D0()]));
  let total = D0();
  let expenseCount = 0;
  let cancelCount = 0;
  const categories: ExpenseSummaryCategory[] = [...byKey.values()].map((c) => {
    let sum = D0();
    let e = 0;
    let k = 0;
    const cells: ExpenseSummaryCell[] = [];
    for (const m of months) {
      const cell = c.cells.get(m);
      if (!cell) continue;
      sum = sum.plus(cell.amt);
      e += cell.e;
      k += cell.c;
      monthSums.set(m, (monthSums.get(m) ?? D0()).plus(cell.amt));
      cells.push({ month: m, amountTry: cell.amt.toFixed(2), expenseCount: cell.e, cancelCount: cell.c });
    }
    total = total.plus(sum);
    expenseCount += e;
    cancelCount += k;
    return { key: c.key, label: c.label, totalTry: sum.toFixed(2), expenseCount: e, cancelCount: k, cells };
  });
  categories.sort(compareExpenseCategories);

  return {
    months,
    categories,
    totalTry: total.toFixed(2),
    monthTotals: months.map((m) => ({ month: m, amountTry: (monthSums.get(m) ?? D0()).toFixed(2) })),
    expenseCount,
    cancelCount,
    currencies: [...byCurrency.entries()]
      .map(([currency, amt]) => ({ currency, totalTry: amt.toFixed(2) }))
      .sort((a, b) => D(b.totalTry).comparedTo(D(a.totalTry)) || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0)),
  };
}

/** Kasa masraf formunun öneri listesi: en son kullanılan ilk 20 farklı kategori (katalog DEĞİL). */
export async function listRecentExpenseCategories(limit = 20): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ category: string }>>(Prisma.sql`
    SELECT btrim(ct.category) AS category
      FROM cash_transactions ct
     WHERE ct.kind = 'EXPENSE' AND ct.category IS NOT NULL AND btrim(ct.category) <> ''
     GROUP BY 1
     ORDER BY MAX(ct."createdAt") DESC, 1
     LIMIT ${limit}
  `);
  return rows.map((r) => r.category);
}

/**
 * Form öneri ucu: ayar KAPALI ise sorgu ATILMAZ ve boş liste döner (`enabled:false`).
 * Öneri kategori kataloğu değildir; kullanıcı yeni metni yine elle yazar (K18).
 */
export async function expenseCategorySuggestions(): Promise<{ enabled: boolean; categories: string[] }> {
  const mode = await readFinanceExpenseCategorySuggestions();
  if (mode === "OFF") return { enabled: false, categories: [] };
  return { enabled: true, categories: await listRecentExpenseCategories() };
}
