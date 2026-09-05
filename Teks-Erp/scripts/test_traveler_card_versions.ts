// =============================================================================
// BEKÇİ: Refakat kartı VERSİYON GEÇMİŞİ (2026-08-17)
// Çalıştır: npx tsx scripts/test_traveler_card_versions.ts
// =============================================================================
// Saha isteği: "kartın eski versiyonunu da görebilelim". Kart tek satırdır
// (`workOrderId @unique`) ve `snapshot` ÜZERİNE yazılır — yani basılan her sürüm
// bir öncekini siliyordu. Çözüm YENİ TABLO DEĞİL: `printed_documents` defteri
// (sevk kâğıtlarının yaşadığı yer) yeniden kullanıldı, sourceId = kart id'si.
//
// Bu bekçi beş şeyi kilitler:
//   1. Baskı, o sürümü deftere ARŞİVLER.
//   2. Aynı içeriğin ikinci kopyası YENİ SATIR DOĞURMAZ (upsert) — düz `create`
//      olsaydı @@unique'e çarpar ve BASKI YOLUNU DÜŞÜRÜRDÜ.
//   3. İçerik değişip sürüm artınca eski satır SUPERSEDED'e düşer, ama SİLİNMEZ.
//   4. `?version=N` o günkü İÇERİĞİ basar (güncel planı değil).
//   5. Generic belge yolları (freeze/reissue/lazy-init) bu tipe KAPALI — ikinci
//      bir sürüm üretici, kâğıda basılan numara ile kayıtlı numarayı ayrıştırır.
//
// ⚠️ 5. madde neden test ediliyor: `printedDocumentService` domain bilmez ve
// docType'a bakmadan çalışır. Biri ileride TRAVELER_CARD için builder kaydederse
// `reissue` sessizce v+1 satır yazar, kart satırındaki sürüm ise yerinde kalır —
// ve o andan sonra kâğıttaki "Rev.3" ile defterdeki "Rev.4" farklı belgelerdir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import {
  ItemType,
  ItemUnit,
  PrintedDocStatus,
  PrintedDocType,
  StationType,
  WorkOrderStatus,
} from "@prisma/client";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { printedDocumentService } from "../src/services/printed-document.service";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const SUFFIX = `TCV${Date.now().toString().slice(-8)}`;
const cardService = new TravelerCardService();
const cleanup: { woIds: string[]; itemId?: string; stationId?: string; cardIds: string[] } = {
  woIds: [],
  cardIds: [],
};

/** Defterdeki satırları okur (sürüm sırasıyla). */
async function ledger(cardId: string) {
  return prisma.printedDocument.findMany({
    where: { docType: PrintedDocType.TRAVELER_CARD, sourceId: cardId },
    orderBy: { version: "asc" },
    select: { version: true, status: true, documentNo: true, snapshot: true },
  });
}

