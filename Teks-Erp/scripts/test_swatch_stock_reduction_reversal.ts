// =============================================================================
// BEKÇİ — KARTELA STOK DÜŞÜMÜ GERİ ALINIR, SİLİNMEZ (defter doktrini, ①)
// Çalıştır: npx tsx scripts/run-all-tests.ts swatch_stock_reduction_reversal
// =============================================================================
// NEDEN: `SwatchStockReduction` tek yönlü defterdi — yanlış düşülen kartela
// geri gelmiyordu ve hangi kartelaların düşüldüğü yalnız audit yükündeydi.
//
// ÖLÇÜLENLER
//   §1 Düşüm kalemleri defterde (kalem sayısı = adet, kalem kümesi = iptal edilen küme)
//   §2 ⭐ Geri alma: kartelalar stoğa döner, düşüm satırı ve kalemleri DEĞİŞMEZ,
//      başlığa ters damga (tarih + aktör + gerekçe) yazılır
//   §3 İkinci geri alma 409, stok değişmez (atomik claim)
//   §4 Aynı kartela yeniden düşülebilir (kalem kartela başına tekil değil)
//   §5 ⭐ Kabulü iptal edilmiş kartelayı döndüren geri alma 409 + claim geri sarılır
//   §6 Kalemsiz (defter öncesi) düşüm 409 + claim geri sarılır
//   §7 Liste: geri alınabilirlik bayrağı ve engel gerekçesi
//   §8 Bilinmeyen id 404 · kısa gerekçe 400
//   §9 Kaynak: `src/`de düşüm defterini silen çağrı yok; geri alma tek yüklemi kullanır
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { kartelaService } from "../src/services/kartela.service";
import { AppError } from "../src/utils/app-error";
import { ensureTestKartela } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TS = Date.now().toString().slice(-7);
const rollIds: string[] = [];
let ADMIN = "";
let FIRM = "";
let ITEM = "";
let COLOR = "";

function errCode(e: unknown): { status?: number; code?: string } {
  if (!(e instanceof AppError)) return {};
  const details = e.details as { code?: string } | undefined;
  return { status: e.statusCode, code: details?.code };
}

async function stock(): Promise<number> {
  const res = await kartelaService.getStock({ itemId: ITEM, colorId: COLOR });
  return (res.data ?? []).find((g) => g.itemId === ITEM && g.colorId === COLOR)?.count ?? 0;
}

