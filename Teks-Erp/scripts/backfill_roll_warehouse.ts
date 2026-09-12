// =============================================================================
// GERİYE DOLDURMA — mevcut topların deposu (Roll.warehouseId)
// =============================================================================
//   npx tsx scripts/backfill_roll_warehouse.ts                                  → KURU ANLATIM (varsayılan)
//   npx tsx scripts/backfill_roll_warehouse.ts --apply --onay=<N> --hedef=<db>  → gerçekten yazar
//   [--dokum=<yol>]  etkilenen HER topun CSV dökümü (varsayılan scripts/out/…csv; kuru koşumda da yazılır)
//
// KAPI (2026-09-12, yönetici kararı): `--apply` iki teyit ister — `--onay=<N>` (N = kuru
// koşumdaki deposuz top sayısı, birebir) ve `--hedef=<db-adı>` (DATABASE_URL'den çözülen adla
// birebir; başlık her koşumda DB adı + host basar). Biri tutmazsa yazma YOK. "Etkilenen her
// kayıt listelenir" kuralı: konsolda depo × statü kırılımı + STOK KÜMESİNDEKİ topların TAMAMI;
// terminal statülü toplar (sevk edilmiş, tüketilmiş, iptal) konsolda özet, ama HEPSİ CSV
// dökümünde — "hangi topa hangi depo verildi" sorusu sonradan dosyadan cevaplanır.
//
// NEDEN GÜVENLİ (bu bir TAHMİN DEĞİL): çoklu depodan önce sistemde depo kavramı
// tek bir yerdi — fabrikanın TEK deposu. Dolayısıyla "bu top hangi depoydu"
// sorusunun geriye dönük cevabı %100 kesindir: varsayılan depo. Yanlış atıf
// yapma ihtimali yok.
//
// ⚠️ HAM SQL ile yazar, Prisma `update` ile DEĞİL: Prisma her update'te
// `updatedAt`i tazeler ve envanter sekmelerinin "Son İşlem" sıralaması tam o
// kolondan çözülür (kök CLAUDE.md "Buraya geliş ≠ oluşturma") → script sahadaki
// HER listeyi yeniden sıralardı. Emsal: backfill_roll_production_timestamps.ts
//
// ⚠️ DEPO DEFTERİNE (warehouse_movements) SATIR YAZMAZ: defter "bu güncellemeden
// SONRAKİ olaylar"dır; açılış durumu topun kendi satırındaki `warehouseId`'dir.
// Yüz binlerce anlamsız "başlangıç" satırı üretmenin faydası yok.
//
// İdempotent: yalnız `warehouseId IS NULL` satırlara dokunur, tekrar koşulabilir.
// =============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const DOKUM = (argv.find((a) => a.startsWith("--dokum=")) ?? "").split("=")[1] ?? "";
const BATCH = 500;

