// =============================================================================
// BEKÇİ — BELGEYE DÖNÜŞ BAĞLARI + SESSİZCE YOK SAYILAN TARİH FİLTRELERİ
// =============================================================================
// Çalıştırma: npx tsx scripts/test_ticaret_links_and_filters.ts
//
// NEDEN VAR (2026-08-15 saha taraması — "çıkmaz-akış" + "filtresiz-liste"
// mercekleri). Dört bulgu, ikisi BAĞ ikisi FİLTRE:
//
//  ⑥a EKSTRE SATIRINDAN BELGEYE GİDİLEMİYORDU: `cari.statement` satırı yalnız
//      `docNo` (düz metin) taşıyordu; muhasebecinin en sık sorusu ("bu satır
//      hangi fatura?") Faturalar ekranında elle aramayı gerektiriyordu.
//  ⑥b "FATURALA (İÇ)" DÜĞMESİ YANLIŞ ALANA BAKIYORDU: panel yüklemi
//      `Shipment.invoiceNo`ya bakıyor, o alan ise DIŞ muhasebe programındaki
//      belgenin izidir ("ERP fatura KESMEZ", schema.prisma). İç bağ
//      `Invoice.shipmentId`dir. İki yönlü yanlış: iç taslak varken düğme
//      çıkıp `assertSourceFree` 409'u yediriyor (emek çöpe), dış numarası
//      işaretlenmiş sevkiyatta ise iç faturalama yolu HİÇ görünmüyordu.
//      Liste artık `invoices {id, docNo, status}` taşır.
//  ⑦a MAL KABUL + DEPO TRANSFERİ listelerinde `applyDateRange` HİÇ
//      çağrılmıyordu → `dateFrom` gönderen istemci filtresinin çalıştığını
//      sanıyor, liste TAM dönüyordu (sessiz YANLIŞ cevap — boş liste değil).
//  ⑦b KUR listesinde `dateFields` tanımsızdı → aynı sessiz yok sayma.
//      "15 Temmuz'daki EUR kuru neydi" (fatura kuru itirazlarının sorusu)
//      cevaplanamıyordu.
//
// ÖLÇÜLENLER:
//   §1 Ekstre satırı `invoiceId` / `paymentId` taşıyor (fatura ve tahsilat
//      satırı AYRI AYRI) · ilgisiz satırda alanlar `null`
//   §2 ⭐ `listShipments` iç fatura bağını taşıyor · İPTAL EDİLMİŞ fatura
//      listede GÖRÜNMEZ (`assertSourceFree` ile AYNI süzgeç — ayrışırlarsa
//      panel "faturası var" der, uç yeni faturayı kabul eder)
//   §3 Mal kabul listesi tarih aralığıyla SÜZÜLÜYOR (ve `dateField`siz istek
//      bugünküyle aynı sonucu veriyor — sözleşme korunuyor)
//   §4 Depo transferi listesi tarih aralığıyla SÜZÜLÜYOR
//   §5 Kur listesi `rateDate` aralığıyla SÜZÜLÜYOR (§5b) · ⭐⭐ panelin GERÇEK
//      sınır sözleşmesiyle — YEREL gece yarısı — bir gün geriye AÇMIYOR (§5c) ·
//      `DATE_ONLY_COLUMNS` şemadaki `@db.Date` kümesiyle iki yönlü uyumlu (§5d)
//   §6 Körlük zemini
//
// ⚠️⚠️ §5c NEDEN EKLENDİ (2026-08-15, ikinci tur). §5b sınırları UTC gece
// yarısıyla kuruyordu; panel ise YEREL gece yarısı yolluyor ve `rateDate`
// `@db.Date` olduğu için Prisma karşılaştırmayı UTC gün-parçasına indiriyor →
// Istanbul'da alt sınır BİR GÜN GERİYE açılıyordu (ölçüldü: komşu iki günde
// dateFrom=(D+1) yerel 00:00 → İKİ satır). Yani bekçi filtrenin ÇALIŞTIĞINI
// doğruluyor ama YANLIŞ GÜNDEN başladığını göremiyordu.
// ⚠️ §5c'nin fixture'ı **komşu iki gün** olmak zorunda: §5a/§5b'nin 30 gün
// aralıklı satırlarıyla kontrol KÖR kalır (ilk yazımda tam bu oldu — negatif
// sonda yeşil döndü). Ölçülen şey ±1 gündür; fixture de ±1 gün olmalı.
//
// NEGATİF SONDALAR (2026-08-15 — DÖRDÜ BİRDEN koşuldu, **16/0 → 10 geçti/6
// başarısız**, dosyalar shasum ile birebir geri yüklendi):
//   • `cari.service` satır çıktısındaki `invoiceId`/`paymentId` `null`landı →
//     ❌ §1a · ❌ §1b (⚠️ §1c/§1d YEŞİL KALIR ve bu DOĞRUDUR: onlar "alanlar
//     karışmıyor / belgesizde null" der, sonda da null üretir — o iki kontrol
//     tek başına yeterli DEĞİLDİR, asıl kanıt §1a/§1b'dir).
//   • `shipping.service` liste select'inden `invoices` düşürüldü → ❌ §2a ·
//     ❌ §2c.
//   • `goods-receipt.service.list`ten `applyDateRange` çağrısı silindi →
//     ❌ §3b (aralık dışı ESKİ fiş listede kaldı: total=2).
//   • `finance.routes`taki kur servisinden `dateFields` silindi → ❌ §5b
//     (aralık sessizce yok sayıldı: 2 satır).
//   • (ikinci tur) `applyDateRange`teki gün-yalnız çevirimi kapatıldı
//     (`const dateOnly = false`) → ❌ §5c (2 satır: önceki gün sızdı).
//     ⚠️ Aynı sonda §5a/§5b'yi YEŞİL bırakır — kör noktanın kanıtı.
//   • §5d2 gerçek bir açık YAKALADI: şemadaki `periodEnd` (`@db.Date`, iki
//     modelde) listede yoktu; bekçi kırmızı verdi, liste tamamlandı.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { InvoiceStatus, InvoiceType, PrintedDocType, RollStatus } from "@prisma/client";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { DATE_ONLY_COLUMNS } from "../src/utils/query-parser";
import { factoryDayStart } from "../src/constants/time";
import { cariService } from "../src/services/cari.service";
import { shippingService } from "../src/services/shipping.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { InventoryService } from "../src/services/inventory.service";
import { exchangeRateService } from "../src/routes/finance.routes";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

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

