// =============================================================================
// KASA HAREKETLERİ KATEGORİ SÜZGECİ bekçisi (D4-KUC e / H1c)
// =============================================================================
// §1 ⭐ anahtar Masraf Özeti kovasıyla AYNI: trim birleştirir, harf katlanmaz; liste = toplam (tek where)
// §2 ⭐ Kategorisiz kova: null + "" + yalnız boşluk; arama ile birlikte (OR ezilmez)
// §3 virgüllü kategori bölünmez
// §4 ⭐ eşlik: özet satırının expenseCount'u = o anahtarla süzülü EXPENSE listesinin toplamı
// §5 fail-closed: önek yok / tekrarlı parametre → 400 CASH_CATEGORY_FILTER_INVALID
// §6 seçenek ucu: fikstür anahtarları tekil (trim'li kova tek seçenek)
// Eski (trim'siz) kategori metni fikstürde kolona doğrudan yazılır. Fikstür 2016 aylarında, kategoriler `TEST-KKS-<pid>` damgalı.
// NEGATİF SONDA (2026-10-30): helper'da `btrim(ct.category) = …` → `ct.category = …` yapıldı → §1a/§1d/§1e/§2a/§2b/§4 ❌ (11/6);
// servisteki `where.AND = [...]` satırı silindi → §1–§5 12 ❌ (5/12); ikisi de geri alındı → yeşil.
// =============================================================================
import prisma from "../src/lib/prisma";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { cashCategoryKey, getExpenseSummary } from "../src/services/helpers/expense-summary.helper";
import { listCashCategoryOptions, readCategoryParam } from "../src/services/helpers/cash-category-filter.helper";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { factoryDayStartOfKey } from "../src/constants/time";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-KKS-${process.pid}`;
const RENT = `Kira ${TAG}`;
const MEAL = `Yemek, içecek ${TAG}`;
const boxIds: string[] = [];
const isMine = (label: string): boolean => label.toLowerCase().includes(TAG.toLowerCase());
const day = (ymd: string): Date => new Date(factoryDayStartOfKey(ymd).getTime() + 12 * 3_600_000);

/** Yazım yolu trim'ler ("" → null); ESKİ veri ham metin taşıyabilir — o hâl kolona doğrudan yazılır. */
async function expense(boxId: string, amount: number, ymd: string, category: string | null, legacyRaw?: string): Promise<void> {
  const r = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: boxId, amount, txnDate: day(ymd), category });
  if (legacyRaw !== undefined) await prisma.cashTransaction.update({ where: { id: r.data!.id }, data: { category: legacyRaw } });
}

async function list(boxId: string, extra: Record<string, unknown>): Promise<{ n: number; total: number; cats: Array<string | null> }> {
  const r = await cashTransactionService.list({ cashBoxId: boxId, pageSize: 200, ...extra });
  return { n: r.data.length, total: r.pagination.total, cats: r.data.map((d) => d.category) };
}

async function badRequestCode(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e instanceof AppError && e.statusCode === 400 ? String(e.details?.code) : `beklenmeyen: ${String(e)}`;
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB", false, engel); return; }

  const box = await prisma.cashBox.create({ data: { code: `${TAG}-K`, name: `${TAG} kasa`, currency: "TRY" }, select: { id: true } });
  boxIds.push(box.id);
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 100000, txnDate: day("2016-01-02") });
  await expense(box.id, 100, "2016-02-10", RENT, ` ${RENT} `);
  await expense(box.id, 100, "2016-02-11", RENT);
  await expense(box.id, 100, "2016-02-12", RENT.toLowerCase()); // harf katlanmaz → ayrı kova
  await expense(box.id, 50, "2016-02-13", null);
  await expense(box.id, 50, "2016-02-14", null, "");
  await expense(box.id, 50, "2016-02-15", null, "   ");
  await expense(box.id, 70, "2016-02-16", MEAL);
  await cashTransactionService.create({ kind: "INCOME", cashBoxId: box.id, amount: 500, txnDate: day("2016-02-17"), category: RENT });

  console.log("\n── §1 anahtar = özet kovası ──");
  const rentKey = cashCategoryKey(RENT).key;
  const rent = await list(box.id, { category: rentKey });
  check("§1a ⭐ trim'li ve trim'siz aynı kova + gelir (kind süzgeçsiz): 3 satır", rent.total === 3, `total=${rent.total}`);
  check("§1b harf katlanmaz: küçük harfli metin girmez", !rent.cats.includes(RENT.toLowerCase()));
  check("§1c liste = toplam (tek where)", rent.n === rent.total, `n=${rent.n}`);
  const onePage = await cashTransactionService.list({ cashBoxId: box.id, category: rentKey, pageSize: 1 });
  check("§1d sayfa 1 satır, toplam yine 3", onePage.data.length === 1 && onePage.pagination.total === 3);
  const rentExpense = await list(box.id, { category: rentKey, kind: "EXPENSE" });
  check("§1e diğer süzgeçlerle VE'lenir (EXPENSE → 2)", rentExpense.total === 2, `total=${rentExpense.total}`);

  console.log("\n── §2 Kategorisiz ──");
  const unc = await list(box.id, { category: cashCategoryKey(null).key, kind: "EXPENSE" });
  check("§2a ⭐ null + boş + boşluk: 3 satır", unc.total === 3, `total=${unc.total}`);
  const withSearch = await list(box.id, { category: rentKey, search: "kira" });
  check("§2b arama + kategori birlikte: arama OR'u ezilmez (3)", withSearch.total === 3, `total=${withSearch.total}`);

  console.log("\n── §3 virgül ──");
  const meal = await list(box.id, { category: cashCategoryKey(MEAL).key });
  check("§3 virgüllü kategori bölünmez: 1 satır", meal.total === 1, `total=${meal.total}`);

  console.log("\n── §4 özet ↔ liste eşliği ──");
  const window = resolveCoreDayRange({ from: "2016-02-01", to: "2016-02-29", kiyas: "none" }, 90);
  const s = await getExpenseSummary({ range: window.range });
  const mine = s.categories.filter((c) => isMine(c.label));
  check("§4a körlük zemini: fikstür özette 3 kova (Kira, kira, Yemek)", mine.length === 3, mine.map((c) => c.label).join(" | "));
  for (const c of mine) {
    const l = await list(box.id, { category: c.key, kind: "EXPENSE", from: window.range.from, to: window.range.to });
    check(`§4 ⭐ "${c.label}": özet ${c.expenseCount} = liste ${l.total}`, c.expenseCount === l.total);
  }

  console.log("\n── §5 fail-closed ──");
  check("§5a öneksiz anahtar → 400", (await badRequestCode(() => cashTransactionService.list({ category: RENT }))) === "CASH_CATEGORY_FILTER_INVALID");
  check("§5b trim'siz anahtar (kova dışı biçim) → 400",
    (await badRequestCode(() => cashTransactionService.list({ category: `${cashCategoryKey(null).key} x ` }))) === "CASH_CATEGORY_FILTER_INVALID");
  check("§5c tekrarlı parametre → 400", (await badRequestCode(() => readCategoryParam([rentKey, rentKey]))) === "CASH_CATEGORY_FILTER_INVALID");
  check("§5d boş parametre süzmez", readCategoryParam("") === undefined && readCategoryParam(undefined) === undefined);

  console.log("\n── §6 seçenekler ──");
  const opts = (await listCashCategoryOptions()).filter((o) => isMine(o.label));
  check("§6 trim'li kova tek seçenek: 3 seçenek, anahtarlar tekil", opts.length === 3 && new Set(opts.map((o) => o.key)).size === 3,
    opts.map((o) => o.label).join(" | "));
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    try {
      if (boxIds.length > 0) {
        await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: boxIds } } });
        await prisma.cashBox.deleteMany({ where: { id: { in: boxIds } } });
      }
    } catch (e) {
      console.error("TEMİZLİK HATASI:", e);
      fail++;
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect().catch(() => {});
    process.exitCode = fail > 0 ? 1 : 0;
  });
