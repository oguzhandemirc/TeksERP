// =============================================================================
// BEKÇİ — TAM STOK SAYIMI (sayım listesi + fark fişi + donmuş belge)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_stock_count.ts
//
// NEDEN: Bu özelliğin yapabileceği hatalar SESSİZ ve YIKICIDIR:
//   • İşaretsiz satırı "eksik" sayarsa, yarım bırakılmış bir sayımın
//     tamamlanması DEPONUN TAMAMINI kayıttan düşürür — hata yok, log yok,
//     yalnız envanterde olmayan mal.
//   • Fotoğraf ile tamamlama arasında sevk edilmiş bir topu körlemesine iptal
//     ederse, MÜŞTERİYE GİTMİŞ mal canlı veriden silinir.
//   • Fark fişini FİRE olarak yazarsa fire oranı sistematik olarak şişer
//     (sayım kaybı "mal vardı, çöpe gitti" değildir).
//   • Belgeyi tx dışında dondurursa "fark uygulandı ama kâğıdı yok" satırları
//     doğar ve bunu ancak biri basmaya çalışınca fark ederiz.
//
// ÖLÇÜLENLER:
//   §1 ⭐ FOTOĞRAF: depodaki toplar + sıfır olmayan iplik bakiyeleri satır oldu;
//      BAŞKA deponun topu ve ÖLÜ statülü top GİRMEDİ
//   §2 Aynı depoda ikinci DRAFT sayım → 409
//   §3 Satır işaretleme yalnız DRAFT'ta; toplu "bulundu" AÇIK "eksik"i EZMEZ
//   §4 ⭐ TAMAMLAMA: `found=false` top CANCELLED + sapma RECORD_CORRECTION/
//      SAYIM_FARKI + açık hareket `qtyOut = 0` (STORNO — istasyon iş hacmine
//      hayalet metraj yazılmaz) + `preCancelStatus` + depo defterinde CANCEL
//   §5 ⭐ İŞARETSİZ satır TOPA DOKUNMADI ve belgede "sayılmadı" olarak GÖRÜNÜR
//   §6 ⭐ İPLİK FARKI: ADJUST_OUT + `stockCountId` bağı + bakiye doğru; farksız
//      ve sayılmamış kalem hareket DOĞURMAZ
//   §7 ⭐ SEVK EDİLMİŞ TOP KENARI: satır fotoğraftayken top sevk edildi →
//      tamamlama onu İPTAL ETMEZ, "kapsam dışı" olarak SEBEBİYLE işaretler
//   §8 ⭐ BELGE tamamlanmada DONDU (v1 ACTIVE, snapshot fark özetini taşıyor);
//      iptal edilen (DRAFT) sayımda belge HİÇ doğmaz
//   §9 ⭐ CLAIM: iki PARALEL tamamlama → TEK fark fişi (tek belge, tek iptal,
//      tek sapma satırı)
//   §10 MEKANİK HİZA: DOC_CONFIG_KEYS (var + BENZERSİZ) · DOC_PERMISSIONS
//      (read ⊇ write) · builder + renderHtml kayıtlı · örnek veri · rota
//      kapıları (rejim + izin) kaynak taramasıyla
//   §11 ⭐ İŞARETLEME ↔ TAMAMLAMA YARIŞI: rakip tx sayımı claim etmişken
//      (COMMIT YOK) işaretleme BLOKLANIR — ilişki filtresi kilit DEĞİLDİR
//   §12 ⭐ ALIŞ SİPARİŞİ ROLLUP'I: sayımda düşülen mal-kabul topu karşılanmadan
//      düşer (CLOSED → OPEN); rapor "tamamı geldi" demeye devam etmez
//   §13 ⭐ METRAJ PİNLEME (GERÇEK YARIŞ): okuma ile claim ARASINDA commit eden
//      bir metraj düzeltmesinden sonra iki defter + tutanak TEK rakam söyler
//   körlük zemini: her bölümde "hiçbir şeye bakılmadı" ile "ihlal yok" ayrılır
//
// ÇAPRAZ İNCELEME EKLERİ (2026-08-15) — hepsi gerçek bulgu, hepsi bekçili:
//   §3e  negatif `countedQty` REDDEDİLİR (kural paneldeydi, backend'de yoktu →
//        doğrudan API çağrısı iplik defterini EKSİ bakiyeye çekiyordu)
//   §4n/4o + §8c2/8c3/8h2  fark fişi ve donmuş tutanak FOTOĞRAFI değil TAMAMLAMA
//        ANINDAKİ metrajı yazar (aynı olay için iki rakam çıkmasın)
//   §8j2-j6  İPTAL edilmiş sayımda `getCurrent`/`getHtml` lazy-init ile ACTIVE
//        belge DOĞURMAZ; önizleme canlı topu "kayıttan düşüldü" diye basmaz
//
// NEGATİF SONDA — hepsi GERÇEKTEN koşuldu, dosyalar `shasum` ile geri yüklendi:
//   (a) tamamlamadaki TX-İÇİ TAZE CLAIM koşulları kaldırılınca (yalnız `id` ile
//       iptal) → §7 KIRMIZI (sevk edilmiş top iptal edildi)
//   (b) `freezeForSource` çağrısı kaldırılınca → §8 KIRMIZI
//   (c) işaretsiz-satır koruması kaldırılınca (`found !== true` = eksik) → §5
//       KIRMIZI (sayılmamış top kayıttan düşüldü)
//   (d) `lockDraftCountTx` kaldırılınca → §11b KIRMIZI ("gecti": işaretleme
//       rakip tx açıkken 3 ms'de geçti — ilişki filtresinin kilitlemediğinin ispatı)
//   (e) belge builder'ı yine `=== DRAFT` elemesine döndürülünce → §8j2/j3/j6
//       KIRMIZI (iptal edilmiş sayımda v1/ACTIVE belge doğdu)
//   (e2) durum etiketi `finalized`den bağımsız sabitlenince → §8j5/j5b KIRMIZI
//   (f) `applied` metrajı claim ÖNCESİ okumadan alınınca → §13a/b/c KIRMIZI
//       ⚠️ §4n bu sondada YEŞİL KALDI ve bu bilinçli olarak yazıldı: orada metraj
//       tamamlamadan ÖNCE değişiyor, yani tx-içi ilk okuma zaten tazedir. Pinleme
//       kuralını ölçen tek bölüm §13'tür (gerçek eşzamanlılık); §4n belgenin
//       fotoğraf yerine uygulanan metrajı taşımasını ölçer. İkisini birbirinin
//       yerine sayma.
//   (f2) builder `appliedQty`yi bırakıp fotoğrafı toplayınca → §8c2/8d/8h2 ve
//       §13d KIRMIZI (13d'nin (f)'de yeşil kalması tesadüf değil: kâğıt canlı
//       metrajı, defter bayat metrajı yazıyordu — findingin ta kendisi)
//   (g) tx sonrası PO senkronu kaldırılınca → §12b/12c KIRMIZI (sipariş CLOSED
//       ve 300 m karşılanmış görünmeye devam etti)
//   (h) `toQty` negatif kontrolü kaldırılınca → §3e/3e2/3e3 KIRMIZI
//
// Fixture'ı test KENDİSİ yaratır (ortam verisine bağımlı değil, hardcoded UUID
// yok); her şey `TEST-SAY-<damga>` önekiyle doğar ve finally'de silinir.
// =============================================================================
import {
  CompanyType,
  ItemType,
  ItemUnit,
  Prisma,
  PrintedDocStatus,
  PrintedDocType,
  RollStatus,
  RollVarianceKind,
  StationKind,
  StationType,
  StockCountLineKind,
  StockCountStatus,
  WarehouseEventType,
  YarnMovementKind,
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { stockCountService } from "../src/services/stock-count.service";
import { yarnService } from "../src/services/yarn.service";
import { syncPurchaseOrder } from "../src/services/purchase-order.service";
import {
  DOC_CONFIG_KEYS,
  getRegisteredDocBuilders,
  printedDocumentService,
} from "../src/services/printed-document.service";
import { DOC_PERMISSIONS } from "../src/routes/printed-document.routes";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { STOCK_COUNT_REASON_CODE, VARIANCE_SOURCES } from "../src/constants/variance-reasons";
// ⚠️ Builder kaydı import YAN ETKİSİYLE oluşur; bu satır silinirse §10'un
// "builder kayıtlı" kontrolü vakumen yeşile döner (registry boş kalır).
import "../src/services/stock-count.service";

import { ensureIplikModuluAcik } from "./fixture-module-flags";

/** ⚠️ Modül düzeyinde: `finally` bloğu `main()` gövdesinin DIŞINDA koşar. */
let modulGeriAl: (() => Promise<void>) | null = null;
const inventory = new InventoryService();

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

/** Hata bekleyen çağrı — mesajı döner, hata ATILMAZSA `null`. */
async function expectReject(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const TAG = `TEST-SAY-${Date.now()}`;

// Cleanup tutucuları.
const warehouseIds: string[] = [];
const itemIds: string[] = [];
const rollIds: string[] = [];
const countIds: string[] = [];
const stepIds: string[] = [];
const woIds: string[] = [];
const stationIds: string[] = [];
const supplierIds: string[] = [];
const poIds: string[] = [];
const receiptIds: string[] = [];

const num = (v: Prisma.Decimal | number | null | undefined): number => Number(v ?? 0);

async function makeRoll(
  warehouseId: string,
  itemId: string,
  qty: number,
  status: RollStatus = RollStatus.WAREHOUSE,
): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, {
    warehouseId,
    forcedStatus: status,
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function linesOf(countId: string) {
  return prisma.stockCountLine.findMany({
    where: { stockCountId: countId },
    select: {
      id: true,
      kind: true,
      rollId: true,
      itemId: true,
      expectedQty: true,
      countedQty: true,
      found: true,
      outOfScopeReason: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

async function main(): Promise<void> {
// ⚠️ MODÜL ORTAMI (2026-09-02): iplik kg defterinin kapısı SERVİS düzeyindedir
// (`applyYarnMovementTx` ilk işi `readIplikEnabled`). Fabrika profilinde iplik
// KAPALI olduğu için bu test onsuz 403 alır ve defteri HİÇ ölçemez. Fixture
// modülü açar, `finally` BULDUĞU değere geri yazar — gevşetilen kapı DEĞİL,
// kurulan ORTAMDIR (kapının kendi bekçileri: test_iplik_regime_gate §4d +
// test_module_flag_off).
  modulGeriAl = await ensureIplikModuluAcik();

  console.log("=== Tam stok sayımı bekçisi ===\n");

  // ── FİKSTÜR ─────────────────────────────────────────────────────────────
  const whA = await prisma.warehouse.create({
    data: { code: `${TAG}-A`, name: `${TAG} Depo A` },
    select: { id: true },
  });
  const whB = await prisma.warehouse.create({
    data: { code: `${TAG}-B`, name: `${TAG} Depo B` },
    select: { id: true },
  });
  warehouseIds.push(whA.id, whB.id);

  const fabric = await prisma.item.create({
    data: { code: `${TAG}-KM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  const yarn1 = await prisma.item.create({
    data: { code: `${TAG}-IP1`, name: `${TAG} İplik 1`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  const yarn2 = await prisma.item.create({
    data: { code: `${TAG}-IP2`, name: `${TAG} İplik 2`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  const yarn3 = await prisma.item.create({
    data: { code: `${TAG}-IP3`, name: `${TAG} İplik 3`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  const yarnZero = await prisma.item.create({
    data: { code: `${TAG}-IP0`, name: `${TAG} İplik Sıfır`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  itemIds.push(fabric.id, yarn1.id, yarn2.id, yarn3.id, yarnZero.id);

  const rollFound = await makeRoll(whA.id, fabric.id, 100);
  const rollMissing = await makeRoll(whA.id, fabric.id, 85.5);
  // §4n: fotoğraftan SONRA metrajı düzeltilecek top (G4 `adjustRollQty` sahada
  // sayım sırasında kullanılıyor) — fark fişi FOTOĞRAFI değil TAZE metrajı yazmalı.
  const rollShrunk = await makeRoll(whA.id, fabric.id, 200);
  const rollUncounted = await makeRoll(whA.id, fabric.id, 150, RollStatus.A1_STOCK);
  const rollShipped = await makeRoll(whA.id, fabric.id, 60);
  const rollOtherWh = await makeRoll(whB.id, fabric.id, 40);
  const rollDead = await makeRoll(whA.id, fabric.id, 25);
  await prisma.roll.update({ where: { id: rollDead }, data: { status: RollStatus.CANCELLED } });

  // Eksik topa AÇIK bir istasyon hareketi — `qtyOut = 0` storno kontrolü için
  // (kapanacak hareketi olmayan bir top bu kuralı ölçemez).
  const station = await prisma.station.create({
    data: { code: `${TAG}-ST`, name: `${TAG} İstasyon`, type: StationType.INTERNAL, kind: StationKind.OTHER },
    select: { id: true },
  });
  stationIds.push(station.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  stepIds.push(step.id);
  const openMovement = await prisma.rollMovement.create({
    data: { rollId: rollMissing, workOrderStepId: step.id, qtyIn: 85.5, notes: "SAYIM ONCESI" },
    select: { id: true },
  });

  // İplik bakiyeleri (yarnZero bilerek 0'a çekilir → fotoğrafa GİRMEMELİ).
  await yarnService.createMovement({ itemId: yarn1.id, warehouseId: whA.id, kind: YarnMovementKind.IN, qtyKg: 500 });
  await yarnService.createMovement({ itemId: yarn2.id, warehouseId: whA.id, kind: YarnMovementKind.IN, qtyKg: 200 });
  await yarnService.createMovement({ itemId: yarn3.id, warehouseId: whA.id, kind: YarnMovementKind.IN, qtyKg: 75 });
  await yarnService.createMovement({ itemId: yarnZero.id, warehouseId: whA.id, kind: YarnMovementKind.IN, qtyKg: 10 });
  await yarnService.createMovement({ itemId: yarnZero.id, warehouseId: whA.id, kind: YarnMovementKind.OUT, qtyKg: 10 });

  // ── §1 FOTOĞRAF ─────────────────────────────────────────────────────────
  const created = await stockCountService.create({ warehouseId: whA.id, notes: `${TAG} sayımı` });
  const countId = (created.data as { id: string }).id;
  const countNo = (created.data as { countNo: string }).countNo;
  countIds.push(countId);

  const lines = await linesOf(countId);
  const rollLines = lines.filter((l) => l.kind === StockCountLineKind.ROLL);
  const yarnLines = lines.filter((l) => l.kind === StockCountLineKind.YARN);
  check("1a) ⭐ depodaki 5 canlı top ROLL satırı oldu", rollLines.length === 5, `satır=${rollLines.length}`);
  check(
    "1b) ⭐ BAŞKA deponun topu fotoğrafa GİRMEDİ",
    !rollLines.some((l) => l.rollId === rollOtherWh),
  );
  check(
    "1c) ⭐ ÖLÜ statülü (CANCELLED) top fotoğrafa GİRMEDİ",
    !rollLines.some((l) => l.rollId === rollDead),
  );
  check(
    "1d) beklenen metraj topun currentQty'sinden yazıldı",
    num(rollLines.find((l) => l.rollId === rollMissing)?.expectedQty) === 85.5,
  );
  check("1e) ⭐ sıfır OLMAYAN 3 iplik bakiyesi YARN satırı oldu", yarnLines.length === 3, `satır=${yarnLines.length}`);
  check(
    "1f) SIFIR bakiyeli iplik kalemi fotoğrafa GİRMEDİ (sayılacak bir şey yok)",
    !yarnLines.some((l) => l.itemId === yarnZero.id),
  );
  check("1g) belge no SAY + GGAAYY + NNNN", /^SAY\d{6}\d{4}$/.test(countNo), countNo);
  check("Körlük zemini §1: fotoğraf gerçekten üretildi", lines.length >= 7, `toplam satır=${lines.length}`);

  // ── §2 İKİNCİ AÇIK SAYIM ────────────────────────────────────────────────
  const dup = await expectReject(() => stockCountService.create({ warehouseId: whA.id }));
  check("2) aynı depoda ikinci DRAFT sayım REDDEDİLDİ", dup !== null && dup.includes(countNo), dup ?? "hata atılmadı");

  // ── §3 SATIR İŞARETLEME ─────────────────────────────────────────────────
  const lineOf = (rollId: string) => rollLines.find((l) => l.rollId === rollId)!;
  await stockCountService.markLine({ stockCountId: countId, lineId: lineOf(rollMissing).id, found: false, notes: "Rafta yok" });
  await stockCountService.markLine({ stockCountId: countId, lineId: lineOf(rollShipped).id, found: false });
  await stockCountService.markLine({ stockCountId: countId, lineId: lineOf(rollShrunk).id, found: false });
  const markAll = await stockCountService.markAllFound(countId);
  check(
    "3a) toplu 'bulundu' yalnız İŞARETSİZ satırları güncelledi",
    (markAll.data as { updated: number }).updated === 2,
    `updated=${(markAll.data as { updated: number }).updated}`,
  );
  const afterMarkAll = await linesOf(countId);
  check(
    "3b) ⭐ toplu tuş AÇIK 'eksik' işaretini EZMEDİ",
    afterMarkAll.find((l) => l.rollId === rollMissing)?.found === false &&
      afterMarkAll.find((l) => l.rollId === rollShipped)?.found === false,
  );
  // rollUncounted'ı yeniden "sayılmadı"ya çek (toplu tuş onu true yapmıştı):
  // §5 tam olarak bu satırı ölçüyor.
  await stockCountService.markLine({
    stockCountId: countId,
    lineId: lineOf(rollUncounted).id,
    found: null,
  });
  check(
    "3c) `found: null` = 'henüz sayılmadı' geri yazılabiliyor (üç durumlu alan)",
    (await linesOf(countId)).find((l) => l.rollId === rollUncounted)?.found === null,
  );

  // İplik sayımları
  const yarnLineOf = (itemId: string) => yarnLines.find((l) => l.itemId === itemId)!;
  await stockCountService.markLine({ stockCountId: countId, lineId: yarnLineOf(yarn1.id).id, countedQty: 487.5 });
  await stockCountService.markLine({ stockCountId: countId, lineId: yarnLineOf(yarn2.id).id, countedQty: 200 });
  await stockCountService.markLine({ stockCountId: countId, lineId: yarnLineOf(yarn3.id).id, countedQty: 80 });

  // §3e NEGATİF SAYIM (çapraz inceleme, 2026-08-15) — kural BACKEND'DE.
  // Panel zaten reddediyordu ama doğrudan API çağrısı geçiyordu: `countedQty:
  // -5` → fark −15 → `ADJUST_OUT` → `assertYarnBalanceCoversTx` ADJUST_OUT'u
  // MUAF tutuyor → defter EKSİ bakiyeye iner ve donmuş tutanak "SAYILAN −5"
  // basar. Sıfır ise MEŞRU ("saydım, hiç kalmamış").
  const negative = await expectReject(() =>
    stockCountService.markLine({
      stockCountId: countId,
      lineId: yarnLineOf(yarn2.id).id,
      countedQty: -5,
    }),
  );
  check("3e) ⭐ NEGATİF sayılan miktar REDDEDİLDİ", negative !== null && negative.includes("eksi olamaz"), negative ?? "hata atılmadı");
  const negativeStr = await expectReject(() =>
    stockCountService.markLine({
      stockCountId: countId,
      lineId: yarnLineOf(yarn2.id).id,
      countedQty: "-0.001",
    }),
  );
  check("3e2) metin olarak gelen negatif de reddedildi (tek kapı `toQty`)", negativeStr !== null, negativeStr ?? "hata atılmadı");
  check(
    "3e3) reddedilen çağrı satırı DEĞİŞTİRMEDİ (200 kg olduğu gibi)",
    num((await linesOf(countId)).find((l) => l.itemId === yarn2.id)?.countedQty) === 200,
  );
  const zeroOk = await expectReject(() =>
    stockCountService.markLine({ stockCountId: countId, lineId: yarnLineOf(yarn2.id).id, countedQty: 0 }),
  );
  check("3e4) SIFIR meşru ('saydım, hiç kalmamış')", zeroOk === null, zeroOk ?? "");
  // Ölçülen senaryo bozulmasın diye 200'e geri yazılır (§6e farksız kalem).
  await stockCountService.markLine({ stockCountId: countId, lineId: yarnLineOf(yarn2.id).id, countedQty: 200 });

  // ── §7 KURULUMU: fotoğraftan SONRA top sevk edildi ─────────────────────
  // (Tamamlamadan ÖNCE yapılır; kontrol §7'de.)
  await prisma.roll.update({ where: { id: rollShipped }, data: { status: RollStatus.SHIPPED } });
  // §4n kurulumu: fotoğraf 200 m derken topun metrajı 120'ye düzeltildi
  // (`adjustRollQty` yolunun bıraktığı durum — burada doğrudan yazılıyor ki
  // testin ölçtüğü şey sayımın davranışı olsun, G4'ün değil).
  await prisma.roll.update({ where: { id: rollShrunk }, data: { currentQty: 120 } });
  // Ve yarn3'ün defter bakiyesi sayımdan sonra değişti (mal kabul benzeri).
  await yarnService.createMovement({ itemId: yarn3.id, warehouseId: whA.id, kind: YarnMovementKind.IN, qtyKg: 20 });

  // ── TAMAMLA ─────────────────────────────────────────────────────────────
  const done = await stockCountService.complete(countId);
  const doneData = done.data as {
    cancelledRolls: number;
    cancelledMeters: number;
    yarnAdjustments: number;
    outOfScope: number;
  };

  // ── §4 EKSİK TOP ────────────────────────────────────────────────────────
  const missingRoll = await prisma.roll.findUniqueOrThrow({
    where: { id: rollMissing },
    select: { status: true, preCancelStatus: true, cancelReason: true, warehouseId: true },
  });
  check("4a) ⭐ eksik top CANCELLED", missingRoll.status === RollStatus.CANCELLED, missingRoll.status);
  check(
    "4b) `preCancelStatus` gözlenen raftan yazıldı (geri alma doğru rafa döner)",
    missingRoll.preCancelStatus === RollStatus.WAREHOUSE,
    String(missingRoll.preCancelStatus),
  );
  check("4c) iptal sebebi sayım numarasını taşıyor", (missingRoll.cancelReason ?? "").includes(countNo), missingRoll.cancelReason ?? "");
  check("4d) depo izi SİLİNMEDİ (`warehouseId` duruyor)", missingRoll.warehouseId === whA.id);

  const variance = await prisma.rollVariance.findFirst({
    where: { rollId: rollMissing },
    select: { kind: true, qty: true, reasonCode: true, source: true },
  });
  check(
    "4e) ⭐ sapma KAYIT DÜZELTMESİ olarak yazıldı (FİRE DEĞİL)",
    variance?.kind === RollVarianceKind.RECORD_CORRECTION,
    String(variance?.kind),
  );
  check("4f) ⭐ sapma sebebi SAYIM_FARKI", variance?.reasonCode === STOCK_COUNT_REASON_CODE, String(variance?.reasonCode));
  check("4g) sapma kaynağı STOCK_COUNT", variance?.source === VARIANCE_SOURCES.STOCK_COUNT, String(variance?.source));
  check("4h) sapma metrajı topun metrajı", num(variance?.qty) === 85.5, String(variance?.qty));

  const mv = await prisma.rollMovement.findUniqueOrThrow({
    where: { id: openMovement.id },
    select: { exitedAt: true, qtyOut: true, notes: true },
  });
  check("4i) açık hareket KAPANDI", mv.exitedAt !== null);
  check(
    "4j) ⭐ `qtyOut = 0` (STORNO) — hayalet metraj istasyon iş hacmine yazılmadı",
    num(mv.qtyOut) === 0,
    String(mv.qtyOut),
  );
  check(
    "4k) hareket notu STOCK_COUNT önekli ve ESKİ NOT korunmuş",
    (mv.notes ?? "").startsWith("STOCK_COUNT_CANCELLED:") && (mv.notes ?? "").includes("SAYIM ONCESI"),
    mv.notes ?? "",
  );

  const whMv = await prisma.warehouseMovement.findFirst({
    where: { rollId: rollMissing, eventType: WarehouseEventType.CANCEL },
    select: { fromWarehouseId: true, qty: true },
  });
  check("4l) depo defterine CANCEL satırı yazıldı", whMv?.fromWarehouseId === whA.id && num(whMv?.qty) === 85.5);
  check(
    "4m) tamamlama sonucu 2 top / 205,5 m bildirdi",
    doneData.cancelledRolls === 2 && doneData.cancelledMeters === 205.5,
    `${doneData.cancelledRolls} top / ${doneData.cancelledMeters} m`,
  );

  // ── §4n METRAJ PİNLEME (çapraz inceleme, 2026-08-15) ────────────────────
  // Fotoğraf 200 m diyordu, tamamlama anında top 120 m'ydi. ÜÇ YÜZEY de aynı
  // rakamı söylemeli: sapma defteri, depo defteri ve DONMUŞ tutanak. Eski hâlde
  // claim öncesi okunan `roll.currentQty` yazılıyordu (bayat 200) ve belge
  // fotoğrafı topluyordu — aynı olay için iki rakam.
  const shrunkVariance = await prisma.rollVariance.findFirst({
    where: { rollId: rollShrunk },
    select: { qty: true },
  });
  check(
    "4n) ⭐ sapma defterine TAZE metraj yazıldı (fotoğraf 200 → gerçek 120)",
    num(shrunkVariance?.qty) === 120,
    String(shrunkVariance?.qty),
  );
  const shrunkWhMv = await prisma.warehouseMovement.findFirst({
    where: { rollId: rollShrunk, eventType: WarehouseEventType.CANCEL },
    select: { qty: true },
  });
  check("4o) depo defteri de TAZE metrajı yazdı", num(shrunkWhMv?.qty) === 120, String(shrunkWhMv?.qty));

  // ── §5 İŞARETSİZ SATIR ──────────────────────────────────────────────────
  const untouched = await prisma.roll.findUniqueOrThrow({
    where: { id: rollUncounted },
    select: { status: true },
  });
  check(
    "5a) ⭐ SAYILMAMIŞ satırın topuna DOKUNULMADI (yarım sayım depoyu silmez)",
    untouched.status === RollStatus.A1_STOCK,
    untouched.status,
  );
  check(
    "5b) sayılmamış topa sapma satırı da yazılmadı",
    (await prisma.rollVariance.count({ where: { rollId: rollUncounted } })) === 0,
  );

  // ── §6 İPLİK FARKI ──────────────────────────────────────────────────────
  const adj1 = await prisma.yarnMovement.findFirst({
    where: { itemId: yarn1.id, warehouseId: whA.id, stockCountId: countId },
    select: { kind: true, qtyKg: true, reason: true },
  });
  check("6a) ⭐ eksik iplik ADJUST_OUT olarak yazıldı", adj1?.kind === YarnMovementKind.ADJUST_OUT, String(adj1?.kind));
  check("6b) fark miktarı 12,5 kg", num(adj1?.qtyKg) === 12.5, String(adj1?.qtyKg));
  check("6c) ⭐ hareket `stockCountId` ile sayıma BAĞLI (tipli bağ)", adj1 !== null);
  const bal1 = await prisma.yarnStock.findUniqueOrThrow({
    where: { itemId_warehouseId: { itemId: yarn1.id, warehouseId: whA.id } },
    select: { balanceKg: true },
  });
  check("6d) bakiye sayılan değere indi (500 → 487,5)", num(bal1.balanceKg) === 487.5, String(bal1.balanceKg));
  check(
    "6e) FARKSIZ kalem hiç hareket doğurmadı",
    (await prisma.yarnMovement.count({ where: { itemId: yarn2.id, stockCountId: countId } })) === 0,
  );
  check("6f) tamamlama sonucu 1 iplik düzeltmesi bildirdi", doneData.yarnAdjustments === 1, String(doneData.yarnAdjustments));

  // ── §7 KAPSAM DIŞI ──────────────────────────────────────────────────────
  const shippedRoll = await prisma.roll.findUniqueOrThrow({
    where: { id: rollShipped },
    select: { status: true },
  });
  check(
    "7a) ⭐ SEVK EDİLMİŞ top İPTAL EDİLMEDİ (fotoğraf değil TAZE durum kazandı)",
    shippedRoll.status === RollStatus.SHIPPED,
    shippedRoll.status,
  );
  const finalLines = await linesOf(countId);
  const shippedLine = finalLines.find((l) => l.rollId === rollShipped);
  check(
    "7b) ⭐ satır 'kapsam dışı' olarak SEBEBİYLE işaretlendi (sessiz atlama yok)",
    (shippedLine?.outOfScopeReason ?? "").length > 0,
    shippedLine?.outOfScopeReason ?? "boş",
  );
  check(
    "7c) sebep somut ('sevk')",
    (shippedLine?.outOfScopeReason ?? "").toLowerCase().includes("sevk"),
    shippedLine?.outOfScopeReason ?? "",
  );
  const yarn3Line = finalLines.find((l) => l.itemId === yarn3.id);
  check(
    "7d) ⭐ bakiyesi DEĞİŞMİŞ iplik kalemi de kapsam dışı (eski fotoğrafla mal kabulü silinmedi)",
    (yarn3Line?.outOfScopeReason ?? "").includes("Bakiye"),
    yarn3Line?.outOfScopeReason ?? "boş",
  );
  const bal3 = await prisma.yarnStock.findUniqueOrThrow({
    where: { itemId_warehouseId: { itemId: yarn3.id, warehouseId: whA.id } },
    select: { balanceKg: true },
  });
  check("7e) o kalemin bakiyesi DOKUNULMADAN kaldı (75 + 20)", num(bal3.balanceKg) === 95, String(bal3.balanceKg));
  check("7f) tamamlama sonucu 2 kapsam dışı satır bildirdi", doneData.outOfScope === 2, String(doneData.outOfScope));

  // ── §8 BELGE ────────────────────────────────────────────────────────────
  const docs = await prisma.printedDocument.findMany({
    where: { docType: PrintedDocType.STOCK_COUNT, sourceId: countId },
    select: { version: true, status: true, snapshot: true, documentNo: true },
    orderBy: { version: "asc" },
  });
  check("8a) ⭐ belge TAMAMLANMADA dondu (tek sürüm, v1 ACTIVE)", docs.length === 1 && docs[0]?.version === 1 && docs[0]?.status === PrintedDocStatus.ACTIVE, `adet=${docs.length}`);
  check("8b) belge numarası sayım numarası", docs[0]?.documentNo === countNo, String(docs[0]?.documentNo));
  const snap = docs[0]?.snapshot as unknown as {
    doc: {
      header: { finalized?: boolean };
      summary: { rollMissing: number; rollUncounted: number; rollOutOfScope: number; missingMeters: number; yarnDiffKg: number };
      rollLines: Array<{ state: string; expectedQty: number; appliedQty?: number | null }>;
    };
  } | null;
  const sum = snap?.doc?.summary;
  check(
    "8c) ⭐ snapshot FARK ÖZETİNİ taşıyor (2 eksik · 1 sayılmadı · 1 kapsam dışı)",
    sum?.rollMissing === 2 && sum?.rollUncounted === 1 && sum?.rollOutOfScope === 1,
    JSON.stringify(sum),
  );
  check("8d) snapshot eksik metrajı 205,5", sum?.missingMeters === 205.5, String(sum?.missingMeters));
  check("8e) snapshot iplik farkı −12,5 kg", sum?.yarnDiffKg === -12.5, String(sum?.yarnDiffKg));
  check(
    "8f) ⭐ 'sayılmadı' satırı belgede GÖRÜNÜR (gizlenmiyor)",
    (snap?.doc?.rollLines ?? []).some((l) => l.state === "UNCOUNTED"),
  );
  check(
    "8g) kapsam dışı satır belgede KAPSAM DIŞI olarak basılır (eksik olarak DEĞİL)",
    (snap?.doc?.rollLines ?? []).some((l) => l.state === "OUT_OF_SCOPE"),
  );
  // ⭐ Donmuş belge, kendisini doğuran işlemin YAZDIĞI rakamı söylemeli.
  const shrunkDocLine = (snap?.doc?.rollLines ?? []).find((l) => l.expectedQty === 200);
  check(
    "8c2) ⭐ snapshot satırı UYGULANAN metrajı taşıyor (beklenen 200 · düşülen 120)",
    shrunkDocLine?.appliedQty === 120,
    JSON.stringify(shrunkDocLine),
  );
  check("8c3) snapshot `finalized` işaretli (fark UYGULANDI)", snap?.doc?.header?.finalized === true);
  const htmlRes = await printedDocumentService.getHtml(PrintedDocType.STOCK_COUNT, countId);
  const html = (htmlRes.data as { html: string } | null)?.html ?? "";
  check("8h) belge HTML'i üretiliyor ve başlığı taşıyor", html.includes("STOK SAYIM TUTANAĞI"), `uzunluk=${html.length}`);
  check(
    "8h2) ⭐ kâğıt, fotoğraftan FARKLI olan düşülen metrajı BASIYOR",
    html.includes("düşülen 120,00"),
    html.includes("düşülen") ? "farklı metin" : "hiç basılmadı",
  );
  check(
    "8h3) tamamlanmış belgede satır 'KAYITTAN DÜŞÜLDÜ' der (zaman kipi)",
    html.includes("KAYITTAN DÜŞÜLDÜ"),
  );
  check("8i) HTML kapsam dışı sebebini SEBEBİYLE basıyor", html.includes("KAPSAM DIŞI") && html.includes("Bu sırada sevk edildi"));
  check("8i2) HTML iplik tablosunu ve fark özetini basıyor", html.includes("İPLİK (kg)") && html.includes("FARK ÖZETİ"));

  // İPTAL yolunda belge DOĞMAZ
  const c2 = await stockCountService.create({ warehouseId: whA.id });
  const c2Id = (c2.data as { id: string }).id;
  countIds.push(c2Id);
  // ⚠️ İptalden ÖNCE bir satır "eksik" işaretlenir: §8j2-j5'in ölçtüğü hata
  // (iptal edilmiş sayımın kâğıdının CANLI topu "kayıttan düşüldü" diye
  // basması) ancak eksik işaretli bir satır varsa görünür.
  const c2Lines = await linesOf(c2Id);
  const c2RollLine = c2Lines.find((l) => l.kind === StockCountLineKind.ROLL && l.rollId === rollFound)!;
  await stockCountService.markLine({ stockCountId: c2Id, lineId: c2RollLine.id, found: false });
  await stockCountService.cancel(c2Id, "Yanlış depo seçildi");
  const c2Docs = await prisma.printedDocument.count({
    where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c2Id },
  });
  check("8j) ⭐ İPTAL edilen (taslak) sayımda belge HİÇ doğmadı", c2Docs === 0, `belge=${c2Docs}`);

  // ── §8j2-j6 İPTAL EDİLMİŞ SAYIM: LAZY-INIT DELİĞİ (çapraz inceleme) ──────
  // ⚠️ §8j TEK BAŞINA KÖRDÜ: iptalden hemen sonra satır sayıyor ama BELGEYE
  // ERİŞİLEN YOLU (`getCurrent` / `getHtml`) hiç çağırmıyordu. `getCurrent`
  // donmuş kayıt yoksa builder'ın `fresh`ini çağırıp sonucu KALICI YAZAR;
  // builder yalnız DRAFT'ı elediği için İPTAL EDİLMİŞ sayım, panel diyaloğu
  // açılır açılmaz **v1 / ACTIVE / reconstructed** bir "stok sayım tutanağı"
  // doğuruyordu — hiçbir deftere yazmamış, topları CANLI duran bir sayım için,
  // üstelik İPTAL filigranı olmadan.
  const c2Current = await printedDocumentService.getCurrent(PrintedDocType.STOCK_COUNT, c2Id);
  check("8j2) ⭐ `getCurrent` İPTAL edilmiş sayımda belge DOĞURMADI (data null)", c2Current.data === null);
  const c2DocsAfterGet = await prisma.printedDocument.count({
    where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c2Id },
  });
  check("8j3) ⭐ belge kütüğünde HÂLÂ satır yok (lazy-init kalıcı yazmadı)", c2DocsAfterGet === 0, `belge=${c2DocsAfterGet}`);

  // Çalışma kâğıdı ERİŞİLEBİLİR kalmalı (taslak önizleme) — ama YALAN SÖYLEMEDEN.
  const c2Preview = await printedDocumentService.getHtml(PrintedDocType.STOCK_COUNT, c2Id, undefined, {
    allowDraft: true,
  });
  const c2Html = (c2Preview.data as { html: string } | null)?.html ?? "";
  check("8j4) iptal edilmiş sayımın ÖNİZLEMESİ çalışıyor (ne sayıldığı sorusu kalır)", c2Html.includes("STOK SAYIM TUTANAĞI"), `uzunluk=${c2Html.length}`);
  check(
    "8j5) ⭐ önizleme CANLI topu 'KAYITTAN DÜŞÜLDÜ' diye BASMIYOR",
    !c2Html.includes("KAYITTAN DÜŞÜLDÜ") && !c2Html.includes("kayıttan düşülen"),
  );
  check("8j5b) yerine 'EKSİK (işaretlendi)' basıyor (işaret var, uygulanmadı)", c2Html.includes("EKSİK (işaretlendi)"));
  const c2DocsAfterHtml = await prisma.printedDocument.count({
    where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c2Id },
  });
  check("8j6) ⭐ önizleme de kalıcı kayıt yazmadı", c2DocsAfterHtml === 0, `belge=${c2DocsAfterHtml}`);
  const c2Row = await prisma.stockCount.findUniqueOrThrow({ where: { id: c2Id }, select: { status: true } });
  check("8k) iptal edilen sayım CANCELLED", c2Row.status === StockCountStatus.CANCELLED);
  check(
    "8l) iptal SATIRLARI SİLMEDİ (ne sayıldığı sorusu iptalden sonra da gerekir)",
    (await prisma.stockCountLine.count({ where: { stockCountId: c2Id } })) > 0,
  );

  // Tamamlanmış sayım artık dokunulamaz
  const lateMark = await expectReject(() =>
    stockCountService.markLine({ stockCountId: countId, lineId: lineOf(rollFound).id, found: false }),
  );
  check("3d) ⭐ TAMAMLANMIŞ sayımın satırı değiştirilemez (409)", lateMark !== null, lateMark ?? "hata atılmadı");
  const lateCancel = await expectReject(() => stockCountService.cancel(countId, "olmaz"));
  check(
    "8m) TAMAMLANMIŞ sayım iptal edilemez ve sebebi söylenir",
    lateCancel !== null && lateCancel.includes("tamamlanmış"),
    lateCancel ?? "hata atılmadı",
  );

  // ── §9 PARALEL TAMAMLAMA ────────────────────────────────────────────────
  // ⚠️ `allSettled` MEŞRU: perf kuralı 11 tek tx client'ını paylaşmaya ilişkindir;
  // burada iki AYRI transaction var ve ölçülen şey tam olarak yarıştır.
  const rollP = await makeRoll(whB.id, fabric.id, 33);
  const c3 = await stockCountService.create({ warehouseId: whB.id });
  const c3Id = (c3.data as { id: string }).id;
  countIds.push(c3Id);
  const c3Lines = await linesOf(c3Id);
  const c3Line = c3Lines.find((l) => l.rollId === rollP)!;
  await stockCountService.markLine({ stockCountId: c3Id, lineId: c3Line.id, found: false });

  const race = await Promise.allSettled([
    stockCountService.complete(c3Id),
    stockCountService.complete(c3Id),
  ]);
  const okCount = race.filter((r) => r.status === "fulfilled").length;
  check("9a) ⭐ iki paralel tamamlamadan TAM BİRİ geçti", okCount === 1, `başarılı=${okCount}`);
  check(
    "9b) ⭐ TEK belge doğdu",
    (await prisma.printedDocument.count({ where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c3Id } })) === 1,
  );
  check(
    "9c) ⭐ TEK sapma satırı yazıldı (fark fişi iki kez işlemedi)",
    (await prisma.rollVariance.count({ where: { rollId: rollP } })) === 1,
  );
  check(
    "9d) top bir kez iptal edildi",
    (await prisma.roll.findUniqueOrThrow({ where: { id: rollP }, select: { status: true } })).status ===
      RollStatus.CANCELLED,
  );

  // ── §11 İŞARETLEME ↔ TAMAMLAMA YARIŞI (çapraz inceleme, 2026-08-15) ─────
  // Ölçülen: `markLine` sayımın satırını GERÇEKTEN kilitliyor mu. Rakip bir tx
  // `DRAFT → COMPLETED` claim'ini yapmış ama henüz COMMIT etmemişken işaretleme
  // BEKLEMELİ. Eski hâlde DRAFT koşulu yalnız Prisma ilişki filtresiydi (kilitsiz
  // alt sorgu) ve işaretleme 3 ms'de geçiyordu → donmuş tutanak ile canlı satır
  // ayrışıyor, ya da onay diyaloğunda hiç görünmemiş bir top iptal ediliyordu.
  const c4 = await stockCountService.create({ warehouseId: whA.id });
  const c4Id = (c4.data as { id: string }).id;
  countIds.push(c4Id);
  const c4Line = (await linesOf(c4Id)).find((l) => l.kind === StockCountLineKind.ROLL)!;

  const rival = await pool.connect();
  try {
    await rival.query("BEGIN");
    const claimed = await rival.query(
      `UPDATE "stock_counts" SET "status" = 'COMPLETED' WHERE "id" = $1::uuid AND "status" = 'DRAFT'`,
      [c4Id],
    );
    check("11a) kurulum: rakip tx sayımı claim etti (COMMIT YOK)", claimed.rowCount === 1);

    const marking = stockCountService
      .markLine({ stockCountId: c4Id, lineId: c4Line.id, found: false })
      .then(() => "gecti")
      .catch(() => "reddedildi");
    const verdict = await Promise.race([
      marking,
      new Promise<string>((r) => setTimeout(() => r("bloklandi"), 900)),
    ]);
    check(
      "11b) ⭐ rakip tx açıkken işaretleme BLOKLANDI (satır kilidi gerçek)",
      verdict === "bloklandi",
      verdict,
    );

    await rival.query("ROLLBACK");
    const after = await marking;
    check("11c) rakip geri sarılınca işaretleme TAMAMLANDI", after === "gecti", after);
    check(
      "11d) satır gerçekten yazıldı",
      (await linesOf(c4Id)).find((l) => l.id === c4Line.id)?.found === false,
    );
  } finally {
    rival.release();
  }
  await stockCountService.cancel(c4Id, "Bekçi temizliği");

  // ── §12 ALIŞ SİPARİŞİ ROLLUP'I (çapraz inceleme, 2026-08-15) ────────────
  // Sayımda düşülen top bir mal kabul fişinden geldiyse KARŞILANMA DEĞİŞİR
  // (`computeReceivedByItemTx` iptal edilmiş topu saymaz). Senkron çağrılmazsa
  // sipariş "tamamı geldi" (CLOSED) görünmeye devam eder ve kimse eksik malı
  // tedarikçiden istemez — `inventory.softDelete` bu bacağı 2026-08-14'te tam
  // bu yüzden eklemişti.
  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-TED`, name: `${TAG} Tedarikçi`, type: CompanyType.SUPPLIER },
    select: { id: true },
  });
  supplierIds.push(supplier.id);
  const po = await prisma.purchaseOrder.create({
    data: {
      orderNo: `${TAG}-AS`,
      supplierId: supplier.id,
      orderDate: new Date(),
      lines: { create: [{ lineNo: 1, itemId: fabric.id, qty: 300 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  poIds.push(po.id);
  const receipt = await prisma.goodsReceipt.create({
    data: {
      receiptNo: `${TAG}-MK`,
      warehouseId: whB.id,
      supplierId: supplier.id,
      purchaseOrderId: po.id,
    },
    select: { id: true },
  });
  receiptIds.push(receipt.id);
  const rollPo = await makeRoll(whB.id, fabric.id, 300);
  await prisma.roll.update({
    where: { id: rollPo },
    data: { goodsReceiptId: receipt.id, purchaseOrderLineId: po.lines[0]!.id },
  });
  await syncPurchaseOrder(po.id);
  const poBefore = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po.id },
    select: { status: true, lines: { select: { receivedQty: true } } },
  });
  check(
    "12a) kurulum: sipariş karşılandı (300 m · CLOSED)",
    num(poBefore.lines[0]?.receivedQty) === 300 && poBefore.status === "CLOSED",
    `${poBefore.status} / ${String(poBefore.lines[0]?.receivedQty)}`,
  );

  const c5 = await stockCountService.create({ warehouseId: whB.id });
  const c5Id = (c5.data as { id: string }).id;
  countIds.push(c5Id);
  const c5Line = (await linesOf(c5Id)).find((l) => l.rollId === rollPo)!;
  await stockCountService.markLine({ stockCountId: c5Id, lineId: c5Line.id, found: false });
  await stockCountService.complete(c5Id);

  const poAfter = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po.id },
    select: { status: true, lines: { select: { receivedQty: true } } },
  });
  check(
    "12b) ⭐ sayımda düşülen top KARŞILANMADAN düştü (300 → 0)",
    num(poAfter.lines[0]?.receivedQty) === 0,
    String(poAfter.lines[0]?.receivedQty),
  );
  check(
    "12c) ⭐ sipariş durumu yeniden türetildi (CLOSED → OPEN)",
    poAfter.status === "OPEN",
    poAfter.status,
  );

  // ── §13 METRAJ PİNLEME — GERÇEK YARIŞ (çapraz inceleme, 2026-08-15) ─────
  // ⚠️ §4n TEK BAŞINA KÖRDÜ ve bu ölçüldü: orada metraj tamamlamadan ÖNCE
  // değiştiği için tx-içi ilk okuma zaten taze değeri görüyor; `applied` metrajı
  // claim ÖNCESİ okumadan alınacak şekilde geri çevrildiğinde §4n YEŞİL KALDI.
  // Asıl pencere OKUMA ile CLAIM ARASIDIR ve ancak gerçek eşzamanlılıkla açılır:
  //   ① rakip tx `currentQty`yi 300 → 180 yapar (COMMIT YOK) → satır kilidi onda
  //   ② tamamlama başlar: tx-içi okuma HÂLÂ 300 görür, sonra claim KİLİDE TAKILIR
  //   ③ rakip COMMIT eder → claim yeniden değerlendirilir ve GEÇER
  // Bu noktada metraj claim'den SONRA okunmazsa iki deftere ve donmuş tutanağa
  // 300 yazılır; gerçekte 180 vardır (sapma 120 m şişer).
  const rollRace = await makeRoll(whA.id, fabric.id, 300);
  const c6 = await stockCountService.create({ warehouseId: whA.id });
  const c6Id = (c6.data as { id: string }).id;
  countIds.push(c6Id);
  const c6Line = (await linesOf(c6Id)).find((l) => l.rollId === rollRace)!;
  await stockCountService.markLine({ stockCountId: c6Id, lineId: c6Line.id, found: false });

  const rival2 = await pool.connect();
  let raceResult: unknown;
  try {
    await rival2.query("BEGIN");
    await rival2.query(`UPDATE "rolls" SET "currentQty" = 180 WHERE "id" = $1::uuid`, [rollRace]);
    const completing = stockCountService.complete(c6Id);
    // Tamamlamanın claim'e ulaşıp KİLİTTE beklemesi için kısa bekleme.
    await new Promise((r) => setTimeout(r, 500));
    await rival2.query("COMMIT");
    raceResult = await completing;
  } finally {
    rival2.release();
  }
  const raceData = (raceResult as { data: { cancelledMeters: number } }).data;
  check(
    "13a) ⭐ yanıt CLAIM SONRASI metrajı bildirdi (300 değil 180)",
    raceData.cancelledMeters === 180,
    String(raceData.cancelledMeters),
  );
  const raceVariance = await prisma.rollVariance.findFirst({
    where: { rollId: rollRace },
    select: { qty: true },
  });
  check("13b) ⭐ sapma defteri 180 yazdı (hayalet 120 m şişme yok)", num(raceVariance?.qty) === 180, String(raceVariance?.qty));
  const raceWhMv = await prisma.warehouseMovement.findFirst({
    where: { rollId: rollRace, eventType: WarehouseEventType.CANCEL },
    select: { qty: true },
  });
  check("13c) depo defteri de 180 yazdı", num(raceWhMv?.qty) === 180, String(raceWhMv?.qty));
  const raceDoc = await prisma.printedDocument.findFirst({
    where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c6Id },
    select: { snapshot: true },
  });
  const raceSnap = raceDoc?.snapshot as unknown as {
    doc: { summary: { missingMeters: number } };
  } | null;
  check(
    "13d) ⭐ DONMUŞ TUTANAK aynı rakamı söylüyor (kâğıt ↔ defter)",
    raceSnap?.doc?.summary?.missingMeters === 180,
    String(raceSnap?.doc?.summary?.missingMeters),
  );

  // ── §10 MEKANİK HİZALAR ─────────────────────────────────────────────────
  const cfgKey = DOC_CONFIG_KEYS[PrintedDocType.STOCK_COUNT];
  check("10a) DOC_CONFIG_KEYS girişi var", Boolean(cfgKey), String(cfgKey));
  const keyValues = Object.values(DOC_CONFIG_KEYS);
  check("10b) belge ayar anahtarları BENZERSİZ", new Set(keyValues).size === keyValues.length);
  const perms = DOC_PERMISSIONS[PrintedDocType.STOCK_COUNT];
  check("10c) DOC_PERMISSIONS girişi var", Boolean(perms));
  check(
    "10d) read ⊇ write (yazabilen okuyabilir — aksi halde revize eden belgeyi açamaz)",
    (perms?.write ?? []).every((w) => (perms?.read ?? []).includes(w)),
    `read=[${perms?.read.join(",")}] write=[${perms?.write.join(",")}]`,
  );
  const builder = getRegisteredDocBuilders().get(PrintedDocType.STOCK_COUNT);
  check("10e) builder kayıtlı", Boolean(builder));
  check("10f) renderHtml kayıtlı (yoksa baskı 400 verir)", typeof builder?.renderHtml === "function");
  check("10g) örnek veri var (Belge Şablonları canlı önizlemesi)", Boolean(SAMPLE_PRINTED_DOCS[PrintedDocType.STOCK_COUNT]));
  // ⚠️ Örneğin VAR OLMASI yetmez, RENDER OLMASI gerekir: panelin canlı
  // önizlemesi bu yolu çağırır ve şekli tutmayan bir örnek orada BOŞ/ÇÖP kart
  // olarak görünür (ekranda hata da çıkmaz).
  const sampleHtml = await printedDocumentService.renderSampleHtml(PrintedDocType.STOCK_COUNT, null);
  check(
    "10g2) ⭐ örnek veri panel önizlemesinde GERÇEKTEN render oluyor",
    sampleHtml.includes("STOK SAYIM TUTANAĞI") &&
      sampleHtml.includes("İPLİK (kg)") &&
      sampleHtml.includes("FARK ÖZETİ"),
    `uzunluk=${sampleHtml.length}`,
  );

  // Rota kapıları — KAYNAK taraması (kapı silinirse fabrika rejimi açılır).
  const routeSrc = readFileSync(join(__dirname, "../src/routes/stock-count.routes.ts"), "utf8");
  // ⚠️ KAPI 2026-09-02'de `requireFinanceEnabled` → `requireTicaretEnabled`
  // olarak TAŞINDI: stok sayımı bir MAL sorusudur (top + iplik defteri), cari
  // defter değil. Ad değişikliği bu iki satırla AYNI commit'te gitmezse bekçi
  // kırmızı verir — sözleşmenin metinle kilitlendiği yer burası.
  check("10h) ⭐ rota REJİM kapısını taşıyor", routeSrc.includes("requireTicaretEnabled"));
  check(
    "10i) rejim kapısı router seviyesinde (her uç için)",
    /router\.use\(\s*verifyToken\s*,\s*requireTicaretEnabled\s*\)/.test(routeSrc),
  );
  check(
    "10j) ⭐ tamamlama ucu İKİ defterin de yetkisini arıyor",
    /complete[\s\S]{0,300}roll:manual-adjust[\s\S]{0,200}yarn:write/.test(routeSrc),
  );
  const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
  check("10k) router app.ts'e BAĞLI", appSrc.includes('app.use("/api/stock-counts", stockCountRoutes)'));
  check("Körlük zemini §10: kaynak dosyaları gerçekten okundu", routeSrc.length > 1000 && appSrc.length > 1000);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    if (modulGeriAl) {
      await modulGeriAl().catch((e: Error) =>
        console.error("   ⚠️  modül bayrakları geri yazılamadı:", e.message),
      );
    }
    try {
      // FK sırası: yarnMovement (stockCount RESTRICT) → printedDocument →
      // stockCountLine (roll/item/stockCount RESTRICT) → stockCount →
      // rollVariance/warehouseMovement/rollMovement/rollOperation → roll →
      // step → wo → station → yarnStock/yarnMovement → item → warehouse.
      if (countIds.length) {
        await prisma.yarnMovement.deleteMany({ where: { stockCountId: { in: countIds } } });
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: countIds } } });
        await prisma.stockCountLine.deleteMany({ where: { stockCountId: { in: countIds } } });
        await prisma.stockCount.deleteMany({ where: { id: { in: countIds } } });
      }
      // ⚠️ Sızıntı güvenliği: negatif sonda koşarken "reddedilmeli" denen bir
      // çağrı BAŞARILI olursa doğan sayımın id'si hiçbir yere yazılmaz ve
      // RESTRICT FK'lar tüm fikstürü dev DB'sinde bırakırdı (test_official_
      // finance_docs dersi). Küme depolardan yeniden çözülür.
      if (warehouseIds.length) {
        const leaked = await prisma.stockCount.findMany({
          where: { warehouseId: { in: warehouseIds } },
          select: { id: true },
        });
        const ids = leaked.map((l) => l.id);
        if (ids.length) {
          await prisma.yarnMovement.deleteMany({ where: { stockCountId: { in: ids } } });
          await prisma.printedDocument.deleteMany({ where: { sourceId: { in: ids } } });
          await prisma.stockCountLine.deleteMany({ where: { stockCountId: { in: ids } } });
          await prisma.stockCount.deleteMany({ where: { id: { in: ids } } });
        }
      }
      if (rollIds.length) {
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (receiptIds.length) await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      if (poIds.length) {
        // Satırlar CASCADE ile düşer; `Roll.purchaseOrderLineId` SET NULL FK
        // taşıyor ve toplar zaten yukarıda silindi.
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
      }
      if (supplierIds.length) await prisma.customer.deleteMany({ where: { id: { in: supplierIds } } });
      if (stepIds.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
      if (woIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      if (stationIds.length) await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
      if (itemIds.length) {
        await prisma.yarnMovement.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.yarnStock.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
