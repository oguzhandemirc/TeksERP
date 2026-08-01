// =============================================================================
// TEST: Çuval içerik invariant'ı — "çuvaldaki top başka yere ALINAMAZ"
// Çalıştır: npx tsx scripts/test_sack_status_invariant.ts
// =============================================================================
// KÖK NEDEN (2026-07-30): DEPO çuvalındaki topun `Roll.shipmentId`'si NULL'dır
// (`shipmentId` yalnız `createShipment` anında yazılır) → "çuvalda mı?" sorusunu
// `shipmentId` ile soran guard depo çuvalındaki topu SERBEST sanıyordu. Dört akış
// bu hatayı yapıyordu: `kartela.dispatch`, `tambur.cutWarehouseRoll`,
// `tambur.finalizeWarehouseCut`, `subcontractor` auto-attach. Sonuç: top
// AT_KARTELA/TAMBUR_CONSUMED olup çuvalda kalıyor, sevkte SHIPPED'e eziliyor
// (çift tüketim) ve şişmiş metraj DONMUŞ resmi irsaliyeye giriyordu.
//
// Test cross-domain: kartela + tambur + fason + shipping + label + belge + liste.
// Bu yüzden mevcut hiçbir test dosyasının sahibi değil, ayrı dosyada yaşar.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { withSackConstraintSuspended } from "./fixture-sack-constraint";
import { shippingService } from "../src/services/shipping.service";
import { kartelaService } from "../src/services/kartela.service";
import { TamburService } from "../src/services/tambur.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { LabelService } from "../src/services/label.service";
import { SackSearchService } from "../src/services/sack-search.service";
import { AppError } from "../src/utils/app-error";
import { Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import { createManualMoveFixture, type ManualMoveFixture } from "./fixture-manual-move";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
const is409 = (e: unknown) => e instanceof AppError && e.statusCode === 409;
const msgOf = (e: unknown) => (e instanceof AppError ? e.message : String(e));

const TS = Date.now().toString().slice(-6);
const search = new SackSearchService();
const tambur = new TamburService();
const fason = new SubcontractorService();
const labels = new LabelService();

// Sevk onayı varsayılan KAPALI → createShipment doğrudan DISPATCHED eder. Senaryo 7
// PLANNED sevkiyatta dispatch guard'ını kanıtladığından onayı geçici AÇARIZ.
const CONF_KEY = "shipping.confirmationEnabled";
// `SystemSetting.value` şemada `Json` — `string` DEĞİL. Yanlış tip yüzünden bu
// "ayarı yedekle/geri yükle" bloğu hiç derlenmiyordu; geri yüklemede ham `null`
// yazmak da Prisma'da çalışmaz (Json kolonda `Prisma.JsonNull` gerekir).
let prevConf: Prisma.JsonValue | undefined;

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
let KARTELA_FIRM = "";
let FASON_FIRM = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
let fixture: ManualMoveFixture | null = null;

async function setup(): Promise<void> {
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin"
  ).id;
  KARTELA_FIRM = need(
    await prisma.subcontractor.findFirst({ where: { code: "KARTELAAS" }, select: { id: true } }),
    "KARTELAAS firması"
  ).id;
  // Fason sevki için zımpara/fason kategorisine uygun herhangi bir aktif firma.
  FASON_FIRM = need(
    await prisma.subcontractor.findFirst({
      where: { isActive: true, code: { not: "KARTELAAS" } },
      select: { id: true },
    }),
    "aktif fason firması"
  ).id;
  CUSTOMER = (
    await prisma.customer.create({
      data: { code: `TEST-SINV-C-${TS}`, name: `Invariant Test Müşteri ${TS}` },
      select: { id: true },
    })
  ).id;
  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-SINV-I-${TS}`, name: `Invariant Test Ürün ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
}