async function setup(): Promise<{ woId: string; cardId: string }> {
  const item = await prisma.item.create({
    data: {
      code: `TEST-ITM-${SUFFIX}`,
      // ⚠️ AD DA BENZERSİZ: `test_consistency` §18 aktif master-data'da mükerrer
      // ad arar — sabit ad, her koşumda başka bir bekçiyi kırmızıya düşürürdü.
      name: `Test Kumaş ${SUFFIX}`,
      unit: ItemUnit.MT,
      itemType: ItemType.FABRIC,
    },
    select: { id: true },
  });
  cleanup.itemId = item.id;

  const station = await prisma.station.create({
    data: { code: `TEST-ST-${SUFFIX}`, name: `Test İstasyon ${SUFFIX}`, type: StationType.INTERNAL },
    select: { id: true },
  });
  cleanup.stationId = station.id;

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE${SUFFIX}`,
      status: WorkOrderStatus.PLANNED,
      targetItemId: item.id,
      width: 140,
      steps: { create: [{ stepSequence: 1, stationId: station.id }] },
    },
    select: { id: true },
  });
  cleanup.woIds.push(wo.id);

  await prisma.$transaction((tx) => cardService.createForWorkOrder(tx, wo.id));
  const card = await prisma.travelerCard.findUnique({
    where: { workOrderId: wo.id },
    select: { id: true },
  });
  if (!card) throw new Error("kart doğmadı — fixture bozuk");
  cleanup.cardIds.push(card.id);
  return { woId: wo.id, cardId: card.id };
}

// ── 1) İlk baskı deftere yazar ──────────────────────────────────────────────
async function testFirstPrint(cardId: string): Promise<void> {
  console.log("\n── 1) İlk baskı arşivlenir ──");
  const before = await ledger(cardId);
  check("baskıdan önce defter BOŞ", before.length === 0, `${before.length} satır`);

  await cardService.recordPrintEvent(cardId);
  const rows = await ledger(cardId);
  check("baskı tek satır yazdı", rows.length === 1, `${rows.length} satır`);
  check("satır ACTIVE", rows[0]?.status === PrintedDocStatus.ACTIVE, String(rows[0]?.status));

  const card = await prisma.travelerCard.findUnique({
    where: { id: cardId },
    select: { version: true, cardNumber: true },
  });
  check(
    "defter sürümü = KART sürümü",
    rows[0]?.version === card?.version,
    `defter v${rows[0]?.version} · kart v${card?.version}`,
  );
  check("belge no = kart no", rows[0]?.documentNo === card?.cardNumber, rows[0]?.documentNo);
}

// ── 2) Aynı içeriğin ikinci kopyası ─────────────────────────────────────────
// EN KRİTİK BÖLÜM: "aynı içeriğin ikinci kopyası revizyon değildir" kuralı gereği
// sürüm ARTMAZ. Düz `create` burada @@unique(docType,sourceId,version)'a çarpar ve
// baskı olayı 500 verirdi — hem de operatör elinde kâğıt tutarken.
async function testIdempotentReprint(cardId: string): Promise<void> {
  console.log("\n── 2) Aynı içerik ikinci kez basılır ──");
  let err = "";
  try {
    await cardService.recordPrintEvent(cardId);
  } catch (e) {
    err = (e as Error).message;
  }
  check("ikinci kopya HATA VERMEZ", err === "", err);

  const rows = await ledger(cardId);
  check("defter hâlâ TEK satır (upsert)", rows.length === 1, `${rows.length} satır`);
  check("sürüm artmadı", rows[0]?.version === 1, `v${rows[0]?.version}`);
}

// ── 3) İçerik değişti → yeni sürüm, eskisi SUPERSEDED ───────────────────────
async function testRevision(woId: string, cardId: string): Promise<void> {
  console.log("\n── 3) Revizyon ──");
  await prisma.workOrder.update({ where: { id: woId }, data: { width: 155 } });
  await cardService.recordPrintEvent(cardId);

  const rows = await ledger(cardId);
  check("defterde İKİ sürüm var", rows.length === 2, `${rows.length} satır`);
  check(
    "eski sürüm SUPERSEDED (silinmedi)",
    rows[0]?.status === PrintedDocStatus.SUPERSEDED,
    String(rows[0]?.status),
  );
  check("yeni sürüm ACTIVE", rows[1]?.status === PrintedDocStatus.ACTIVE, String(rows[1]?.status));

  const card = await prisma.travelerCard.findUnique({
    where: { id: cardId },
    select: { version: true },
  });
  check("kart sürümü defterin ACTIVE'iyle aynı", card?.version === rows[1]?.version, `v${card?.version}`);

  // Arşivlenen İÇERİK gerçekten o günkü mü? (snapshot ezilirse burası düşer)
  const v1 = rows[0]?.snapshot as Record<string, unknown> | null;
  const v2 = rows[1]?.snapshot as Record<string, unknown> | null;
  check("v1 snapshot'ı ESKİ eni taşır", Number(v1?.width) === 140, String(v1?.width));
  check("v2 snapshot'ı YENİ eni taşır", Number(v2?.width) === 155, String(v2?.width));
}

// ── 4) ?version=N eski kopyayı basar ────────────────────────────────────────
async function testHistoricalRender(cardId: string): Promise<void> {
  console.log("\n── 4) Eski sürümün HTML'i ──");
  const current = await cardService.getCardHtml(cardId);
  check("parametresiz çağrı GÜNCEL planı basar", current.includes("155 cm"), "varsayılan davranış korunur");

  const old = await cardService.getCardHtml(cardId, { version: 1 });
  check("?version=1 O GÜNKÜ içeriği basar", old.includes("140 cm"), "donmuş kopya");
  check("eski kopyada güncel değer YOK", !old.includes("155 cm"));
  check("kâğıttaki sürüm numarası v1", old.includes("v1 ·"), "kimlik doğru");

  // Bilinmeyen sürüm sessizce güncele DÜŞMEMELİ: operatöre baktığını sandığından
  // başka bir belge vermek, hiç belge vermemekten kötüdür.
  let notFound = "";
  try {
    await cardService.getCardHtml(cardId, { version: 99 });
  } catch (e) {
    notFound = (e as Error).message;
  }
  check("olmayan sürüm 404 verir", notFound.includes("v99"), notFound);

  // GET yan etkisiz: eski sürümü görüntülemek deftere satır EKLEMEZ.
  const rows = await ledger(cardId);
  check("görüntüleme defteri BÜYÜTMEZ", rows.length === 2, `${rows.length} satır`);
}

// ── 5) Generic belge yolları bu tipe KAPALI ─────────────────────────────────
async function testSelfManagedGuard(cardId: string): Promise<void> {
  console.log("\n── 5) Generic yollar kapalı ──");

  let reissueErr = "";
  try {
    await printedDocumentService.reissue(PrintedDocType.TRAVELER_CARD, cardId, "sonda", undefined);
  } catch (e) {
    reissueErr = (e as Error).message;
  }
  check("reissue REDDEDİLİR", reissueErr.includes("bu uçtan üretilmez"), reissueErr);

  let currentErr = "";
  try {
    // Defterde satır VAR → getCurrent builder'a hiç gitmez ve okuma çalışır.
    const res = await printedDocumentService.getCurrent(PrintedDocType.TRAVELER_CARD, cardId);
    check("getCurrent mevcut satırı okuyabilir", Boolean(res.data), "okuma yolu açık");
  } catch (e) {
    currentErr = (e as Error).message;
    check("getCurrent mevcut satırı okuyabilir", false, currentErr);
  }

  // Kaydı olmayan bir kaynakta ise lazy-init denenir ve orada durdurulmalı.
  let lazyErr = "";
  try {
    await printedDocumentService.getCurrent(
      PrintedDocType.TRAVELER_CARD,
      "00000000-0000-0000-0000-000000000000",
    );
  } catch (e) {
    lazyErr = (e as Error).message;
  }
  check("kayıtsız kaynakta lazy-init REDDEDİLİR", lazyErr.includes("bu uçtan üretilmez"), lazyErr);

  // Versiyon listesi domain bilmez — geçmiş buradan okunur, AÇIK kalmalı.
  const versions = (await printedDocumentService.listVersions(PrintedDocType.TRAVELER_CARD, cardId))
    .data as unknown[];
  check("listVersions AÇIK (geçmiş buradan okunur)", versions.length === 2, `${versions.length} sürüm`);
}

// ── 6) YARIŞ: sürüm artırımı ATOMİK CLAIM ile korunur ───────────────────────
// Eskiden `recordPrintEvent`/`reprint` sürümü "oku → +1 → yaz" ile artırıyordu.
// İki eşzamanlı baskı AYNI numarayı hesaplar, arşiv `upsert`'i (tek
// `[docType,sourceId,version]` satırı) ikisini TEK kopyaya çökertir ve birincinin
// içeriği sessizce kaybolurdu.
//
// Pencere `Promise.allSettled` ile YAKALANMAZ (ES-17) — sonda pencereyi ELLE
// açık tutulan bir tx ile kurar: kart satırı `FOR NO KEY UPDATE` ile kilitlenir
// (ES-18: `FOR UPDATE` FK'nın KEY SHARE kilidini de bloklar), sürüm sonda tx'i
// içinde artırılır, sonra commit edilir. Baskı olayının claim'i o anda taze
// WHERE'i görür ve count=0 → 409 verir.
async function testVersionRace(woId: string, cardId: string): Promise<void> {
  console.log("\n── 6) Eşzamanlı sürüm artırımı (atomik claim) ──");
  // Plan REVİZYON olsun ki sürüm gerçekten artsın (aynı içerik sürüm artırmaz).
  await prisma.workOrder.update({ where: { id: woId }, data: { width: 170 } });
  const before = await prisma.travelerCard.findUnique({
    where: { id: cardId },
    select: { version: true },
  });
  const baseVersion = before?.version ?? 0;

  const gate = await pool.connect();
  let err = "";
  try {
    await gate.query("BEGIN");
    await gate.query("SELECT id FROM traveler_cards WHERE id = $1 FOR NO KEY UPDATE", [cardId]);
    // Rakip baskı: kart bu sırada bir sürüm ilerledi.
    await gate.query("UPDATE traveler_cards SET version = version + 1 WHERE id = $1", [cardId]);

    // Baskı olayı BAŞLAR: planı (v+1) tx dışında kurar, sonra claim'de bloklanır.
    // ⚠️ no-op `.catch` (ES-19): erken red sahipsiz rejection olur ve süreç
    // "Sonuç" satırı basılmadan ölürdü — en sessiz kırmızı.
    const printing = cardService.recordPrintEvent(cardId);
    printing.catch(() => {});
    // Planın tx dışı okuması bitsin, claim kilide dayansın.
    await new Promise((r) => setTimeout(r, 400));
    await gate.query("COMMIT");

    try {
      await printing;
    } catch (e) {
      err = (e as Error).message;
    }
  } finally {
    await gate.query("ROLLBACK").catch(() => {});
    gate.release();
  }

  check("rakip sürüm artışında baskı olayı 409 verir", err.length > 0, err || "hata YOK (claim delik)");
  check("409 mesajı sebebi söylüyor", /bu sırada değişti/.test(err), err);

  const rows = await ledger(cardId);
  const raceVersion = baseVersion + 1;
  check(
    "kaybeden baskı deftere BAYAT sürüm yazmadı",
    !rows.some((r) => r.version === raceVersion),
    `defter: ${rows.map((r) => "v" + r.version).join(", ")}`,
  );
  const after = await prisma.travelerCard.findUnique({
    where: { id: cardId },
    select: { version: true },
  });
  check(
    "kart sürümü YALNIZ rakibin artışını taşır (çift artış yok)",
    after?.version === raceVersion,
    `v${after?.version} (beklenen v${raceVersion})`,
  );
}

async function main(): Promise<void> {
  console.log("=== Refakat kartı versiyon geçmişi bekçisi ===");
  let ctx: { woId: string; cardId: string } | null = null;
  try {
    ctx = await setup();
    await testFirstPrint(ctx.cardId);
    await testIdempotentReprint(ctx.cardId);
    await testRevision(ctx.woId, ctx.cardId);
    await testHistoricalRender(ctx.cardId);
    await testSelfManagedGuard(ctx.cardId);
    await testVersionRace(ctx.woId, ctx.cardId);
  } catch (err) {
    fail++;
    console.error("Beklenmeyen hata:", err);
  } finally {
    if (cleanup.cardIds.length) {
      await prisma.printedDocument
        .deleteMany({
          where: { docType: PrintedDocType.TRAVELER_CARD, sourceId: { in: cleanup.cardIds } },
        })
        .catch(() => {});
    }
    await prisma.travelerCardScan
      .deleteMany({ where: { card: { workOrderId: { in: cleanup.woIds } } } })
      .catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: cleanup.woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: cleanup.woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: cleanup.woIds } } }).catch(() => {});
    if (cleanup.stationId) {
      await prisma.station.deleteMany({ where: { id: cleanup.stationId } }).catch(() => {});
    }
    if (cleanup.itemId) await prisma.item.deleteMany({ where: { id: cleanup.itemId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
