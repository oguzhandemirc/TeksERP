// =============================================================================
// Test: Yük / Performans SMOKE — InventoryService.findAllRolls (cursor) +
//       query-parser MAX_OFFSET guard + EXPLAIN plan (Seq Scan yok / hızlı).
// Çalıştır: npx tsx scripts/test_performance.ts
// =============================================================================
// CLAUDE.md hedefi 100k+ satır; CI hızı için ~5000 satır kullanılır (yavaşsa
// PERF_ROWS'u 2000'e indir — notes). createMany ile TEST-PERF rolleri yaratılır,
// finally'de SİLİNİR (bloat bırakma).
//
// Doğrulananlar:
//   1. Cursor pagination: dönen satır ≤ limit + nextCursor/hasMore mantığı doğru
//      (ardışık sayfa çekiminde duplikasyon yok, sayfa zinciri tüm TEST-PERF
//      rollerini kapsar).
//   2. MAX_OFFSET guard: buildPagination skip>10000 → AppError 400.
//   3. EXPLAIN: rol-liste sorgusunun planı Seq Scan İÇERMEZ (index scan) VEYA
//      sorgu birkaç yüz ms altında tamamlanır (ölçüm fallback).
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { buildPagination } from "../src/utils/query-parser";
import { AppError } from "../src/utils/app-error";
import { RollStatus, RollEntrySource } from "@prisma/client";

const PERF_ROWS = 5000; // yavaşsa 2000'e indir (bkz. notes)
const PAGE_LIMIT = 200; // findAllRolls cursor mode üst sınırı

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** filter[itemId] ile SCOPE'lanmış cursor sayfası çeker. */
async function fetchPage(
  itemId: string,
  cursor: string | null,
  limit: number,
): Promise<{ data: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean }> {
  const req = {
    query: {
      mode: "cursor",
      limit: String(limit),
      "filter[itemId]": itemId,
      // status=ALL: createMany rollerinin tamamını (default STOCK filtresine
      // takılmadan) çek. Hepsi STOCK yaratılıyor ama scope'u itemId belirliyor.
      "filter[status]": "ALL",
      sortBy: "createdAt",
      sortOrder: "desc",
      ...(cursor ? { cursor } : {}),
    },
  } as unknown as Request;
  const res = (await inventory.findAllRolls(req)) as {
    data: Array<{ id: string }>;
    pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
  };
  return {
    data: res.data,
    nextCursor: res.pagination.nextCursor,
    hasMore: res.pagination.hasMore,
  };
}

