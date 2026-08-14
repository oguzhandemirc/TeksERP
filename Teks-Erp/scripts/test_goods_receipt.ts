// =============================================================================
// BEKÇİ — MAL KABUL: satın alınan malın depo girişi
// =============================================================================
// Çalıştırma: npx tsx scripts/test_goods_receipt.ts
//
// NEDEN: Mal Kabul, alım-satım kurulumunun TEK giriş kapısıdır — buradan doğan
// top yanlış damgalanırsa (yanlış depo, yanlış kaynak, fişsiz) envanterin
// tamamı yanlış başlar ve hata hiçbir yerde görünmez.
//
// ÖLÇÜLENLER:
//   A) Fiş + satırlar: top WAREHOUSE + PURCHASE_RECEIPT + FİŞİN deposu + fiş bağı
//   B) Defterde ENTRY satırı (mal dışarıdan geldi) — fiş bağıyla
//   C) İdempotency: aynı clientToken ile ikinci çağrı YENİ fiş açmaz
//   D) Parçalı sonuç: hatalı satır `failed[]`e düşer, SAĞLAM satır KALIR
//      (10 top girildi deyip 2'sini yutmak en kötü davranış)
//   E) Pasif depoya mal kabul REDDEDİLİR
//   F) İptal: toplar CANCELLED + fiş CANCELLED
//   G) ⭐ İŞLEM GÖRMÜŞ top varsa fiş iptal EDİLEMEZ — "mal hiç girmedi" storno
//      semantiği defteri yalanlayamaz
//   H) ⭐ TEK KAYNAK ASSEMBLER (Sınıf 5, 2026-08-14): karma fişte (kumaş+iplik)
//      ÜÇ yüzey — detay `totals` · liste `_count` · donmuş belge snapshot'ı —
//      AYNI rakamı söyler; kumaş-only fişin snapshot'ına `yarnLines` anahtarı
//      TEK BAYT bile yazılmaz (eski snapshot/belge parmak izi korunur).
//      NEGATİF SONDA: `fresh` builder'daki `yarnIn.length > 0` koşulu
//      kaldırılıp `yarnLines: []` koşulsuz yazılırsa B6 kırmızı; builder
//      assembler yerine tabloyu kendi okumaya dönüp iplik süzgecini
//      unutursa H5/H6 kırmızı verir.
//   I) ⭐ YARIŞ (Sınıf 4, I1 — 2026-08-14): addLines ‖ cancel. Pencere ELLE
//      AÇIK TUTULAN tx ile deterministik kurulur (kök CLAUDE.md yarış bekçisi
//      kuralı). İki yön: (a) iptal uçuşta → addLines fiş kilidinde BEKLER,
//      iptal commit'lenince İKİ satır tipi de 409 ile failed[] ve CANCELLED
//      fişe satır doğmaz; (b) satır claim'i öndeyken → cancel BEKLER ve tx-içi
//      TAZE okuma uçuştaki topu görüp iptal eder ("satır sayımı doğru").
//
// NEGATİF SONDALAR (§I — 2026-08-14, ikisi de koşuldu, kırmızı GÖRÜLDÜ, dosya
// sha256 ile birebir geri yüklendi):
//   • `claimActiveReceiptTx` gövdesi körleştirildi (erken return) → exit 1,
//     I1a/I1b/I1c kırmızı — I1c detayı asıl hatayı basıyor: CANCELLED fişe
//     top=1 iplik=1 CANLI satır doğdu. ⚠️ I1a (bekleme ölçümü) yalnız pozitif
//     yönde anlamlıdır; deterministik kırmızı I1b/I1c'dir.
//   • cancel'ın softDelete döngüsü `freshRolls` yerine bayat tx-dışı `rolls`
//     kümesine döndürüldü → exit 1, I2b/I2c kırmızı (cancelledRolls=1,
//     uçuştaki top WAREHOUSE kaldı — yarım iptal).
// =============================================================================
import { GoodsReceiptStatus, RollEntrySource, RollStatus, WarehouseEventType, YarnMovementKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

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

const TAG = `TEST-GR-${Date.now()}`;
const receiptIds: string[] = [];
const warehouseIds: string[] = [];
/** §H fixture'ı — testin KENDİ yarattığı YARN kalemi (ortam verisine bağımlılık YASAK). */
let yarnItemId: string | null = null;

/** §I yarış sondaları — pencereyi ELLE AÇIK TUTULAN tx ile kurmak için
 *  (kök CLAUDE.md yarış bekçisi kuralı: serbest Promise.allSettled yarışı
 *  pencereyi bazen ıskalar ve sahte-yeşil kalır). */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("=== Mal kabul bekçisi ===\n");

  const def = await ensureDefaultWarehouse();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} Depo` }, select: { id: true } });
  warehouseIds.push(wh.id);

  // ── A + B) Fiş + satır + defter ─────────────────────────────────────────
  const res = await goodsReceiptService.create({
    warehouseId: wh.id,
    deliveryNoteNo: "IRS-12345",
    lines: [
      { itemId: item.id, initialQty: 100 },
      { itemId: item.id, initialQty: 60 },
    ],
  });
  const detail = res.data as { id: string; receiptNo: string; rolls: Array<{ id: string; status: string }>; totals: { rollCount: number; totalQty: number } };
  receiptIds.push(detail.id);

  check("A1) Fiş MK ön ekiyle doğdu", detail.receiptNo.startsWith("MK"), detail.receiptNo);
  check("A2) İki top girildi", detail.rolls.length === 2, `top=${detail.rolls.length}`);
  check("A3) Toplam metraj 160", detail.totals.totalQty === 160, `toplam=${detail.totals.totalQty}`);

  const rollRows = await prisma.roll.findMany({
    where: { goodsReceiptId: detail.id },
    select: { id: true, status: true, entrySource: true, warehouseId: true, barcode: true, entryStationId: true },
  });
  check("A4) Toplar WAREHOUSE statüsünde", rollRows.every((r) => r.status === RollStatus.WAREHOUSE));
  check("A5) entrySource = PURCHASE_RECEIPT", rollRows.every((r) => r.entrySource === RollEntrySource.PURCHASE_RECEIPT));
  check("A6) ⭐ Toplar FİŞİN deposunda (varsayılana sapmadı)", rollRows.every((r) => r.warehouseId === wh.id), `varsayılan=${def.id}`);
  check("A7) Barkod üretildi", rollRows.every((r) => Boolean(r.barcode)));
  check("A8) Giriş istasyonu NULL (mal kabul üretim noktası değil)", rollRows.every((r) => r.entryStationId === null));

  const ledger = await prisma.warehouseMovement.findMany({
    where: { rollId: { in: rollRows.map((r) => r.id) } },
    select: { eventType: true, toWarehouseId: true, goodsReceiptId: true },
  });
  check("B1) Her top için ENTRY satırı", ledger.length === 2 && ledger.every((l) => l.eventType === WarehouseEventType.ENTRY));
  check("B2) Defter satırı fişin deposunu ve fişi taşıyor", ledger.every((l) => l.toWarehouseId === wh.id && l.goodsReceiptId === detail.id));

  // ── B3-B5) Fiş belgesi: LAZY-INIT (açılışta DEĞİL, ilk baskıda donar) ────
  const beforePrint = await prisma.printedDocument.count({ where: { docType: "GOODS_RECEIPT", sourceId: detail.id } });
  check(
    "B3) ⭐ Fiş açılışında belge DONMADI (fiş bir KAPTIR — satır sonradan eklenir)",
    beforePrint === 0,
    `belge=${beforePrint}`,
  );
  const grHtml = (await printedDocumentService.getHtml("GOODS_RECEIPT" as never, detail.id)).data?.html ?? "";
  check("B4) İlk baskıda belge üretildi ve tedarikçi irsaliyesini yazıyor", grHtml.includes("MAL KABUL") && grHtml.includes("IRS-12345"), `uzunluk=${grHtml.length}`);
  const afterPrint = await prisma.printedDocument.count({ where: { docType: "GOODS_RECEIPT", sourceId: detail.id } });
  check("B5) Baskı belgeyi dondurdu (lazy-init)", afterPrint === 1, `belge=${afterPrint}`);

  // ── B6-B7) ⭐ KUMAŞ-ONLY SNAPSHOT PARMAK İZİ (Sınıf 5 bayt-parite kuralı) ──
  // `yarnLines` YALNIZ doluysa yazılır: kumaş-only fişin snapshot'ı eski
  // builder'ın ürettiği ÜÇ anahtarı (header · lines · notes) birebir taşımalı.
  // Boş dizi bile yazılsa eski belgelerin parmak izi bozulur (sackNote emsali).
  const frozenPlain = await prisma.printedDocument.findFirst({
    where: { docType: "GOODS_RECEIPT", sourceId: detail.id },
    select: { snapshot: true },
  });
  const plainDoc = (frozenPlain?.snapshot as { doc?: Record<string, unknown> } | null)?.doc ?? {};
  check(
    "B6) ⭐ Kumaş-only snapshot'ta yarnLines anahtarı YOK (anahtar kümesi birebir eski)",
    !("yarnLines" in plainDoc) && Object.keys(plainDoc).sort().join(",") === "header,lines,notes",
    Object.keys(plainDoc).sort().join(","),
  );
  check("B7) Kumaş-only HTML'de iplik tablosu başlığı YOK", !grHtml.includes("KABUL EDİLEN İPLİK"));

  // ── C) İdempotency ──────────────────────────────────────────────────────
  const token = randomUUID();
  const first = await goodsReceiptService.create({ warehouseId: wh.id, clientToken: token, lines: [{ itemId: item.id, initialQty: 5 }] });
  const firstId = (first.data as { id: string }).id;
  receiptIds.push(firstId);
  const second = await goodsReceiptService.create({ warehouseId: wh.id, clientToken: token, lines: [{ itemId: item.id, initialQty: 5 }] });
  const secondId = (second.data as { id: string }).id;
  const receiptCount = await prisma.goodsReceipt.count({ where: { clientToken: token } });
  check("C1) Aynı clientToken ikinci fiş AÇMADI", receiptCount === 1 && secondId === firstId, `fiş=${receiptCount}`);
  const tokenRolls = await prisma.roll.count({ where: { goodsReceiptId: firstId } });
  check("C2) Satırlar da tekrarlanmadı", tokenRolls === 1, `top=${tokenRolls}`);

  // ── D) Parçalı sonuç ────────────────────────────────────────────────────
  const partial = await goodsReceiptService.create({
    warehouseId: wh.id,
    lines: [
      { itemId: item.id, initialQty: 30 },
      { itemId: "00000000-0000-4000-8000-000000000000", initialQty: 20 }, // var olmayan ürün
    ],
  });
  const partialData = partial.data as { id: string; rolls: unknown[]; failed: Array<{ index: number; reason: string }> };
  receiptIds.push(partialData.id);
  check("D1) Sağlam satır KALDI", partialData.rolls.length === 1, `top=${partialData.rolls.length}`);
  check("D2) ⭐ Hatalı satır SEBEBİYLE döndü (yutulmadı)", partialData.failed?.length === 1 && Boolean(partialData.failed[0]?.reason), partialData.failed?.[0]?.reason?.slice(0, 60));

  // ── E) Pasif depo reddedilir ────────────────────────────────────────────
  const passive = await prisma.warehouse.create({ data: { code: `${TAG}-P`, name: `${TAG} Pasif`, isActive: false }, select: { id: true } });
  warehouseIds.push(passive.id);
  let passiveMsg = "";
  try {
    const bad = await goodsReceiptService.create({ warehouseId: passive.id });
    receiptIds.push((bad.data as { id: string }).id);
  } catch (e) {
    passiveMsg = (e as Error).message;
  }
  check("E) Pasif depoya mal kabul reddedildi", passiveMsg.includes("pasif"), passiveMsg.slice(0, 60));

  // ── F) İptal ────────────────────────────────────────────────────────────
  const cancelRes = await goodsReceiptService.cancel(detail.id, "TEST — bekçi iptali");
  const afterCancel = await prisma.goodsReceipt.findUnique({ where: { id: detail.id }, select: { status: true } });
  const cancelledRolls = await prisma.roll.count({ where: { goodsReceiptId: detail.id, status: RollStatus.CANCELLED } });
  check("F1) Fiş CANCELLED", afterCancel?.status === GoodsReceiptStatus.CANCELLED);
  check("F2) Fişin topları da iptal edildi", cancelledRolls === 2, `iptal=${cancelledRolls}`);
  check("F3) İptal sonucu sayı döndürüyor", (cancelRes.data as { cancelledRolls: number }).cancelledRolls === 2);

  // ── G) ⭐ İşlem görmüş top varsa iptal engellenir ────────────────────────
  const guarded = await goodsReceiptService.create({ warehouseId: wh.id, lines: [{ itemId: item.id, initialQty: 44 }] });
  const guardedData = guarded.data as { id: string; rolls: Array<{ id: string }> };
  receiptIds.push(guardedData.id);
  // Topu "işlem görmüş" say: üretime çek.
  await prisma.roll.update({ where: { id: guardedData.rolls[0]!.id }, data: { status: RollStatus.IN_PRODUCTION } });
  let guardMsg = "";
  try {
    await goodsReceiptService.cancel(guardedData.id, "olmamalı");
  } catch (e) {
    guardMsg = (e as Error).message;
  }
  check("G1) ⭐ İşlem görmüş toplu fiş iptal EDİLEMEDİ", guardMsg.includes("işlem görmüş"), guardMsg.slice(0, 80));
  const stillActive = await prisma.goodsReceipt.findUnique({ where: { id: guardedData.id }, select: { status: true } });
  check("G2) Guard yan etki bırakmadı (fiş hâlâ ACTIVE)", stillActive?.status === GoodsReceiptStatus.ACTIVE);

  // ── H) ⭐ TEK KAYNAK ASSEMBLER — üç yüzey aynı rakamı söyler ─────────────
  const yarnItem = await prisma.item.create({
    data: { code: `${TAG}-YRN`, name: `${TAG} İplik`, itemType: "YARN", unit: "KG" },
    select: { id: true, name: true },
  });
  yarnItemId = yarnItem.id;

  const mixed = await goodsReceiptService.create({
    warehouseId: wh.id,
    deliveryNoteNo: `${TAG}-KARMA`,
    lines: [
      { itemId: item.id, initialQty: 80 },
      { itemId: item.id, initialQty: 40 },
      { itemId: yarnItem.id, initialQty: 500 },
    ],
  });
  const mixedData = mixed.data as {
    id: string;
    receiptNo: string;
    totals: { rollCount: number; totalQty: number; yarnLineCount: number; totalYarnKg: number };
  };
  receiptIds.push(mixedData.id);

  // H1 — DETAY yüzeyi (loadDetail → assembler totals)
  check(
    "H1) Karma fiş detayı: 2 top / 120 m + 1 iplik / 500 kg",
    mixedData.totals.rollCount === 2 &&
      mixedData.totals.totalQty === 120 &&
      mixedData.totals.yarnLineCount === 1 &&
      mixedData.totals.totalYarnKg === 500,
    JSON.stringify(mixedData.totals),
  );

  // H2 — assembler union sözleşmesi: önce kumaş, sonra iplik; kind ayracı doğru
  const asm = await goodsReceiptService.assembleReceiptLines(mixedData.id);
  check(
    "H2) Assembler union: FABRIC×2 önde, YARN×1 sonda",
    asm.lines.length === 3 &&
      asm.lines[0]?.kind === "FABRIC" &&
      asm.lines[1]?.kind === "FABRIC" &&
      asm.lines[2]?.kind === "YARN",
    asm.lines.map((l) => l.kind).join(","),
  );

  // H3 — LİSTE yüzeyi (`_count` — bilinçli ucuz yol; ham satır sayısı)
  const listed = await goodsReceiptService.list({ page: 1, pageSize: 5, filters: {}, search: mixedData.receiptNo });
  const listRow = (listed.rows as Array<{ id: string; _count: { rolls: number; yarnMovements: number } }>).find(
    (r) => r.id === mixedData.id,
  );
  check(
    "H3) Liste sayaçları: _count.rolls=2 + _count.yarnMovements=1",
    listRow?._count.rolls === 2 && listRow?._count.yarnMovements === 1,
    JSON.stringify(listRow?._count),
  );

  // H4 — BELGE yüzeyi (donmuş snapshot: kumaş tablosu + yarnLines)
  const mixedHtml = (await printedDocumentService.getHtml("GOODS_RECEIPT" as never, mixedData.id)).data?.html ?? "";
  check("H4a) Karma fiş belgesi render edildi", mixedHtml.length > 0 && mixedHtml.includes("MAL KABUL"));
  // ⚠️ Bu kontrol renderer dikişi (2026-08-14) tamamlanınca eklendi: H4b
  // snapshot'ı ölçüyordu ama KÂĞIDI ölçmüyordu — yarnLines snapshot'ta durup
  // renderer basmasaydı bekçi yeşil kalırdı ("listede var ama basılamıyor"
  // sınıfı, test_workorder_documents dersi). B7 negatif tarafı zaten kilitliyor
  // (kumaş-only HTML'de başlık YOK).
  check(
    "H4a2) ⭐ Karma fiş KÂĞIDINDA iplik tablosu basılı (başlık + kalem adı + kg)",
    mixedHtml.includes("KABUL EDİLEN İPLİK") && mixedHtml.includes(yarnItem.name) && /\b500\b/.test(mixedHtml),
  );
  const frozenMixed = await prisma.printedDocument.findFirst({
    where: { docType: "GOODS_RECEIPT", sourceId: mixedData.id },
    select: { snapshot: true },
  });
  const mixedDoc = (frozenMixed?.snapshot as {
    doc?: { lines?: unknown[]; yarnLines?: Array<{ itemName: string; qtyKg: number }> };
  } | null)?.doc;
  check(
    "H4b) ⭐ Snapshot'ta yarnLines VAR: 1 satır, 500 kg, doğru kalem adı",
    mixedDoc?.yarnLines?.length === 1 &&
      mixedDoc.yarnLines[0]?.qtyKg === 500 &&
      mixedDoc.yarnLines[0]?.itemName === yarnItem.name,
    JSON.stringify(mixedDoc?.yarnLines),
  );

  // H5 — ÜÇ YÜZEY AYNI RAKAM (assembler'dan sapan yüzey burada kırmızı verir)
  check(
    "H5) ⭐ Detay = Liste = Belge (top adedi ve iplik)",
    mixedData.totals.rollCount === listRow?._count.rolls &&
      listRow._count.rolls === mixedDoc?.lines?.length &&
      mixedData.totals.yarnLineCount === listRow._count.yarnMovements &&
      mixedData.totals.totalYarnKg === mixedDoc.yarnLines?.[0]?.qtyKg,
  );

  // H6 — iptal sonrası defter görünümü: hareket SİLİNMEZ, net düşer
  await goodsReceiptService.cancel(mixedData.id, "TEST — assembler iptal");
  const afterCancelDetail = (await goodsReceiptService.loadDetail(mixedData.id)) as {
    totals: { rollCount: number; totalYarnKg: number; yarnLineCount: number };
  };
  check(
    "H6) İptal sonrası: rollCount=0, yarnLineCount=2 (IN + ters kayıt), net kg=0",
    afterCancelDetail.totals.rollCount === 0 &&
      afterCancelDetail.totals.yarnLineCount === 2 &&
      afterCancelDetail.totals.totalYarnKg === 0,
    JSON.stringify(afterCancelDetail.totals),
  );
  const reversal = await prisma.yarnMovement.findFirst({
    where: { goodsReceiptId: mixedData.id, kind: YarnMovementKind.ADJUST_OUT },
    select: { unitPrice: true },
  });
  check("H7) Ters iplik kaydı fiyat TAŞIMIYOR (geri sarım ticari olay değil)", reversal !== null && reversal.unitPrice === null);

  // ── §I ⭐ YARIŞ (Sınıf 4, I1): addLines ‖ cancel ──────────────────────────
  // addLines fiş statüsünü tx DIŞINDA okuyordu ve satırlar ayrı tx'lerde
  // doğuyordu → iptal o pencereye sızarsa CANCELLED fişe CANLI top/iplik
  // yazılıyordu (hata yok, log yok). Sed: her satır tx'inin İLK işi fiş-claim
  // (`updateMany WHERE status=ACTIVE`) + cancel'ın tx-İÇİ TAZE top okuması.
  // Pencere ELLE AÇIK TUTULAN tx ile deterministik kurulur; "bekledi"
  // ölçümleri yalnız pozitif yönde anlamlıdır, deterministik kırmızılar
  // SONUÇ kontrolleridir (I1b/I1c/I2b/I2c).
  {
    // (a) İPTAL UÇUŞTA → addLines fiş kilidinde BEKLER ve kaybeder.
    const rI = await goodsReceiptService.create({ warehouseId: wh.id });
    const ridI = (rI.data as { id: string }).id;
    receiptIds.push(ridI);

    const lockI = deferred();
    const gateI = deferred();
    const txI = prisma.$transaction(
      async (tx) => {
        // "İptal uçuşta": cancel claim'inin yaptığı gibi fiş satırı kilitlenir
        // ve CANCELLED yazılır ama COMMIT EDİLMEZ. Sıradan UPDATE = FOR NO KEY
        // UPDATE — satır tx'inin claim'ini bloklar, ama claim'siz (bozuk) bir
        // roll-insert'in FK KEY SHARE'i GEÇEBİLİR: negatif sonda tam bu yüzden
        // canlı satır doğurur (kök CLAUDE.md yarış bekçisi kilit notu).
        await tx.$executeRaw`UPDATE "goods_receipts" SET "status" = 'CANCELLED', "cancelledAt" = now() WHERE "id" = ${ridI}::uuid`;
        lockI.resolve();
        await gateI.promise;
      },
      { timeout: 20_000 },
    );
    // Gate-tx promise'i await'ten önce reddedebilir — no-op catch olmadan
    // unhandled rejection süreci Sonuç satırı basılmadan öldürür (kök CLAUDE.md ②).
    txI.catch(() => {});
    await lockI.promise;

    type LinesOut = { created: string[]; createdYarn: string[]; failed: Array<{ reason: string }> };
    let linesSettled = false;
    const linesP = goodsReceiptService
      .addLines(ridI, [
        { itemId: item.id, initialQty: 33 },
        { itemId: yarnItem.id, initialQty: 250 },
      ])
      .then(
        (r) => ({ res: r as unknown as LinesOut, err: "" }),
        (e: Error) => ({ res: null as LinesOut | null, err: e.message }),
      )
      .finally(() => {
        linesSettled = true;
      });
    await sleep(400);
    check("I1a) addLines uçuştaki iptalin fiş kilidinde bekledi", !linesSettled);
    gateI.resolve();
    await txI;
    const linesOut = await linesP;
    check(
      "I1b) ⭐ İptal kazandı → İKİ satır da (kumaş+iplik) 409 sebebiyle failed[]",
      linesOut.err === "" &&
        linesOut.res !== null &&
        linesOut.res.created.length === 0 &&
        linesOut.res.createdYarn.length === 0 &&
        linesOut.res.failed.length === 2 &&
        linesOut.res.failed.every((f) => f.reason.includes("iptal edilmiş")),
      linesOut.err || JSON.stringify(linesOut.res?.failed.map((f) => f.reason.slice(0, 40))),
    );
    const liveAfterI = await prisma.roll.count({
      where: { goodsReceiptId: ridI, status: { not: RollStatus.CANCELLED } },
    });
    const yarnAfterI = await prisma.yarnMovement.count({ where: { goodsReceiptId: ridI } });
    check(
      "I1c) ⭐ CANCELLED fişe canlı satır DOĞMADI (top=0, iplik hareketi=0)",
      liveAfterI === 0 && yarnAfterI === 0,
      `top=${liveAfterI} iplik=${yarnAfterI}`,
    );

    // (b) SATIR UÇUŞTA → cancel satır claim'inde BEKLER ve TAZE kümeyi görür.
    const rJ = await goodsReceiptService.create({
      warehouseId: wh.id,
      lines: [{ itemId: item.id, initialQty: 20 }],
    });
    const ridJ = (rJ.data as { id: string }).id;
    receiptIds.push(ridJ);

    const lockJ = deferred();
    const gateJ = deferred();
    const inflight = { rollId: "" };
    const txJ = prisma.$transaction(
      async (tx) => {
        // Satır tx'inin birebir emülasyonu: fiş-claim + top doğumu, COMMIT YOK.
        // Gerçek addLines çağrısı pencereyi kapatmadan tutulamaz — §10 emsali
        // ("yarışın sonucunu kurmanın tek yolu satırı el ile yazmaktır").
        const c = await tx.goodsReceipt.updateMany({
          where: { id: ridJ, status: GoodsReceiptStatus.ACTIVE },
          data: { updatedAt: new Date() },
        });
        if (c.count === 0) throw new Error("beklenmedik: fiş ACTIVE değil");
        const r = await tx.roll.create({
          data: {
            barcode: `${TAG}-INFLIGHT`,
            itemId: item.id,
            initialQty: 25,
            currentQty: 25,
            status: RollStatus.WAREHOUSE,
            entrySource: RollEntrySource.PURCHASE_RECEIPT,
            goodsReceiptId: ridJ,
            warehouseId: wh.id,
          },
          select: { id: true },
        });
        inflight.rollId = r.id;
        lockJ.resolve();
        await gateJ.promise;
      },
      { timeout: 20_000 },
    );
    txJ.catch(() => {});
    await lockJ.promise;

    let cancelSettled = false;
    const cancelP = goodsReceiptService
      .cancel(ridJ, "TEST — yarış ters yön")
      .then(
        (r) => ({ res: r.data as { cancelledRolls: number }, err: "" }),
        (e: Error) => ({ res: null as { cancelledRolls: number } | null, err: e.message }),
      )
      .finally(() => {
        cancelSettled = true;
      });
    await sleep(500);
    check("I2a) cancel uçuştaki satır claim'inde bekledi (hızlı yol geçti, claim kilitte)", !cancelSettled);
    gateJ.resolve();
    await txJ;
    const cancelOut = await cancelP;
    check(
      "I2b) ⭐ Satır kazandı → iptal TAZE kümeyi gördü, uçuştaki top da sayıldı (cancelledRolls=2)",
      cancelOut.err === "" && cancelOut.res?.cancelledRolls === 2,
      cancelOut.err.slice(0, 80) || `cancelledRolls=${cancelOut.res?.cancelledRolls}`,
    );
    const inflightRow = await prisma.roll.findUnique({
      where: { id: inflight.rollId },
      select: { status: true },
    });
    check("I2c) ⭐ Uçuştaki top DB'de CANCELLED (bayat snapshot'la atlanmadı)", inflightRow?.status === RollStatus.CANCELLED, `status=${inflightRow?.status}`);
  }

  check("Körlük zemini: en az 5 fiş üretildi", receiptIds.length >= 5, `${receiptIds.length} fiş`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      const rolls = await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } });
      const ids = rolls.map((r) => r.id);
      if (ids.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.roll.deleteMany({ where: { id: { in: ids } } });
      }
      if (receiptIds.length) {
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
        await prisma.yarnMovement.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      }
      if (yarnItemId) {
        await prisma.yarnStock.deleteMany({ where: { itemId: yarnItemId } });
        await prisma.yarnMovement.deleteMany({ where: { itemId: yarnItemId } });
        await prisma.item.deleteMany({ where: { id: yarnItemId } });
      }
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 200));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
