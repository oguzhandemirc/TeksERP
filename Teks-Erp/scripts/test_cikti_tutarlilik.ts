// =============================================================================
// Bekçi: ÇIKTI TUTARLILIĞI — ekran, Excel ve PDF aynı veriyi verir (Kumaş Stoğu tarafı, DB)
// Çalıştır: npx tsx scripts/test_cikti_tutarlilik.ts
// =============================================================================
// Kullanıcı kuralı (2026-11-23): ekran, Excel ve PDF HER ZAMAN aynı veriyi verir — aynı
// filtre/where, aynı satırlar, aynı toplamlar; yalnız sunuş farklı. Panel liste çıktısı
// satırları liste ucunun CURSOR yolundan (500'lük sayfa, `fetchAll`) çeker; ekran şeridi
// `/rolls/stats`, "Kumaş Stoğu Özeti" kalem kalem `/rolls/stats-groups`. Üçü aynı where'i
// (`buildRollWhere`) kullanmalı: aynı filtre setinde satır sayısı ve Σ metre birebir.
// Excel ↔ PDF hücre eşitliği (istemci motoru) `Electron/src/lib/export-consistency.test.tsx`te.
//
// §1 (DB'siz) sütun kapalı listesi: tanınmayan sütun 400 `UNKNOWN_EXPORT_COLUMN`, sıra normal.
// §2 üç filtre setinde cursor (export yolu) = stats = Σ gruplar = ayrımsız toplam.
// §3 kalem kalem grupların içeriği fikstürle birebir (ad, en, sayı, metre).
//
// Negatif sonda (commit mesajında): ① stats-groups where'ine fazladan koşul (status=STOCK)
// → §2 kırmızı · ② allowlist kontrolü kaldırıldı → §1 kırmızı; ikisi de geri alındı.
// =============================================================================
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { AppError } from "../src/utils/app-error";
import { resolveRollGroupColumns } from "../src/services/inventory/stats-groups";

const inv = new InventoryService();
const TAG = `TEST-CIKTI-${Date.now()}`;
const ids = { rolls: [] as string[], items: [] as string[], colors: [] as string[] };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const req = (query: Record<string, string>): Request => ({ query }) as unknown as Request;
const toQuery = (filters: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(filters).map(([k, v]) => [`filter[${k}]`, v]));
const sumQty = (xs: Array<{ currentQty: unknown }>) =>
  xs.reduce((a, r) => a.plus(new Prisma.Decimal(String(r.currentQty))), new Prisma.Decimal(0)).toNumber();

/** Panelin "Tümünü indir" yolu: cursor, 500'lük sayfa, sona kadar. */
async function exportRows(filters: Record<string, string>): Promise<Array<{ id: string; currentQty: unknown }>> {
  const out: Array<{ id: string; currentQty: unknown }> = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i++) {
    const q: Record<string, string> = { mode: "cursor", limit: "500", sortBy: "createdAt", sortOrder: "desc", ...toQuery(filters) };
    if (cursor) q.cursor = cursor;
    const res = (await inv.findAllRolls(req(q))) as unknown as {
      data: Array<{ id: string; currentQty: unknown }>;
      pagination: { nextCursor: string | null; hasMore: boolean };
    };
    out.push(...res.data);
    if (!res.pagination.hasMore) break;
    cursor = res.pagination.nextCursor;
  }
  return out;
}

function section1(): void {
  console.log("\n§1 Sütun kapalı listesi (fail-closed)");
  let err: unknown = null;
  try {
    resolveRollGroupColumns(["item", "salary"]);
  } catch (e) {
    err = e;
  }
  const ae = err instanceof AppError ? err : null;
  check("tanınmayan sütun → AppError 400", ae?.statusCode === 400, String(ae?.statusCode));
  check("details.code = UNKNOWN_EXPORT_COLUMN", ae?.details?.code === "UNKNOWN_EXPORT_COLUMN");
  check("details.unknown yalnız yabancıyı taşır", JSON.stringify(ae?.details?.unknown) === '["salary"]');
  check(
    "sıra kapalı listeninki, tekrar atılır",
    JSON.stringify(resolveRollGroupColumns(["width", "item", "width"])) === '["item","width"]',
  );
  check("boş liste geçerli (kategori toplamı)", resolveRollGroupColumns([]).length === 0);
}