const fakeReq = (query: Record<string, string>): Request => ({ query }) as unknown as Request;

const TAG = `TEST-LNK-${Date.now()}`;
const customerIds: string[] = [];
const cariIds: string[] = [];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const shipmentIds: string[] = [];
const receiptIds: string[] = [];
const transferIds: string[] = [];
const warehouseIds: string[] = [];
const rollIds: string[] = [];
const itemIds: string[] = [];
const rateIds: string[] = [];
const cashBoxIds: string[] = [];

const DAY = 86_400_000;

async function main(): Promise<void> {
  console.log("=== Belgeye dönüş bağları + tarih filtreleri bekçisi ===\n");

  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok.");
  const item = await prisma.item.create({
    data: { code: `${TAG}-ITM`, name: `${TAG} KUMAŞ`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemIds.push(item.id);
  const customer = await prisma.customer.create({
    data: { code: `${TAG}-CST`, name: `${TAG} MÜŞTERİ`, type: "CUSTOMER" },
    select: { id: true },
  });
  customerIds.push(customer.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cariIds.push(cari.id);

  // ── §1 EKSTRE SATIRI → BELGE ────────────────────────────────────────────
  // Defter satırları DOĞRUDAN yazılır: ölçülen şey `statement`in SEÇTİĞİ
  // alanlar, fatura/tahsilat onay zinciri değil (o `test_finance_invoice` ve
  // `test_payment_allocation`ın işi).
  const inv = await prisma.invoice.create({
    data: {
      docNo: `${TAG}-SF`,
      type: InvoiceType.SALES,
      status: InvoiceStatus.CONFIRMED,
      cariId: cari.id,
      currency: "TRY",
      issueDate: new Date(),
      subtotal: "100.00",
      grandTotal: "100.00",
      grandTotalTry: "100.00",
      confirmedAt: new Date(),
    },
    select: { id: true },
  });
  invoiceIds.push(inv.id);
  // ⚠️ `payments_account_xor` CHECK'i kasa/banka'dan TAM BİRİNİ ister — tahsilat
  // bir paranın nereye girdiğini söylemek zorundadır.
  const cashBox = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(cashBox.id);
  const pay = await prisma.payment.create({
    data: {
      docNo: `${TAG}-TH`,
      direction: "IN",
      method: "CASH",
      status: "ACTIVE",
      cashBoxId: cashBox.id,
      cariId: cari.id,
      currency: "TRY",
      amount: "40.00",
      amountTry: "40.00",
      paymentDate: new Date(),
    },
    select: { id: true },
  });
  paymentIds.push(pay.id);

  const now = new Date();
  await prisma.cariTransaction.createMany({
    data: [
      {
        cariId: cari.id,
        currency: "TRY",
        txnDate: now,
        sourceType: "INVOICE",
        invoiceId: inv.id,
        description: "fatura satırı",
        debit: "100.00",
        credit: "0.00",
      },
      {
        cariId: cari.id,
        currency: "TRY",
        txnDate: now,
        sourceType: "PAYMENT",
        paymentId: pay.id,
        description: "tahsilat satırı",
        debit: "0.00",
        credit: "40.00",
      },
      {
        cariId: cari.id,
        currency: "TRY",
        txnDate: now,
        sourceType: "ADJUSTMENT",
        description: "elle düzeltme",
        debit: "5.00",
        credit: "0.00",
      },
    ],
  });

  const stmt = await cariService.statement({
    cariId: cari.id,
    currency: "TRY",
    from: new Date(now.getTime() - DAY),
    to: new Date(now.getTime() + DAY),
  });
  const rows = stmt.data!.rows;
  const invRow = rows.find((r) => r.sourceType === "INVOICE");
  const payRow = rows.find((r) => r.sourceType === "PAYMENT");
  const manRow = rows.find((r) => r.sourceType === "ADJUSTMENT");
  check("§1a ⭐ Fatura satırı `invoiceId` taşıyor", invRow?.invoiceId === inv.id, String(invRow?.invoiceId));
  check("§1b ⭐ Tahsilat satırı `paymentId` taşıyor", payRow?.paymentId === pay.id, String(payRow?.paymentId));
  check(
    "§1c Alanlar KARIŞMIYOR (fatura satırında paymentId null, tersi de)",
    invRow?.paymentId === null && payRow?.invoiceId === null,
    `inv.paymentId=${invRow?.paymentId} pay.invoiceId=${payRow?.invoiceId}`,
  );
  check(
    "§1d Belgesiz satırda ikisi de null (devir/elle düzeltme)",
    manRow?.invoiceId === null && manRow?.paymentId === null,
    `${manRow?.invoiceId}/${manRow?.paymentId}`,
  );

  // ── §2 SEVKİYAT LİSTESİ → İÇ FATURA ─────────────────────────────────────
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `${TAG}-SVK`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "DOMESTIC",
      dispatchedAt: new Date(),
      // ⚠️ DIŞ muhasebe izi DOLU: eski yüklem tam da bu satırda düğmeyi
      // gizliyordu. İç bağın ondan BAĞIMSIZ olduğu burada ölçülür.
      invoiceNo: "DIS-MUHASEBE-2026-001",
      invoicedAt: new Date(),
    },
    select: { id: true, shipmentNo: true },
  });
  shipmentIds.push(shipment.id);
  const shipInv = await prisma.invoice.create({
    data: {
      docNo: `${TAG}-SF2`,
      type: InvoiceType.SALES,
      status: InvoiceStatus.DRAFT,
      cariId: cari.id,
      currency: "TRY",
      issueDate: new Date(),
      shipmentId: shipment.id,
    },
    select: { id: true, docNo: true },
  });
  invoiceIds.push(shipInv.id);

  type ShipRow = {
    shipmentNo: string;
    invoiceNo: string | null;
    invoices?: Array<{ id: string; docNo: string; status: InvoiceStatus }>;
  };
  const listShip = async (): Promise<ShipRow | undefined> => {
    const res = (await shippingService.listShipments(fakeReq({ customerId: customer.id }))) as unknown as {
      data: ShipRow[];
    };
    return res.data.find((r) => r.shipmentNo === shipment.shipmentNo);
  };
  const row1 = await listShip();
  check(
    "§2a ⭐ Liste iç fatura bağını taşıyor (docNo + durum)",
    row1?.invoices?.length === 1 && row1.invoices[0]!.id === shipInv.id && row1.invoices[0]!.status === InvoiceStatus.DRAFT,
    JSON.stringify(row1?.invoices),
  );
  check(
    "§2b Dış muhasebe izi (`invoiceNo`) AYRI alan olarak duruyor — iki kavram karışmıyor",
    row1?.invoiceNo === "DIS-MUHASEBE-2026-001",
    String(row1?.invoiceNo),
  );
  await prisma.invoice.update({
    where: { id: shipInv.id },
    data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() },
  });
  const row2 = await listShip();
  check(
    "§2c ⭐ İPTAL EDİLMİŞ fatura listede GÖRÜNMEZ (`assertSourceFree` ile aynı süzgeç)",
    (row2?.invoices?.length ?? -1) === 0,
    JSON.stringify(row2?.invoices),
  );

  // ── §3 MAL KABUL LİSTESİ — TARİH ARALIĞI ────────────────────────────────
  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-SUP`, name: `${TAG} TEDARİKÇİ`, type: "SUPPLIER" },
    select: { id: true },
  });
  customerIds.push(supplier.id);
  const rcptOld = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    deliveryNoteNo: `${TAG}-ESKI`,
  });
  const rcptNew = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    deliveryNoteNo: `${TAG}-YENI`,
  });
  const oldId = (rcptOld.data as { id: string }).id;
  const newId = (rcptNew.data as { id: string }).id;
  receiptIds.push(oldId, newId);
  // ⚠️ `createdAt` GERİYE alınır (10 gün): "dün girilen fişi bugünkü aralıkta
  // görmemeliyim" sorusu tam olarak budur.
  const tenDaysAgo = new Date(Date.now() - 10 * DAY);
  await prisma.goodsReceipt.update({ where: { id: oldId }, data: { createdAt: tenDaysAgo } });

  const grAll = await goodsReceiptService.list({ page: 1, pageSize: 100, filters: {}, search: TAG });
  check("§3a Ön koşul: filtresiz listede iki fiş de var", grAll.total === 2, `total=${grAll.total}`);
  const grRange = await goodsReceiptService.list({
    page: 1,
    pageSize: 100,
    filters: {},
    search: TAG,
    dateField: "createdAt",
    dateFrom: new Date(Date.now() - 2 * DAY),
    dateTo: new Date(Date.now() + DAY),
  });
  check("§3b ⭐ Son 2 gün aralığı ESKİ fişi eledi", grRange.total === 1, `total=${grRange.total}`);
  const grNoField = await goodsReceiptService.list({
    page: 1,
    pageSize: 100,
    filters: {},
    search: TAG,
    // ⚠️ `dateField` YOK — `applyDateRange` sözleşmesi gereği aralık YOK SAYILIR
    // (sessiz ama BİLİNÇLİ: whitelist dışı alan filtreyi düşürmez, uygulamaz).
    dateFrom: new Date(Date.now() - 2 * DAY),
  });
  check("§3c `dateField`siz istek bugünküyle aynı (sözleşme korunuyor)", grNoField.total === 2, `total=${grNoField.total}`);
  const grBadField = await goodsReceiptService.list({
    page: 1,
    pageSize: 100,
    filters: {},
    search: TAG,
    dateField: "cancelledAt", // whitelist DIŞI
    dateFrom: new Date(Date.now() - 2 * DAY),
  });
  check("§3d Whitelist dışı `dateField` yok sayıldı (sorgu düşmüyor)", grBadField.total === 2, `total=${grBadField.total}`);

  // ── §4 DEPO TRANSFERİ LİSTESİ — TARİH ARALIĞI ───────────────────────────
  const whA = await prisma.warehouse.create({ data: { code: `${TAG}-WA`, name: `${TAG} A` }, select: { id: true } });
  const whB = await prisma.warehouse.create({ data: { code: `${TAG}-WB`, name: `${TAG} B` }, select: { id: true } });
  warehouseIds.push(whA.id, whB.id);
  const mkRoll = async (warehouseId: string, qty: number): Promise<string> => {
    const res = await inventory.createInitialEntry({ itemId: item.id, initialQty: qty }, undefined, undefined, false, {
      warehouseId,
      forcedStatus: RollStatus.WAREHOUSE,
    });
    const id = (res.data as { id: string }).id;
    rollIds.push(id);
    return id;
  };
  const t1 = await warehouseTransferService.create({
    fromWarehouseId: whA.id,
    toWarehouseId: whB.id,
    rollIds: [await mkRoll(whA.id, 10)],
    notes: `${TAG}-T1`,
  });
  const t2 = await warehouseTransferService.create({
    fromWarehouseId: whA.id,
    toWarehouseId: whB.id,
    rollIds: [await mkRoll(whA.id, 11)],
    notes: `${TAG}-T2`,
  });
  const t1Id = (t1.data as { id: string }).id;
  const t2Id = (t2.data as { id: string }).id;
  transferIds.push(t1Id, t2Id);
  await prisma.warehouseTransfer.update({ where: { id: t1Id }, data: { createdAt: tenDaysAgo } });

  const trAll = await warehouseTransferService.list({ page: 1, pageSize: 100, filters: {}, search: TAG });
  check("§4a Ön koşul: filtresiz listede iki transfer de var", trAll.total === 2, `total=${trAll.total}`);
  const trRange = await warehouseTransferService.list({
    page: 1,
    pageSize: 100,
    filters: {},
    search: TAG,
    dateField: "createdAt",
    dateFrom: new Date(Date.now() - 2 * DAY),
    dateTo: new Date(Date.now() + DAY),
  });
  check("§4b ⭐ Son 2 gün aralığı ESKİ transferi eledi", trRange.total === 1, `total=${trRange.total}`);

  // ── §5 KUR LİSTESİ — `rateDate` ARALIĞI ─────────────────────────────────
  // ⚠️ `rateDate` `@db.Date`tir → fixture GÜN bazında kurulur (UTC gece yarısı),
  // yoksa "aynı gün" karşılaştırması saat farkıyla kayar.
  const dayKey = (offsetDays: number): Date => {
    const d = new Date(Date.now() + offsetDays * DAY);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };
  // Var olan satırı EZMEZ (fabrikanın gerçek kuru olabilir): yalnız uzak
  // gelecekteki iki güne yazar ve yalnız kendi yarattığını siler.
  const farA = dayKey(400);
  const farB = dayKey(430);
  for (const [d, rate] of [
    [farA, "11.111111"],
    [farB, "22.222222"],
  ] as const) {
    const row = await prisma.exchangeRate.upsert({
      where: { rateDate_currency: { rateDate: d, currency: "GBP" } },
      update: {},
      create: { rateDate: d, currency: "GBP", rate, source: "MANUAL" },
      select: { id: true, createdAt: true, rate: true },
    });
    if (String(row.rate) === rate) rateIds.push(row.id);
  }
  // ⚠️ GERÇEK servis örneği kullanılır (`finance.routes`ten export): bekçi
  // kendi `BaseService`ini kursaydı, route'tan `dateFields` silindiğinde
  // YEŞİL kalırdı — koruduğu şeyi göremeyen bekçi süstür.
  const rateCount = async (query: Record<string, string>): Promise<number> => {
    const res = (await exchangeRateService.findAll(
      fakeReq({ "filter[currency]": "GBP", pageSize: "200", ...query }),
    )) as {
      data: Array<{ rateDate: Date }>;
    };
    return res.data.filter((r) => {
      const t = new Date(r.rateDate).getTime();
      return t === farA.getTime() || t === farB.getTime();
    }).length;
  };
  check("§5a Ön koşul: iki uzak-gelecek kuru listede", (await rateCount({})) === 2);
  const narrowed = await rateCount({
    dateField: "rateDate",
    dateFrom: dayKey(420).toISOString(),
    dateTo: dayKey(440).toISOString(),
  });
  check("§5b ⭐ `rateDate` aralığı süzdü (sessizce yok sayılmıyor)", narrowed === 1, `${narrowed} satır`);

  // ── §5c ⭐⭐ PANELİN GERÇEK SINIR SÖZLEŞMESİ: YEREL GECE YARISI ──────────
  // ⚠️ BU BÖLÜM §5b'nin KÖR NOKTASINI KAPATIR. §5b sınırları UTC gece yarısıyla
  // kuruyor; panel ise (`Cheques/dates.dayStartIso`, `useReportDateRange`)
  // YEREL gece yarısını yolluyor ve o, Istanbul'da bir ÖNCEKİ günün 21:00Z'sidir.
  // `rateDate` `@db.Date` olduğu için Prisma karşılaştırmayı UTC gün-parçasına
  // indirger → alt sınır BİR GÜN GERİYE açılır. Ölçüldü (düzeltmeden önce):
  // komşu iki güne yazılmış kurda `dateFrom = (D+1) yerel 00:00` sorgusu
  // İKİSİNİ birden döndürüyordu. Muhasebeci "1–31 Ağustos" seçince listede
  // 31 Temmuz kuru çıkıyordu — hata yok, log yok.
  //
  // ⚠️ FİXTURE **KOMŞU İKİ GÜN** OLMAK ZORUNDA. §5a/§5b'nin 30 gün aralıklı
  // satırlarıyla bu kontrol KÖR kalır: bir günlük kayma, 30 gün öteden
  // hiçbir satırı içeri almaz (ilk yazımda tam bu oldu — negatif sonda YEŞİL
  // döndü). Ölçülen şey "±1 GÜN"dür; fixture de ±1 gün olmalı.
  const adjA = dayKey(460);
  const adjB = dayKey(461);
  for (const [d, rate] of [
    [adjA, "33.333333"],
    [adjB, "44.444444"],
  ] as const) {
    const row = await prisma.exchangeRate.upsert({
      where: { rateDate_currency: { rateDate: d, currency: "RUB" } },
      update: {},
      create: { rateDate: d, currency: "RUB", rate, source: "MANUAL" },
      select: { id: true, rate: true },
    });
    if (String(row.rate) === rate) rateIds.push(row.id);
  }
  const adjCount = async (query: Record<string, string>): Promise<number> => {
    const res = (await exchangeRateService.findAll(
      fakeReq({ "filter[currency]": "RUB", pageSize: "200", ...query }),
    )) as { data: Array<{ rateDate: Date }> };
    return res.data.filter((r) => {
      const t = new Date(r.rateDate).getTime();
      return t === adjA.getTime() || t === adjB.getTime();
    }).length;
  };
  check("§5c0 Ön koşul: komşu iki günün kuru listede", (await adjCount({})) === 2);
  // Panelin GERÇEKTEN gönderdiği değer: seçilen günün YEREL 00:00'ı (mutlak an).
  const localMidnightIso = (utcDayKey: Date): string =>
    factoryDayStart(new Date(utcDayKey.getTime() + 12 * 3600_000)).toISOString();
  const localNarrowed = await adjCount({
    dateField: "rateDate",
    dateFrom: localMidnightIso(adjB),
  });
  check(
    "§5c ⭐⭐ YEREL gece yarısı alt sınırı bir gün geriye AÇMIYOR",
    localNarrowed === 1,
    `${localNarrowed} satır (2 = önceki gün de sızdı)`,
  );
  // Üst sınır aynası: yerel gün SONU, ertesi günü içeri almamalı.
  const localUpper = await adjCount({
    dateField: "rateDate",
    dateTo: new Date(factoryDayStart(new Date(adjA.getTime() + 12 * 3600_000)).getTime() + 86_400_000 - 1).toISOString(),
  });
  check(
    "§5c2 YEREL gün sonu üst sınırı ertesi günü İÇERİ ALMIYOR",
    localUpper === 1,
    `${localUpper} satır`,
  );

  // ── §5d `DATE_ONLY_COLUMNS` ŞEMAYLA UYUMLU MU (mekanik) ─────────────────
  // Liste bir ŞEMA gerçeğini aynalar. İki yönlü denetlenir:
  //   (a) listedeki her ad şemadaki HER modelde `@db.Date` olmalı — aynı adı
  //       taşıyan bir timestamptz kolon olsaydı onun filtresi sessizce gün
  //       çözünürlüğüne inerdi;
  //   (b) şemadaki her `@db.Date` alanı listede olmalı — yeni bir gün-yalnız
  //       kolon filtrelenebilir hâle geldiğinde aynı hata sessizce geri gelir.
  const schemaSrc = fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  const dateOnlyFields = new Set<string>();
  const allDateTimeFields = new Map<string, Set<string>>(); // ad → gördüğü tip etiketleri
  let dateTimeLines = 0;
  for (const line of schemaSrc.split("\n")) {
    const m = /^\s{2}(\w+)\s+DateTime\b(.*)$/.exec(line);
    if (!m) continue;
    dateTimeLines++;
    const name = m[1] as string;
    const rest = m[2] as string;
    const kind = /@db\.Date\b/.test(rest) ? "date" : "other";
    if (kind === "date") dateOnlyFields.add(name);
    const seen = allDateTimeFields.get(name) ?? new Set<string>();
    seen.add(kind);
    allDateTimeFields.set(name, seen);
  }
  // Zemin ALAN SAYISI üzerinden (ad sayısı değil: `createdAt`/`updatedAt` her
  // modelde tekrar eder, ~54 tekil ada karşılık ~190 alan vardır). Regex bir
  // şema biçimi değişikliğiyle boşa düşerse "ihlal yok" ile "hiçbir şeye
  // bakılmadı" aynı yeşile çıkmasın.
  check(
    "§5d0 Körlük zemini: şemadan DateTime alanları okundu",
    dateTimeLines > 150 && dateOnlyFields.size >= 3,
    `${dateTimeLines} alan / ${allDateTimeFields.size} tekil ad / ${dateOnlyFields.size} gün-yalnız`,
  );
  const listed = [...DATE_ONLY_COLUMNS];
  const notDateOnly = listed.filter((n) => !dateOnlyFields.has(n) || allDateTimeFields.get(n)?.has("other"));
  check(
    "§5d1 ⭐ Listedeki her ad şemada YALNIZ `@db.Date` (ad çakışması yok)",
    notDateOnly.length === 0,
    notDateOnly.join(", "),
  );
  const missing = [...dateOnlyFields].filter((n) => !DATE_ONLY_COLUMNS.has(n));
  check(
    "§5d2 ⭐ Şemadaki her `@db.Date` alanı listede (yeni kolon sessizce kaçmıyor)",
    missing.length === 0,
    missing.join(", "),
  );

  // ── §6 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  check(
    "§6 Körlük zemini: fixture gerçekten kuruldu",
    rows.length === 3 && receiptIds.length === 2 && transferIds.length === 2 && rateIds.length >= 1,
    `ekstre=${rows.length} fiş=${receiptIds.length} transfer=${transferIds.length} kur=${rateIds.length}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (cariIds.length) await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      if (invoiceIds.length) {
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (cashBoxIds.length) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
      if (shipmentIds.length) {
        await prisma.printedDocument.deleteMany({
          where: { sourceId: { in: shipmentIds }, docType: PrintedDocType.SHIPMENT_DISPATCH },
        });
        await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      }
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (transferIds.length) {
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: transferIds } } });
        await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
      }
      if (receiptIds.length) {
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      }
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
      if (cariIds.length) {
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (rateIds.length) await prisma.exchangeRate.deleteMany({ where: { id: { in: rateIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