/** Barkodlu WAREHOUSE top (serbest, çuvalsız). */
async function makeRoll(
  qty = 100,
  status: RollStatus = RollStatus.WAREHOUSE,
  itemId?: string
): Promise<{ id: string; barcode: string }> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-SINV-R${TS}-${rollIds.length}`,
      itemId: itemId ?? ITEM,
      initialQty: qty,
      currentQty: qty,
      qualityGrade: "1.KALITE",
      width: 150,
      status,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(r.id);
  return { id: r.id, barcode: r.barcode! };
}

/** Depo çuvalı aç + verilen topları içine okut. */
async function makeSackWith(barcodes: string[]): Promise<string> {
  const sack = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string };
  sackIds.push(sack.id);
  for (const b of barcodes) {
    await shippingService.scanIntoSack({ sackId: sack.id, barcode: b }, ADMIN);
  }
  return sack.id;
}

/** LEGACY hasar simülasyonu: guard'sız akışın yaptığı şey — statüyü çuvaldan
 *  çıkarmadan boz (raw update, servis atlanarak). Guard'lar bunu artık üretmez;
 *  ama production'da geçmişten kalmış satırlar var ve savunmalar onları yakalamalı. */
async function makeGhost(rollId: string, status: RollStatus): Promise<void> {
  // `rolls_sackId_status_present` CHECK'i eklendiği gün bu yazım imkânsız olur —
  // yardımcı kilidi o an için askıya alır (kilit yokken hiçbir şey yapmaz). Testin
  // amacı tam da kilidin ENGELLEYECEĞİ durumu üretip savunmaların onu yakaladığını
  // kanıtlamak olduğu için bu muafiyet zorunlu.
  await withSackConstraintSuspended(() =>
    prisma.roll.update({ where: { id: rollId }, data: { status } }),
  );
}

async function run(): Promise<void> {
  await setup();

  // ───────────────────────────────────────────────────────────── 1) KARTELA
  console.log("\n=== 1) Çuvaldaki top KARTELAYA gönderilemez ===");
  const r1 = await makeRoll();
  const sack1 = await makeSackWith([r1.barcode]);
  let err: unknown;
  try {
    await kartelaService.dispatch({ subcontractorId: KARTELA_FIRM, rollIds: [r1.id] }, ADMIN);
  } catch (e) {
    err = e;
  }
  check("kartela.dispatch 400 döndü", is400(err), msgOf(err).slice(0, 90));
  check("mesaj çuval kodunu içeriyor (operatör çuvalı bulabilsin)", /CV\d+/.test(msgOf(err)));
  check('mesaj yönlendirme veriyor ("Paketleme / Çuvallar")', msgOf(err).includes("Paketleme / Çuvallar"));
  const afterK = need(
    await prisma.roll.findUnique({ where: { id: r1.id }, select: { status: true, sackId: true } }),
    "r1"
  );
  check("top statüsü DEĞİŞMEDİ (WAREHOUSE)", afterK.status === RollStatus.WAREHOUSE, afterK.status);
  check("top hâlâ çuvalda (sackId korundu)", afterK.sackId === sack1);
  const kdCount = await prisma.kartelaDispatchItem.count({ where: { rollId: r1.id } });
  check("KartelaDispatch oluşMADI (tx geri sarıldı)", kdCount === 0, `${kdCount}`);

  // ───────────────────────────────────────────────────── 2) YARIŞ (claim katmanı)
  console.log("\n=== 2) Yarış: aynı topu aynı anda kartelaya + çuvala ===");
  const r2 = await makeRoll();
  const sack2 = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string };
  sackIds.push(sack2.id);
  const results = await Promise.allSettled([
    kartelaService.dispatch({ subcontractorId: KARTELA_FIRM, rollIds: [r2.id] }, ADMIN),
    shippingService.scanIntoSack({ sackId: sack2.id, barcode: r2.barcode }, ADMIN),
  ]);
  const okCount = results.filter((x) => x.status === "fulfilled").length;
  check("tam olarak BİR akış başarılı (çift-bağ yok)", okCount === 1, `${okCount} başarılı`);
  const afterRace = need(
    await prisma.roll.findUnique({ where: { id: r2.id }, select: { status: true, sackId: true } }),
    "r2"
  );
  const consistent =
    (afterRace.status === RollStatus.AT_KARTELA && afterRace.sackId === null) ||
    (afterRace.status === RollStatus.WAREHOUSE && afterRace.sackId === sack2.id);
  check(
    "son durum TUTARLI (ya kartelada+çuvalsız ya depoda+çuvalda)",
    consistent,
    `${afterRace.status} / sackId=${afterRace.sackId ? "dolu" : "null"}`
  );

  // ─────────────────────────────────────────────────── 3) TAMBUR — Top Kesme
  console.log("\n=== 3) Çuvaldaki top KESİLEMEZ (metraj/çuval kg korunur) ===");
  const r3 = await makeRoll(200);
  const sack3 = await makeSackWith([r3.barcode]);
  await shippingService.weighSack({ sackId: sack3, weightKg: 33.5 }, ADMIN);
  err = undefined;
  try {
    await tambur.cutWarehouseRoll(r3.id, { cutLength: 50 }, ADMIN);
  } catch (e) {
    err = e;
  }
  check("cutWarehouseRoll 400 döndü", is400(err), msgOf(err).slice(0, 90));
  const afterCut = need(
    await prisma.roll.findUnique({ where: { id: r3.id }, select: { currentQty: true, status: true } }),
    "r3"
  );
  check("parent metrajı DEĞİŞMEDİ (200)", Number(afterCut.currentQty) === 200, `${afterCut.currentQty}`);
  const childCount = await prisma.roll.count({ where: { parentRollId: r3.id } });
  check("çocuk top doğMADI", childCount === 0, `${childCount}`);
  const sack3After = need(
    await prisma.sack.findUnique({ where: { id: sack3 }, select: { weightKg: true } }),
    "sack3"
  );
  check("çuval brüt kg DEĞİŞMEDİ (33.5)", Number(sack3After.weightKg) === 33.5, `${sack3After.weightKg}`);

  // ──────────────────────────────────────── 4) TAMBUR — kesim finalize (arşiv)
  console.log("\n=== 4) Çuvaldaki top için Top Kesme BİTİRİLEMEZ ===");
  err = undefined;
  try {
    await tambur.finalizeWarehouseCut(r3.id, { remainingAction: "discard" }, ADMIN);
  } catch (e) {
    err = e;
  }
  check("finalizeWarehouseCut 400 döndü", is400(err), msgOf(err).slice(0, 90));
  const afterFin = need(
    await prisma.roll.findUnique({ where: { id: r3.id }, select: { status: true, sackId: true } }),
    "r3"
  );
  check(
    "top TAMBUR_CONSUMED'a çekilMEDİ (çuvalda hayalet doğmadı)",
    afterFin.status === RollStatus.WAREHOUSE && afterFin.sackId === sack3,
    afterFin.status
  );

  // ─────────────────────────────────────────────────────────── 5) FASON SEVK
  console.log("\n=== 5) Çuvaldaki HAM top FASONA gönderilemez (auto-attach kapısı) ===");
  fixture = await createManualMoveFixture(1);
  // ⚠️ Top, WO'nun `targetItemId`'siyle AYNI ürün olmalı: aksi halde ürün-uyuşmazlık
  // guard'ı (dispatch'in başında) 400 verir ve çuval guard'ına HİÇ ULAŞILMAZ — test
  // doğru sonucu yanlış sebeple alır (ilk denemede tam bu oldu).
  const woItemId = need(
    (await prisma.workOrder.findUnique({ where: { id: fixture.woId }, select: { targetItemId: true } }))
      ?.targetItemId,
    "fixture WO targetItemId"
  );
  const stockRoll = await makeRoll(120, RollStatus.STOCK, woItemId);
  const sack5 = await makeSackWith([stockRoll.barcode]);
  err = undefined;
  try {
    await fason.dispatch(
      {
        workOrderId: fixture.woId,
        stepId: need(fixture.stepIdBySeq[1], "seq1 fason adımı"),
        subcontractorId: FASON_FIRM,
        rollIds: [stockRoll.id],
      },
      ADMIN
    );
  } catch (e) {
    err = e;
  }
  check("subcontractor.dispatch 400 döndü", is400(err), msgOf(err).slice(0, 110));
  // Mesaj kontrolü ZORUNLU: dispatch'in başındaki başka guard'lar (ürün uyuşmazlığı,
  // adım tipi, parti) da 400 verir → yalnız statü koduna bakmak testi yanlış sebeple
  // yeşil gösterir. Çuval guard'ına ULAŞILDIĞINI mesaj kanıtlar.
  check(
    "reddin sebebi ÇUVAL (başka bir guard değil)",
    /bir çuvalda/.test(msgOf(err)) && msgOf(err).includes("fasona gönderilemez"),
    msgOf(err).slice(0, 110)
  );
  const afterFason = need(
    await prisma.roll.findUnique({
      where: { id: stockRoll.id },
      select: { status: true, currentStepId: true, sackId: true },
    }),
    "stockRoll"
  );
  check(
    "top STOCK + adıma bağlanMADI + çuvalda kaldı",
    afterFason.status === RollStatus.STOCK &&
      afterFason.currentStepId === null &&
      afterFason.sackId === sack5,
    `${afterFason.status} / step=${afterFason.currentStepId ?? "null"}`
  );

  // ────────────────────────────── 6) SEVKİYAT KURULUMU — legacy hayalet bloklu
  console.log("\n=== 6) Hayalet içeren çuvalla SEVKİYAT KURULAMAZ ===");
  const rg = await makeRoll(80);
  const ghostSack = await makeSackWith([rg.barcode]);
  await makeGhost(rg.id, RollStatus.AT_KARTELA); // legacy hasar simülasyonu
  err = undefined;
  try {
    await shippingService.createShipment({ sackIds: [ghostSack], customerId: CUSTOMER }, ADMIN);
  } catch (e) {
    err = e;
  }
  check("createShipment 400 döndü", is400(err), msgOf(err).slice(0, 110));
  check("mesaj çuval kodu + statüyü söylüyor", /CV\d+/.test(msgOf(err)) && msgOf(err).includes("AT_KARTELA"));
  const shipCount = await prisma.shipment.count({ where: { customerId: CUSTOMER } });
  check("sevkiyat oluşMADI", shipCount === 0, `${shipCount}`);

  // ────────────────────── 7) SEVK ONAYI — PLANNED sevkiyat dispatch'te bloklu
  console.log("\n=== 7) Hayalet PLANNED sevkiyata sonradan girdiyse SEVK EDİLEMEZ ===");
  prevConf = (
    await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } })
  )?.value;
  await prisma.systemSetting.upsert({
    where: { key: CONF_KEY },
    create: { key: CONF_KEY, value: "true" },
    update: { value: "true" },
  });
  const rp = await makeRoll(60);
  const plannedSack = await makeSackWith([rp.barcode]);
  const created = (
    await shippingService.createShipment({ sackIds: [plannedSack], customerId: CUSTOMER }, ADMIN)
  ).data as { id: string; status: string; dispatched: boolean };
  shipmentIds.push(created.id);
  check("sevkiyat PLANNED kuruldu (onay açık)", created.status === ShipmentStatus.PLANNED, created.status);
  // Sevkiyat kurulduktan SONRA statü bozulursa (yarış artığı / legacy) dispatch
  // guard'ı son savunmadır.
  await makeGhost(rp.id, RollStatus.TAMBUR_CONSUMED);
  err = undefined;
  try {
    await shippingService.dispatchShipment(created.id, {}, ADMIN);
  } catch (e) {
    err = e;
  }
  check("dispatchShipment 400 döndü", is400(err), msgOf(err).slice(0, 110));
  const shipAfter = need(
    await prisma.shipment.findUnique({ where: { id: created.id }, select: { status: true } }),
    "shipment"
  );
  check("sevkiyat PLANNED kaldı (tx geri sarıldı)", shipAfter.status === ShipmentStatus.PLANNED, shipAfter.status);
  const rollAfterDispatch = need(
    await prisma.roll.findUnique({ where: { id: rp.id }, select: { status: true } }),
    "rp"
  );
  check(
    "hayaletin statüsü SHIPPED'e EZİLMEDİ (kanıt korundu)",
    rollAfterDispatch.status === RollStatus.TAMBUR_CONSUMED,
    rollAfterDispatch.status
  );
  const frozen = await prisma.printedDocument.count({ where: { sourceId: created.id } });
  check("resmi belge DONMADI", frozen === 0, `${frozen}`);

  // ───────────────────── 8) ÜÇ YÜZEY AYNI SAYIYI BASAR (etiket/liste/belge)
  console.log("\n=== 8) Etiket · liste · belge AYNI top adedini basar ===");
  const a1 = await makeRoll(100);
  const a2 = await makeRoll(100);
  const a3 = await makeRoll(100);
  const mixedSack = await makeSackWith([a1.barcode, a2.barcode, a3.barcode]);
  await makeGhost(a3.id, RollStatus.AT_KARTELA); // 3 toptan 1'i hayalet → 2 sayılmalı
  const labelRes = await labels.getSackLabel(mixedSack);
  const labelPayload = labelRes.data as { rollCount?: number; lengthMeters?: number };
  check("etiket rollCount = 2", labelPayload.rollCount === 2, `${labelPayload.rollCount}`);
  check("etiket metraj = 200", Number(labelPayload.lengthMeters) === 200, `${labelPayload.lengthMeters}`);
  const listRes = await search.searchSacks({ sackCode: undefined, customerId: CUSTOMER });
  const listRow = (listRes.data as Array<{ id: string; rollCount: number; totalQty: number }>).find(
    (x) => x.id === mixedSack
  );
  check("liste rollCount = 2 (etiketle aynı)", listRow?.rollCount === 2, `${listRow?.rollCount}`);
  check("liste totalQty = 200", Number(listRow?.totalQty) === 200, `${listRow?.totalQty}`);
  const pickRes = await search.getPickList([mixedSack]);
  const pickRow = (pickRes.data as Array<{ rollCount: number; totalQty: number }>)[0];
  check("çeki listesi rollCount = 2", pickRow?.rollCount === 2, `${pickRow?.rollCount}`);

  // ───────────────────────────── 9) KAÇIŞ YOLU — operatör hayaleti görüp çıkarır
  console.log("\n=== 9) Kaçış yolu: hayalet GÖRÜNÜR ve çıkarılabilir ===");
  const contents = (await search.getSackContents(mixedSack)).data as {
    rolls: Array<{ id: string; status?: string }>;
  };
  check(
    "çuval dökümü hayaleti HÂLÂ gösteriyor (3 top)",
    contents.rolls.length === 3,
    `${contents.rolls.length}`
  );
  const ghostRow = contents.rolls.find((r) => r.id === a3.id);
  check("dökümde statü alanı var (istemci rozetleyebilir)", ghostRow?.status === "AT_KARTELA", `${ghostRow?.status}`);
  await shippingService.weighSack({ sackId: mixedSack, weightKg: 12.3 }, ADMIN);
  await shippingService.removeRollFromSack({ rollId: a3.id }, ADMIN);
  const freed = need(
    await prisma.roll.findUnique({ where: { id: a3.id }, select: { sackId: true, status: true } }),
    "a3"
  );
  check("removeRollFromSack başarılı (sackId null)", freed.sackId === null);
  check("statü KORUNDU (top gerçekten kartelada)", freed.status === RollStatus.AT_KARTELA, freed.status);
  const mixedAfter = need(
    await prisma.sack.findUnique({ where: { id: mixedSack }, select: { weightKg: true } }),
    "mixedSack"
  );
  check("içerik değişti → çuval kg sıfırlandı (bayat kg irsaliyeye gitmez)", mixedAfter.weightKg === null);

  // ─────────────────── 10) §7 teşhis sorgusu hayaleti bulur, onarım sonrası boş
  console.log("\n=== 10) consistency-check §7 sorgusu ===");
  const ghostRows = await prisma.$queryRaw<{ roll_id: string }[]>`
    SELECT r.id AS roll_id
    FROM rolls r JOIN sacks s ON s.id = r."sackId"
    WHERE r.status IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR',
                       'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED')
      AND s."customerId" = ${CUSTOMER}::uuid`;
  // rg (senaryo 6) + rp (senaryo 7) hâlâ çuvalda; a3 (senaryo 9) çıkarıldı.
  check("§7 kalan hayaletleri buluyor (2 satır)", ghostRows.length === 2, `${ghostRows.length} satır`);
  check("çıkarılan hayalet §7'de YOK", !ghostRows.some((x) => x.roll_id === a3.id));
}

async function teardown(): Promise<void> {
  try {
    if (prevConf === undefined) {
      await prisma.systemSetting.deleteMany({ where: { key: CONF_KEY } });
    } else {
      await prisma.systemSetting.update({
        where: { key: CONF_KEY },
        // Json kolonda JS `null` kabul edilmez → `Prisma.JsonNull`.
        data: { value: prevConf === null ? Prisma.JsonNull : prevConf },
      });
    }
  } catch {
    /* ayar geri alınamadıysa sessiz geç — test verisi değil */
  }
  await prisma.sackAllocation.deleteMany({ where: { sack: { customerId: CUSTOMER } } });
  await prisma.roll.updateMany({
    where: { id: { in: rollIds } },
    data: { sackId: null, shipmentId: null, currentStepId: null },
  });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  await prisma.sack.deleteMany({ where: { customerId: CUSTOMER } });
  await prisma.shipment.deleteMany({ where: { customerId: CUSTOMER } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  if (fixture) await fixture.teardown();
  await prisma.item.deleteMany({ where: { id: ITEM } });
  await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

run()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    // pool.end(): lib/prisma idleTimeoutMillis=600_000 ile idle handle tutar →
    // $disconnect tek başına süreci çıkarmaz.
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