async function main(): Promise<void> {
  section1();

  const mkItem = async (s: string) => {
    const i = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC" }, select: { id: true } });
    ids.items.push(i.id);
    return i.id;
  };
  const mkColor = async (s: string) => {
    const c = await prisma.color.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}` }, select: { id: true } });
    ids.colors.push(c.id);
    return c.id;
  };
  const mkRoll = async (o: { itemId: string; colorId?: string | null; qty: number; width?: number | null; status?: "WAREHOUSE" | "STOCK" }) => {
    const r = await prisma.roll.create({
      data: {
        itemId: o.itemId, initialQty: o.qty, currentQty: o.qty, status: o.status ?? "WAREHOUSE",
        entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${ids.rolls.length}`,
        colorId: o.colorId ?? null, width: o.width ?? null,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
  };

  const a = await mkItem("A");
  const b = await mkItem("B");
  const mavi = await mkColor("MAVI");
  await mkRoll({ itemId: a, colorId: mavi, qty: 100.5, width: 280 });
  await mkRoll({ itemId: a, colorId: mavi, qty: 50.25, width: 280 });
  await mkRoll({ itemId: a, colorId: mavi, qty: 70, width: 300 });
  await mkRoll({ itemId: a, colorId: null, qty: 12.125, width: null });
  await mkRoll({ itemId: b, colorId: mavi, qty: 33.3, width: 280, status: "STOCK" });
  await mkRoll({ itemId: b, colorId: null, qty: 40, width: 280, status: "STOCK" });

  console.log("\n§2 Üç filtre seti: cursor (export) = stats (ekran şeridi) = Σ gruplar");
  const sets: Array<{ ad: string; filters: Record<string, string>; count: number; qty: number }> = [
    { ad: "iki kumaş, tüm statüler", filters: { itemId: `${a},${b}`, status: "ALL" }, count: 6, qty: 306.175 },
    { ad: "A, depo", filters: { itemId: a, status: "WAREHOUSE" }, count: 4, qty: 232.875 },
    { ad: "renk süzgeci", filters: { itemId: `${a},${b}`, status: "ALL", colorId: mavi }, count: 4, qty: 254.05 },
  ];
  for (const s of sets) {
    const rows = await exportRows(s.filters);
    const stats = (await inv.getRollStats(req(toQuery(s.filters)))).data!;
    const grouped = (await inv.getRollStatsGroups([{ key: "k", filters: s.filters }], ["item", "color", "width"])).data![0]!;
    const total = (await inv.getRollStatsGroups([{ key: "k", filters: s.filters }], [])).data![0]!;
    const gCount = grouped.groups.reduce((x, g) => x + g.count, 0);
    const gQty = grouped.groups.reduce((x, g) => x.plus(g.qty), new Prisma.Decimal(0)).toNumber();
    check(`[${s.ad}] körlük zemini: fikstür sayısı`, rows.length === s.count, `${rows.length}/${s.count}`);
    check(`[${s.ad}] export satırı = şerit sayısı`, rows.length === stats.totalCount, `${rows.length}/${stats.totalCount}`);
    check(`[${s.ad}] export Σmetre = şerit metresi`, sumQty(rows) === stats.totalQty, `${sumQty(rows)}/${stats.totalQty}`);
    check(`[${s.ad}] Σ grup sayısı = şerit`, gCount === stats.totalCount && grouped.totalCount === stats.totalCount, `${gCount}/${grouped.totalCount}/${stats.totalCount}`);
    check(`[${s.ad}] Σ grup metresi = şerit`, gQty === stats.totalQty && grouped.totalQty === stats.totalQty, `${gQty}/${grouped.totalQty}/${stats.totalQty}`);
    check(`[${s.ad}] ayrımsız toplam = şerit`, total.totalCount === stats.totalCount && total.totalQty === stats.totalQty && total.groups.length === 0);
    check(`[${s.ad}] beklenen metre`, stats.totalQty === s.qty, `${stats.totalQty}/${s.qty}`);
  }

  console.log("\n§3 Kalem kalem içerik");
  const res = (await inv.getRollStatsGroups([{ key: "k", filters: { itemId: a, status: "WAREHOUSE" } }], ["width", "item", "color"])).data![0]!;
  const lines = res.groups.map((g) => `${g.values.item}|${g.values.color ?? "-"}|${g.values.width ?? "-"}|${g.count}|${g.qty}`);
  const expected = [
    `${TAG} A|${TAG} MAVI|280|2|150.75`,
    `${TAG} A|${TAG} MAVI|300|1|70`,
    `${TAG} A|-|-|1|12.125`,
  ];
  check("gruplar ad + en + sayı + metre ile birebir (sıra belirlenimli)", JSON.stringify(lines) === JSON.stringify(expected), JSON.stringify(lines));
  check("yalnız seçilen sütunlar döner", res.groups.every((g) => Object.keys(g.values).join(",") === "item,color,width"));

  let err: unknown = null;
  try {
    await inv.getRollStatsGroups([{ key: "k", filters: {} }], ["item", "unitPrice"]);
  } catch (e) {
    err = e;
  }
  check("servis ucu da tanınmayan sütunda 400", err instanceof AppError && err.statusCode === 400 && err.details?.code === "UNKNOWN_EXPORT_COLUMN");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.colors.length) await prisma.color.deleteMany({ where: { id: { in: ids.colors } } });
    if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
