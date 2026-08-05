// =============================================================================
// BEKÇİ: Refakat kartı "bayat" bayrağı (TravelerCard.contentDirty)
// Çalıştır: npx tsx scripts/test_traveler_card_stale.ts
// =============================================================================
// SAHA VAKASI: Bilgisayardan iş emri açılıp kart HEMEN basılınca, parti henüz
// doğmadığı için kâğıtta parti no YOK. Parti `attachRolls`'ta doğar; kısmi fason
// sevkinde kalanlar YENİ parti alır; çok partili sevkte K11 merge kaynakları yutar.
// Üçünde de basılı kâğıt sessizce yanlışlanıyordu — hiçbir yerde uyarı yoktu.
//
// Bu test kuralın ÜÇ yönünü de kilitler:
//   (a) işaretlenmesi GEREKEN olaylar bayrağı kaldırıyor mu,
//   (b) temizlemesi GEREKEN yollar temizliyor, GEREKMEYENLER dokunmuyor mu,
//   (c) §6 — baskı GÜNCEL planı basıyor ve içerik değiştiyse OTOMATİK revize
//       ediyor mu (bayrağı temizlemek tek başına yetmez: bayat uyarısı sönerken
//       kâğıda eski plan basılırsa hata sessizce kalıcılaşır).
//
// ⚠️ (b)'nin ikinci yarısı asıl kırılgan taraf: `GET /traveler-cards/:id/html`
// bayrağı TEMİZLEMEMELİ — o uç önizlemeyi de besler. Biri "kolaylık olsun" diye
// oraya temizleme eklerse rozet, kart hiç basılmadan sessizce sönerdi.
// =============================================================================
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { RollStatus, TravelerCardStatus, WorkOrderStatus, StationType, ItemType, ItemUnit } from "@prisma/client";
import { createBatchTx, mergeBatches, moveRolls } from "../src/services/batch.service";
import { withBarcodeRetry } from "../src/utils/barcode-retry";
import { markTravelerCardDirtyTx } from "../src/services/helpers/traveler-card-dirty.helper";
import { TravelerCardService } from "../src/services/traveler-card.service";

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

const SUFFIX = `TCS${Date.now().toString().slice(-8)}`;
const cleanup: { workOrderIds: string[]; rollIds: string[]; itemId?: string; stationId?: string } = {
  workOrderIds: [],
  rollIds: [],
};

const cardService = new TravelerCardService();

/** Kartın güncel bayrağı (test okuması — servis kullanmadan doğrudan DB). */
async function dirty(workOrderId: string): Promise<boolean> {
  const c = await prisma.travelerCard.findUnique({
    where: { workOrderId },
    select: { contentDirty: true },
  });
  return c?.contentDirty === true;
}

/** Parti doğurur — üretimdeki `attachRolls` ile AYNI sarmalayıcı.
 *  `withBarcodeRetry` şart değil sanılıyordu ama parti no GÜNLÜK SEKANS'tır ve
 *  dev DB'si eşzamanlı oturumlarla paylaşılıyor: çıplak çağrı `batchNumber`
 *  unique çakışmasına düşer (üretimde de düşerdi — orada da sarmalı çağrılıyor). */
async function newBatch(workOrderId: string, rollIds: string[]) {
  return withBarcodeRetry(() =>
    prisma.$transaction((tx) => createBatchTx(tx, { workOrderId, rollIds })),
  );
}