async function main(): Promise<void> {
  console.log(`=== Performans SMOKE (${PERF_ROWS} TEST-PERF rol) ===\n`);

  // Ürün teste ÖZEL yaratılır (hardcoded UUID YOK). ÖNCEKİ HATA: `findFirst({isActive})`
  // mevcut bir SEED ürününü seçiyordu; o ürünün ÖNCEDEN var olan rolleri itemId-scope'lu
  // sayıma sızıyor → §1d dev DB'de 5000'den fazla görüp flaky kalıyordu (CI temiz DB'de
  // yeşil). Teste özel boş ürün = tam izolasyon; lokal + CI deterministik.
  const stamp = Date.now();
  const item = await prisma.item.create({
    data: { code: `TEST-PERF-ITEM-${stamp}`, name: `TEST PERF ÜRÜN ${stamp}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const grade = await prisma.qualityGrade.findUnique({
    where: { code: "1.KALITE" },
    select: { id: true },
  });

  // Benzersiz barcode: TEST-PERF-<index>-<ms zaman damgası>. itemId scope'u + teste
  // özel ürün sayesinde DB'deki diğer rollere karışmadan deterministik kontrol.
  const rows = Array.from({ length: PERF_ROWS }, (_, i) => ({
    barcode: `TEST-PERF-${i}-${stamp}`,
    itemId: item.id,
    colorId: null,
    initialQty: 50,
    currentQty: 50,
    status: RollStatus.STOCK,
    qualityGrade: "1.KALITE",
    qualityGradeId: grade?.id ?? null,
    entrySource: RollEntrySource.SUPPLIER_RECEIPT,
  }));

  try {
    const t0 = Date.now();
    // createMany ile toplu insert (CLAUDE.md DB perf kuralı #9). Chunk'la —
    // tek seferde 5000 satır parametre limitine güvenli kalsın.
    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const r = await prisma.roll.createMany({ data: rows.slice(i, i + CHUNK) });
      inserted += r.count;
    }
    check(
      `createMany ${PERF_ROWS} rol yarattı`,
      inserted === PERF_ROWS,
      `${inserted} satır, ${Date.now() - t0}ms`,
    );

    // -- (1) CURSOR PAGINATION --
    // İlk sayfa: dönen satır ≤ limit; daha çok veri var → hasMore=true + nextCursor dolu.
    const first = await fetchPage(item.id, null, PAGE_LIMIT);
    check("(1a) ilk sayfa satır ≤ limit", first.data.length <= PAGE_LIMIT, `${first.data.length}/${PAGE_LIMIT}`);
    check(
      "(1b) PERF_ROWS > limit → hasMore=true + nextCursor dolu",
      first.hasMore === true && first.nextCursor !== null,
      `hasMore=${first.hasMore}`,
    );

    // Tüm sayfaları gez: zincir TEST-PERF rollerinin tamamını duplikasyonsuz kapsar.
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let dup = false;
    do {
      const page = await fetchPage(item.id, cursor, PAGE_LIMIT);
      pages++;
      for (const r of page.data) {
        if (seen.has(r.id)) dup = true;
        seen.add(r.id);
      }
      cursor = page.hasMore ? page.nextCursor : null;
      if (pages > PERF_ROWS) break; // sonsuz döngü guard
    } while (cursor !== null);

    check("(1c) sayfa zincirinde duplikasyon yok", !dup);
    check(
      "(1d) cursor zinciri tüm rolleri kapsar",
      seen.size === PERF_ROWS,
      `${seen.size}/${PERF_ROWS} (${pages} sayfa)`,
    );

    // Son sayfa: hasMore=false + nextCursor=null mantığı.
    let last = await fetchPage(item.id, null, PAGE_LIMIT);
    let guard = 0;
    while (last.hasMore && last.nextCursor && guard++ < PERF_ROWS) {
      last = await fetchPage(item.id, last.nextCursor, PAGE_LIMIT);
    }
    check(
      "(1e) son sayfa hasMore=false + nextCursor=null",
      last.hasMore === false && last.nextCursor === null,
    );

    // -- (2) MAX_OFFSET guard (query-parser) --
    // MAX_OFFSET=10000 → skip>10000 ile çağrı AppError 400 fırlatmalı.
    // skip = (page-1)*pageSize. page=300, pageSize=50 → skip=14950 (>10000).
    let threw = false;
    let isBadRequest = false;
    try {
      buildPagination(300, 50);
    } catch (e) {
      threw = true;
      isBadRequest = e instanceof AppError && e.statusCode === 400;
    }
    check("(2a) skip>10000 → hata fırlattı", threw);
    check("(2b) hata AppError 400 (badRequest)", isBadRequest);
    // Sınır altı (skip ≤ 10000) hata fırlatmamalı — guard sadece aşımda.
    let okUnder = true;
    try {
      buildPagination(200, 50); // skip=9950 ≤ 10000
    } catch {
      okUnder = false;
    }
    check("(2c) skip≤10000 hata YOK (guard sadece aşımda)", okUnder);

    // -- (3) EXPLAIN: rol-liste sorgusu --
    // findAllRolls default STOCK filtresi + createdAt desc sıralamasının planı.
    // [status, createdAt] composite index mevcut → Seq Scan beklenmiyor.
    // Tutamadığı ortamda (planner küçük tabloda seq scan seçebilir) FALLBACK:
    // sorgunun birkaç yüz ms altında tamamlandığını ölç.
    const explainSql =
      `EXPLAIN SELECT id FROM rolls WHERE status = 'STOCK' ` +
      `AND "qualityGrade" <> 'FIRE' ORDER BY "createdAt" DESC LIMIT 50`;
    const planRows = (await prisma.$queryRawUnsafe(explainSql)) as Array<
      Record<string, string>
    >;
    const plan = planRows.map((r) => Object.values(r)[0]).join("\n");
    const hasSeqScan = /Seq Scan/i.test(plan);

    const m0 = Date.now();
    await prisma.roll.findMany({
      where: { status: RollStatus.STOCK, qualityGrade: { not: "FIRE" } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const elapsed = Date.now() - m0;
    const fastEnough = elapsed < 300;

    check(
      "(3) rol-liste planı Seq Scan İÇERMEZ VEYA sorgu <300ms",
      !hasSeqScan || fastEnough,
      `seqScan=${hasSeqScan} elapsed=${elapsed}ms`,
    );
    if (hasSeqScan) {
      console.log(
        `   ↳ NOT: planda Seq Scan var (küçük/CI tablosunda planner seçimi olabilir) — süre fallback'i geçti.`,
      );
    }
  } finally {
    const del = await prisma.roll.deleteMany({
      where: { barcode: { startsWith: `TEST-PERF-` } },
    });
    // Teste özel ürünü de sil (önce rolleri, sonra ürün — FK guard).
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    console.log(`\nCleanup: ${del.count} TEST-PERF rol + test ürünü silindi.`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  // Hata yolunda da temizlik dene (best-effort). Önce rolleri, sonra teste özel
  // ürün(ler)i — kod prefix'iyle (item id scope dışı). Önceki çökmelerden kalan
  // TEST-PERF-ITEM ürünlerini de toplar.
  await prisma.roll
    .deleteMany({ where: { barcode: { startsWith: `TEST-PERF-` } } })
    .catch(() => {});
  await prisma.item
    .deleteMany({ where: { code: { startsWith: `TEST-PERF-ITEM-` } } })
    .catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