function dbHost(): string {
  try { const u = new URL(process.env.DATABASE_URL ?? ""); return `${u.hostname}:${u.port || "5432"}`; } catch { return "(okunamadı)"; }
}
function dokumYolu(db: string): string {
  if (DOKUM) return resolve(DOKUM);
  const damga = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return resolve(__dirname, "out", `backfill_roll_warehouse-${db}-${damga}.csv`);
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`=== Roll.warehouseId geriye doldurma — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU ANLATIM"} ===`);
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}\n`);

  const target = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true, code: true, name: true },
  });
  if (!target) {
    console.error(
      "❌ Varsayılan depo YOK. Önce backend'i bir kez ayağa kaldırın (boot uzlaştırması " +
        "`ensureDefaultWarehouse` onu yaratır) ya da Tanımlar → Depolar'dan açıp varsayılan yapın.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Hedef depo: ${target.name} (${target.code})\n`);

  const total = await prisma.roll.count({ where: { warehouseId: null } });
  const grand = await prisma.roll.count();
  console.log(`Deposuz top: ${total} / toplam ${grand}`);
  if (total === 0) {
    console.log("Yapacak iş yok.");
    return;
  }

  // Etkilenecek kayıtlar somut olarak listelenir (kök CLAUDE.md: "--apply öncesi
  // etkilenecek her kaydı somut listeler").
  const byStatus = await prisma.roll.groupBy({
    by: ["status"],
    where: { warehouseId: null },
    _count: { _all: true },
  });
  console.log("\nStatü kırılımı:");
  for (const r of [...byStatus].sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${r.status.padEnd(28)} ${r._count._all}`);
  }

  // ETKİLENEN HER KAYIT: konsolda stok kümesindekilerin TAMAMI (depoya dokunan
  // gerçek yük), terminal statülüler özetle; HEPSİ CSV dökümünde.
  const hepsi = await prisma.roll.findMany({
    where: { warehouseId: null },
    select: { id: true, barcode: true, status: true, currentQty: true, createdAt: true },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const stokta = hepsi.filter((r) => WAREHOUSE_STOCK_STATUSES.includes(r.status));
  const terminal = hepsi.length - stokta.length;
  console.log(`\nDepo × statü kırılımı (hedef ${target.code}): stok kümesinde ${stokta.length} top, terminal/üretim statülü ${terminal} top`);
  console.log(`\nSTOK KÜMESİNDEKİ TOPLARIN TAMAMI (${stokta.length}) — barkod · statü · metre · doğum:`);
  for (const r of stokta) {
    console.log(
      `  ${(r.barcode ?? r.id).padEnd(16)} ${r.status.padEnd(12)} ${String(r.currentQty).padStart(9)} m  ${r.createdAt.toISOString().slice(0, 10)}`,
    );
  }
  const yol = dokumYolu(db);
  mkdirSync(dirname(yol), { recursive: true });
  writeFileSync(
    yol,
    ["rollId;barcode;status;currentQty;createdAt;hedefDepo", ...hepsi.map((r) => [r.id, r.barcode ?? "", r.status, String(r.currentQty), r.createdAt.toISOString(), target.code].join(";"))].join("\n") + "\n",
    "utf8",
  );
  console.log(`\nDÖKÜM: ${hepsi.length} topun tamamı → ${yol}`);

  if (!APPLY) {
    console.log(`\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir):\n  npx tsx scripts/backfill_roll_warehouse.ts --apply --onay=${total} --hedef=${db}`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== total) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${total} top, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }

  console.log("\nYazılıyor…");
  let written = 0;
  for (;;) {
    // Ham SQL + LIMIT'li alt sorgu: `updatedAt` TAZELENMEZ.
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      WITH batch AS (
        SELECT id FROM rolls WHERE "warehouseId" IS NULL LIMIT ${BATCH}
      )
      UPDATE rolls r SET "warehouseId" = ${target.id}::uuid
      FROM batch b WHERE r.id = b.id
      RETURNING 1 AS n
    `;
    if (rows.length === 0) break;
    written += rows.length;
    console.log(`  ${written}/${total}`);
  }

  const left = await prisma.roll.count({ where: { warehouseId: null } });
  console.log(`\n✅ ${written} kayıt güncellendi. Kalan deposuz top: ${left}`);

  // ── İZ — HAM SQL İKİ KAT KÖRDÜR ─────────────────────────────────────────
  // Yukarıdaki `UPDATE` ne audit yazar ne `updatedAt`i tazeler (Prisma'nın
  // `@updatedAt`i uygulama katmanındadır, DB trigger'ı yok). Yani bu koşum
  // olmadan "bu satırlara ne oldu" sorusunun veri üzerinden CEVABI YOKTUR —
  // ne defterden ne damgadan. Tek satırlık bu kayıt, izin tek yoludur.
  // Best-effort ve yazmadan SONRA: audit düşerse onarım geri alınmaz, ama
  // sessiz de kalmaz (aşağıdaki uyarı + konsol dökümü ikinci iz).
  const izOnce = AuditService.getHealth().failureCount;
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "ROLL_WAREHOUSE_BACKFILL",
    tableName: "ROLL",
    payload: {
      source: "scripts/backfill_roll_warehouse.ts",
      veritabani: db,
      hedefDepo: { id: target.id, code: target.code, name: target.name },
      guncellenen: written,
      kalanDeposuz: left,
      kuruKosumdakiToplam: total,
      dokum: yol,
    },
  });
  if (AuditService.getHealth().failureCount !== izOnce) {
    console.error(
      "\n⚠️  AUDIT SATIRI YAZILAMADI — bu koşumun veri üzerinde başka izi YOK (ham SQL).\n" +
        `   Yukarıdaki dökümü (${yol}) ve bu çıktıyı onarımın tek izi olarak saklayın.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