async function clean(workOrderId: string): Promise<void> {
  await prisma.travelerCard.updateMany({ where: { workOrderId }, data: { contentDirty: false } });
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// Ortamdaki veriye BAĞLANMAZ (CLAUDE.md kuralı): kendi ürün/istasyon/WO/top'unu
// üretir. Master-data seed'den değil, TEST- prefix'iyle yaratılır.
async function setup(): Promise<{ woId: string; rollIds: string[] }> {
  const item = await prisma.item.create({
    data: {
      code: `TEST-ITM-${SUFFIX}`,
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
      steps: { create: [{ stepSequence: 1, stationId: station.id }] },
    },
    select: { id: true },
  });
  cleanup.workOrderIds.push(wo.id);

  // Kart — gerçek akışta WO açılışında doğar; burada aynı servisi kullanıyoruz
  // ki `createForWorkOrder`'ın bayrağı `false` doğurduğu da doğrulansın.
  await prisma.$transaction((tx) => cardService.createForWorkOrder(tx, wo.id));

  const rollIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-R-${SUFFIX}-${i}`,
        itemId: item.id,
        initialQty: 100,
        currentQty: 100,
        status: RollStatus.STOCK,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    cleanup.rollIds.push(r.id);
  }
  return { woId: wo.id, rollIds };
}

// ── 1) Kart temiz doğar ─────────────────────────────────────────────────────
async function testBorn(woId: string): Promise<void> {
  console.log("\n── 1) Kart TEMİZ doğar ──");
  check("yeni kart contentDirty=false", (await dirty(woId)) === false, "geçmişe dönük iddia yok");
}

// ── 2) Parti doğuşu = ASIL saha vakası ──────────────────────────────────────
async function testBatchBirth(woId: string, rollIds: string[]): Promise<void> {
  console.log("\n── 2) Parti doğuşu (attachRolls yolu) ──");
  await clean(woId);
  const res = await newBatch(woId, rollIds.slice(0, 2));
  check("createBatchTx kartı bayat işaretler", await dirty(woId), "kullanıcının bildirdiği vaka");

  // ⚠️ K18 ASİMETRİSİ: rol etiketinde "ilk parti ataması" bayraklanmaz (etiket
  // henüz parti numarasıyla basılmamıştır). KARTTA TERSİ geçerli — kart parti
  // doğmadan basılabildiği için ilk doğuş tam da bayatlatan olaydır.
  const rollsAfter = await prisma.roll.findMany({
    where: { id: { in: rollIds.slice(0, 2) } },
    select: { labelDirty: true },
  });
  check(
    "aynı olayda TOP etiketi bayraklanMAZ (K18 asimetrisi korunuyor)",
    rollsAfter.every((r) => r.labelDirty === false),
    "kart ≠ etiket; iki kural birbirine kopyalanmamalı",
  );
  return void res;
}

// ── 3) Parti bölme / birleştirme / üyelik taşıma ────────────────────────────
async function testBatchSurgery(woId: string, rollIds: string[]): Promise<void> {
  console.log("\n── 3) Parti cerrahisi ──");

  // İkinci parti (bölme ve birleştirme için)
  await clean(woId);
  const b2 = await newBatch(woId, rollIds.slice(2, 4));
  check("ikinci parti doğuşu da işaretler", await dirty(woId));

  // Üyelik taşıma — moveRolls
  await clean(woId);
  await moveRolls({ rollIds: [rollIds[0]], toBatchId: b2.batch.id });
  check("moveRolls işaretler", await dirty(woId), "kart parti satırındaki top/metraj değişti");

  // Birleştirme — mergeBatches.
  // ⚠️ Yukarıdaki `moveRolls` boşalan kaynak partiyi silebiliyor (izsizse), o yüzden
  // merge için partiyi VARSAYMA — açıkça yenisini doğur, sonra canlı listeyi oku.
  await newBatch(woId, [rollIds[1]]);
  const batches = await prisma.batch.findMany({
    where: { workOrderId: woId, mergedIntoId: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (batches.length >= 2) {
    await clean(woId);
    await mergeBatches({ batchIds: batches.map((b) => b.id) });
    check(
      "mergeBatches işaretler",
      await dirty(woId),
      "birleşen partiler kartta ARTIK BASILMIYOR (mergedIntoId != null atlanır)",
    );
  } else {
    check("mergeBatches işaretler", false, "fixture 2 parti üretemedi — test geçersiz");
  }
}

// ── 4) Temizleme yolları ────────────────────────────────────────────────────
async function testClearing(woId: string): Promise<void> {
  console.log("\n── 4) Temizleme ──");

  const card = await prisma.travelerCard.findUnique({
    where: { workOrderId: woId },
    select: { id: true, version: true },
  });
  if (!card) {
    check("kart bulundu", false);
    return;
  }

  // (a) print-event temizler; iş emri içeriği DEĞİŞMEDİĞİ için versiyon ARTMAZ
  //     (aynı belgenin ikinci kopyası revizyon değildir — parti/sevk değişikliği
  //     plan snapshot'ına girmez, canlı çözülür).
  await prisma.$transaction((tx) => markTravelerCardDirtyTx(tx, woId));
  check("ön koşul: bayrak açık", await dirty(woId));
  await cardService.recordPrintEvent(card.id);
  check("print-event bayrağı temizler", (await dirty(woId)) === false);
  const afterPrint = await prisma.travelerCard.findUnique({
    where: { id: card.id },
    select: { version: true },
  });
  check(
    "içerik değişmemişse print-event versiyonu ARTIRMAZ",
    afterPrint?.version === card.version,
    "parti/sevk kaynaklı bayatlık revizyon DEĞİLDİR",
  );

  // (b) ⚠️ getCardHtml TEMİZLEMEZ — önizleme de aynı ucu çağırır.
  await prisma.$transaction((tx) => markTravelerCardDirtyTx(tx, woId));
  await cardService.getCardHtml(card.id);
  check(
    "getCardHtml bayrağı TEMİZLEMEZ",
    await dirty(woId),
    "HTML almak ≠ basmak; önizleme rozeti söndürmemeli",
  );

  // (c) reprint temizler (snapshot'ı da tazeler)
  await cardService.reprint(woId, "bekçi testi — yeniden basım");
  check("reprint bayrağı temizler", (await dirty(woId)) === false);
}

// ── 6) OTOMATİK REVİZYON — plan CANLI, sunum DONMUŞ ─────────────────────────
// Kart kontrollü belgedir (ISO 9001 §7.5.3): sahaya inen kâğıt YÜRÜRLÜKTEKİ planı
// göstermeli. Eskiden `getCardHtml` doğuşta donmuş snapshot'ı basıyor, `print-event`
// ise bayrağı temizleyip snapshot'a DOKUNMUYORDU → iş emri içeriği değiştiğinde
// operatör "önizleme günceldir" yazan bir bantla ESKİ planı basıyor ve uyarı da
// sönüyordu (sessizce yanlış kâğıt). Bu bölüm dört kuralı birden kilitler.
async function testAutoRevision(woId: string): Promise<void> {
  console.log("\n── 6) Otomatik revizyon ──");

  const card0 = await prisma.travelerCard.findUnique({
    where: { workOrderId: woId },
    select: { id: true, version: true, snapshot: true },
  });
  if (!card0) {
    check("kart bulundu", false);
    return;
  }
  // (a) Değişiklik yokken baskı = düz kopya (revizyon DEĞİL)
  await cardService.recordPrintEvent(card0.id);
  const v1 = await prisma.travelerCard.findUnique({
    where: { id: card0.id },
    select: { version: true },
  });
  check("değişiklik yokken baskı sürüm ARTIRMAZ", v1?.version === card0.version);

  // (b) İş emri içeriği değişti → önizleme CANLI planı basar
  await prisma.workOrder.update({ where: { id: woId }, data: { width: 155 } });
  const html = await cardService.getCardHtml(card0.id);
  check(
    "getCardHtml ACTIVE kartta GÜNCEL planı basar",
    html.includes("155 cm"),
    "yürürlükteki plan sahaya iner (donmuş kopya değil)",
  );

  // (c) Önizlemedeki sürüm = basıldığında yazılacak sürüm. Ayrışırlarsa kâğıttaki
  //     revizyon numarası içeriği tanımlamaz olur — revizyon kontrolü çöker.
  const nextV = card0.version + 1;
  check("önizleme 'bu baskı v{N} olacak' der", html.includes(`v${nextV} ·`), `v${nextV}`);
  const untouched = await prisma.travelerCard.findUnique({
    where: { id: card0.id },
    select: { version: true },
  });
  check(
    "önizleme kart satırını DEĞİŞTİRMEZ (GET yan etkisiz)",
    untouched?.version === card0.version,
    "önizleyip kapatan kullanıcı hiçbir şey yazmaz",
  );

  // SUNUM sondası: kartın donmuş sayfa boyutunu, `resolveForPrint`'in döndüreceğinin
  // TERSİNE çevir. Baskı yolu sunumu karttan taşımak yerine yeniden çözerse bu değer
  // sessizce geri döner — kontrol (e) ancak bu ayrım kurulduğunda kırmızı verebilir
  // (fixture'da şablon satırı yok; iki yol da aynı config'i üretir → kontrol kör kalırdı).
  const cfgStored = ((card0.snapshot as Record<string, unknown> | null)?.config ?? {}) as Record<
    string,
    unknown
  >;
  const flipped = cfgStored.pageSize === "A4" ? "A5" : "A4";
  await prisma.travelerCard.update({
    where: { id: card0.id },
    data: {
      snapshot: {
        ...(card0.snapshot as Record<string, unknown>),
        config: { ...cfgStored, pageSize: flipped },
      } as never,
    },
  });

  // (d) Baskı → revizyon: sürüm önizlemedeki numaraya çekilir, basılan plan kaydedilir
  await cardService.recordPrintEvent(card0.id);
  const after = await prisma.travelerCard.findUnique({
    where: { id: card0.id },
    select: { version: true, snapshot: true },
  });
  const snap = after?.snapshot as Record<string, unknown> | null;
  check("içerik değişmişse baskı sürümü ARTIRIR", after?.version === nextV, `v${after?.version}`);
  check("basılan plan snapshot'a kaydedilir", snap?.width === 155, "snapshot = son basılan kopya");

  // (e) SUNUM baskı yolunda TAZELENMEZ — şablon/sayfa yalnız `reprint` ile değişir
  //     ("şablonu değiştirdim, sahadaki kartlar niye değişmedi?" kuralı).
  check(
    "baskı SUNUMU (şablon/config) tazelemez",
    (snap?.config as Record<string, unknown> | undefined)?.pageSize === flipped,
    "sunum kartta donmuş kalır — yalnız reprint tazeler",
  );

  // (f) Aynı içerikte ikinci baskı yine düz kopyadır
  await cardService.recordPrintEvent(card0.id);
  const v3 = await prisma.travelerCard.findUnique({
    where: { id: card0.id },
    select: { version: true },
  });
  check("aynı içerikte ikinci baskı sürüm ARTIRMAZ", v3?.version === nextV, "sürüm şişmesi yok");

  // (g) ACTIVE OLMAYAN kart REVİZE EDİLMEZ — elde olan tarihsel kopyadır; iptal
  //     edilmiş kartı bugünkü planla tazelemek belgeyi geçmişe dönük değiştirmektir.
  await prisma.travelerCard.update({
    where: { id: card0.id },
    data: { status: TravelerCardStatus.VOIDED },
  });
  await prisma.workOrder.update({ where: { id: woId }, data: { width: 166 } });
  const voidHtml = await cardService.getCardHtml(card0.id);
  check(
    "VOIDED kart DONMUŞ kopyadan basılır",
    voidHtml.includes("155 cm") && !voidHtml.includes("166 cm"),
    "geçersiz kart canlı planla tazelenmez",
  );
  await cardService.recordPrintEvent(card0.id);
  const v4 = await prisma.travelerCard.findUnique({
    where: { id: card0.id },
    select: { version: true },
  });
  check("VOIDED kartta baskı sürüm ARTIRMAZ", v4?.version === nextV);
  await prisma.travelerCard.update({
    where: { id: card0.id },
    data: { status: TravelerCardStatus.ACTIVE },
  });
}

// ── 5) Helper sözleşmesi ────────────────────────────────────────────────────
async function testHelperContract(woId: string): Promise<void> {
  console.log("\n── 5) markTravelerCardDirtyTx sözleşmesi ──");

  await clean(woId);
  const n1 = await prisma.$transaction((tx) => markTravelerCardDirtyTx(tx, woId));
  check("temiz kartı işaretler (count=1)", n1 === 1);

  // İdempotans: zaten bayat kartta gereksiz UPDATE yazmaz (labelDirty emsali —
  // yüksek trafikli parti/sevk yollarından çağrılıyor).
  const n2 = await prisma.$transaction((tx) => markTravelerCardDirtyTx(tx, woId));
  check("zaten bayat kartta gereksiz yazma YOK (count=0)", n2 === 0);

  // Kartsız WO / bilinmeyen id → sessiz 0 (patlamaz).
  const n3 = await prisma.$transaction((tx) =>
    markTravelerCardDirtyTx(tx, "00000000-0000-0000-0000-000000000000"),
  );
  check("kartsız iş emrinde sessiz 0", n3 === 0);

  // VOIDED kart kapsam dışı — basılacak kâğıt yok.
  await clean(woId);
  await prisma.travelerCard.updateMany({
    where: { workOrderId: woId },
    data: { status: TravelerCardStatus.VOIDED },
  });
  const n4 = await prisma.$transaction((tx) => markTravelerCardDirtyTx(tx, woId));
  check("VOIDED kart işaretlenMEZ", n4 === 0);
  await prisma.travelerCard.updateMany({
    where: { workOrderId: woId },
    data: { status: TravelerCardStatus.ACTIVE },
  });
}

// ── Temizlik ────────────────────────────────────────────────────────────────
async function teardown(): Promise<void> {
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: cleanup.rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: cleanup.rollIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: cleanup.workOrderIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: cleanup.workOrderIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: cleanup.workOrderIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: cleanup.workOrderIds } } });
  if (cleanup.stationId) await prisma.station.deleteMany({ where: { id: cleanup.stationId } });
  if (cleanup.itemId) await prisma.item.deleteMany({ where: { id: cleanup.itemId } });
}

async function main(): Promise<void> {
  try {
    const { woId, rollIds } = await setup();
    await testBorn(woId);
    await testBatchBirth(woId, rollIds);
    await testBatchSurgery(woId, rollIds);
    await testClearing(woId);
    await testHelperContract(woId);
    await testAutoRevision(woId);
  } catch (e) {
    fail++;
    console.log(`  ✗ BEKLENMEYEN HATA: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.log(e.stack);
  } finally {
    try {
      await teardown();
    } catch (e) {
      console.log(`  ⚠ temizlik hatası: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