async function birthSwatches(count: number): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-SSR-${TS}-${rollIds.length}`,
      itemId: ITEM,
      colorId: COLOR,
      initialQty: 100,
      currentQty: 100,
      qualityGrade: "A1",
      width: 150,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await kartelaService.dispatch({ subcontractorId: FIRM, rollIds: [roll.id] }, ADMIN);
  const rec = await kartelaService.receive({ subcontractorId: FIRM, returns: [{ rollId: roll.id, count }] }, ADMIN);
  return (rec.data as { id: string }).id;
}

async function latestReductionId(): Promise<string> {
  const r = await prisma.swatchStockReduction.findFirstOrThrow({
    where: { itemId: ITEM },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return r.id;
}

async function main(): Promise<void> {
  console.log("\n=== Kartela stok düşümü: geri alınır, silinmez ===\n");
  ADMIN = (await ensureTestAdmin()).id;
  FIRM = (await ensureTestKartela()).id;
  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-SSR-ITEM-${TS}`, name: `TEST SSR Ürün ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  COLOR = (
    await prisma.color.create({
      data: { code: `TEST-SSR-C-${TS}`, name: `TEST SSR Renk ${TS}`, hex: "#123456" },
      select: { id: true },
    })
  ).id;

  const receiptA = await birthSwatches(5);
  check("hazırlık: 5 kartela stokta", (await stock()) === 5, String(await stock()));

  // §1
  await kartelaService.reduceStock({ itemId: ITEM, colorId: COLOR, count: 3, reason: "test zayiat" }, ADMIN);
  const red1 = await latestReductionId();
  const items1 = await prisma.swatchStockReductionItem.findMany({ where: { reductionId: red1 }, select: { swatchId: true } });
  const cancelled1 = await prisma.swatch.findMany({
    where: { itemId: ITEM, cancelledAt: { not: null } },
    select: { id: true },
  });
  const itemSet = new Set(items1.map((i) => i.swatchId));
  check("§1a Kalem sayısı = düşülen adet", items1.length === 3, String(items1.length));
  check(
    "§1b Kalem kümesi = iptal edilen kartela kümesi",
    cancelled1.length === 3 && cancelled1.every((c) => itemSet.has(c.id)),
    `iptal=${cancelled1.length}`,
  );
  check("§1c Stok 5 → 2", (await stock()) === 2, String(await stock()));

  // §2
  const before = await prisma.swatchStockReduction.findUniqueOrThrow({ where: { id: red1 } });
  const rev = await kartelaService.reverseStockReduction(red1, "yanlış düşüm", ADMIN);
  const after = await prisma.swatchStockReduction.findUniqueOrThrow({ where: { id: red1 } });
  const items1After = await prisma.swatchStockReductionItem.count({ where: { reductionId: red1 } });
  check("§2a Geri alma 3 kartela döndürdü", rev.data?.restored === 3, String(rev.data?.restored));
  check("§2b Stok 2 → 5", (await stock()) === 5, String(await stock()));
  check(
    "§2c Düşüm satırı DEĞİŞMEDİ (adet, gerekçe, tarih, aktör)",
    after.count === before.count &&
      after.reason === before.reason &&
      after.createdAt.getTime() === before.createdAt.getTime() &&
      after.createdById === before.createdById,
  );
  check(
    "§2d Ters damga yazıldı (tarih + aktör + gerekçe)",
    after.reversedAt != null && after.reversedById === ADMIN && after.reverseReason === "yanlış düşüm",
  );
  check("§2e Kalemler SİLİNMEDİ", items1After === 3, String(items1After));

  // §3
  let second: { status?: number; code?: string } = {};
  try {
    await kartelaService.reverseStockReduction(red1, "ikinci kez", ADMIN);
  } catch (e) {
    second = errCode(e);
  }
  check("§3a İkinci geri alma 409 REDUCTION_ALREADY_REVERSED", second.status === 409 && second.code === "REDUCTION_ALREADY_REVERSED", JSON.stringify(second));
  check("§3b Stok değişmedi", (await stock()) === 5, String(await stock()));
  const afterSecond = await prisma.swatchStockReduction.findUniqueOrThrow({ where: { id: red1 } });
  check("§3c İlk ters damga ezilmedi", afterSecond.reverseReason === "yanlış düşüm");

  // §4 — tek createMany'de doğan kartelaların createdAt'i eşit, FIFO sırası belirsiz:
  // hepsi düşülür ki geri alınmış üçü kesinlikle kümede olsun.
  await kartelaService.reduceStock({ itemId: ITEM, colorId: COLOR, count: 5, reason: "yeniden düşüm" }, ADMIN);
  const red2 = await latestReductionId();
  const items2 = await prisma.swatchStockReductionItem.findMany({ where: { reductionId: red2 }, select: { swatchId: true } });
  const overlap = items2.filter((i) => itemSet.has(i.swatchId)).length;
  check("§4 Geri alınmış kartela yeniden düşülebildi (kalemler kesişiyor)", red2 !== red1 && overlap === 3, `kesişim=${overlap}`);

  // §5 — kabulü iptal edilen kartela stoğa dönemez
  // red2 aktif ve kabulün beş kartelasını da tutuyor; kabul iptali onları atlar.
  await kartelaService.cancelReceipt(receiptA, "test kabul iptali", ADMIN);
  let blocked: { status?: number; code?: string } = {};
  try {
    await kartelaService.reverseStockReduction(red2, "kabul iptalinden sonra", ADMIN);
  } catch (e) {
    blocked = errCode(e);
  }
  const red2After = await prisma.swatchStockReduction.findUniqueOrThrow({ where: { id: red2 } });
  const revivedDead = await prisma.swatch.count({ where: { itemId: ITEM, cancelledAt: null } });
  check("§5a Kabulü iptal edilmiş kartelalı düşüm geri alınamaz → 409 REDUCTION_NOT_REVERSIBLE", blocked.status === 409 && blocked.code === "REDUCTION_NOT_REVERSIBLE", JSON.stringify(blocked));
  check("§5b Claim geri sarıldı (ters damga yok)", red2After.reversedAt === null);
  check("§5c Ölü kabulün kartelası dirilmedi", revivedDead === 0, String(revivedDead));

  // §6 — kalemsiz (defter öncesi) düşüm
  await birthSwatches(2);
  const legacy = await prisma.swatchStockReduction.create({
    data: { itemId: ITEM, colorId: COLOR, count: 1, reason: "defter öncesi", createdById: ADMIN },
    select: { id: true },
  });
  let legacyErr: { status?: number; code?: string } = {};
  try {
    await kartelaService.reverseStockReduction(legacy.id, "eski düşüm", ADMIN);
  } catch (e) {
    legacyErr = errCode(e);
  }
  const legacyAfter = await prisma.swatchStockReduction.findUniqueOrThrow({ where: { id: legacy.id } });
  check("§6a Kalemsiz düşüm 409 REDUCTION_WITHOUT_ITEMS", legacyErr.status === 409 && legacyErr.code === "REDUCTION_WITHOUT_ITEMS", JSON.stringify(legacyErr));
  check("§6b Claim geri sarıldı", legacyAfter.reversedAt === null);

  // §7 — liste
  await kartelaService.reduceStock({ itemId: ITEM, colorId: COLOR, count: 1, reason: "listede görünsün" }, ADMIN);
  const red3 = await latestReductionId();
  const list = await kartelaService.listStockReductions({ itemId: ITEM });
  const row = (id: string) => (list.data ?? []).find((r) => r.id === id);
  check("§7a Geri alınmış düşüm: reversible=false, künye dolu", row(red1)?.reversible === false && row(red1)?.reversedAt != null);
  check("§7b Kabulü ölü düşüm: reversible=false + engel gerekçesi", row(red2)?.reversible === false && (row(red2)?.blockingReasons.length ?? 0) === 5, JSON.stringify(row(red2)?.blockingReasons));
  check("§7c Sağlam düşüm: reversible=true, kart no listeli", row(red3)?.reversible === true && row(red3)?.cardNumbers.length === 1);

  // §8
  let notFound: { status?: number } = {};
  try {
    await kartelaService.reverseStockReduction("00000000-0000-4000-8000-000000000000", "yok böyle", ADMIN);
  } catch (e) {
    notFound = errCode(e);
  }
  check("§8a Bilinmeyen id → 404", notFound.status === 404, JSON.stringify(notFound));
  let shortReason: { status?: number } = {};
  try {
    await kartelaService.reverseStockReduction(red3, "x", ADMIN);
  } catch (e) {
    shortReason = errCode(e);
  }
  check("§8b Kısa gerekçe → 400", shortReason.status === 400, JSON.stringify(shortReason));

  // §9 — kaynak taraması
  const SRC = join(__dirname, "..", "src");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "generated") walk(full);
      } else if (full.endsWith(".ts")) files.push(full);
    }
  };
  walk(SRC);
  const deleters = files.filter((f) => /swatchStockReduction(Item)?\.delete(Many)?\(/.test(readFileSync(f, "utf8")));
  check("§9a `src/`de düşüm defterini silen çağrı YOK", deleters.length === 0, deleters.join(", "));
  const svc = readFileSync(join(SRC, "services", "kartela.service.ts"), "utf8");
  const restoreCalls = svc.match(/data:\s*\{\s*cancelledAt:\s*null/g) ?? [];
  check(
    "§9b Kartelayı dirilten TEK yazım var ve `RESTORABLE_REDUCED_SWATCH` yüklemini taşıyor",
    restoreCalls.length === 1 && /\.\.\.RESTORABLE_REDUCED_SWATCH\s*\}/.test(svc),
    `diriltme=${restoreCalls.length}`,
  );
}

async function cleanup(): Promise<void> {
  try {
    if (ITEM) {
      await prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: ITEM } } });
      await prisma.swatchStockReduction.deleteMany({ where: { itemId: ITEM } });
    }
    await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } });
    await prisma.kartelaReceipt.deleteMany({ where: { items: { some: { consumedRollId: { in: rollIds } } } } });
    await prisma.kartelaDispatch.deleteMany({ where: { items: { some: { rollId: { in: rollIds } } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (COLOR) await prisma.color.deleteMany({ where: { id: COLOR } });
    if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
  } catch (e) {
    console.warn("cleanup uyarı:", (e as Error).message);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
