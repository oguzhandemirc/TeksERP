// =============================================================================
// TEST: SEVKİYAT DAVRANIŞ BAYRAKLARI (Dilim 2 — D2/D3/D4/D5)
// Çalıştır: npx tsx scripts/test_shipping_flags.ts
// =============================================================================
// DÖRT BAYRAK, TEK VAAT: **varsayılan = BUGÜNKÜ davranış.** Bu dosyanın en
// önemli bölümü §1'dir — "kayıt yokken okuyucu ne döner" — çünkü paketin tüm
// güvenliği oraya dayanır: fabrika hiçbir şey açmadığı sürece sıfır fark.
//
//   shipping.orderRequirement        off | warn (default) | block
//   shipping.weighRequiredEnabled    false (default)
//   shipping.manualWeightRestrictedEnabled  false (default)
//   shipping.invoiceMode             dis (default) | ic | ikisi
//
// ⚠️ NEDEN AYRI BİR BEKÇİ: `test_feature_flag_contract` bayrağın DÖRT KAPIDAN
// geçtiğini ölçer (şema · servis · panel · okuyucu) ama ENFORCEMENT'a hiç
// bakmaz. Bir bayrak dört kapıda kusursuz durup hiçbir yerde okunmuyor olabilir
// — 2026-08-14 "dalga 1"in dokuz bayrağı tam bu durumdaydı ve bilinçliydi.
// Burada ölçülen şey kapının GERÇEKTEN kapanıp kapanmadığıdır.
//
// ⚠️ KAÇIŞ KAPILARI BU DOSYANIN ASIL KONUSU. Her kural için "aynı işi yapan
// İKİNCİ yol" ayrıca sınanır: `from-rolls` (Hızlı Sevk), `setShipmentOrders`
// boş dizi, `openSack` gövdesindeki kg, doğrudan sevk fatura izi. Yalnız ana
// yolu ölçen bir bekçi, bayrağı "açıldı ama işe yaramıyor" hâlde bırakır.
//
// NEGATİF SONDALAR (commit mesajında; her biri cp+md5 ile geri alındı):
//   ① `assertSacksWeighed` erken dönüşünden `!weighRequired` düşürülür → §3.1
//      kırmızı (bugünkü davranış bozuldu — yurtiçi tartısız sevk engellenir).
//   ② `destination !== EXPORT` koşulu bayrağa bağlanır → §3.6 kırmızı (ihracat
//      kuralı gevşetildi).
//   ③ Elle-tartı guard'ı `declaredSource` yerine `data.source`a bakar → §4.4
//      kırmızı (eski istemci sessizce geçer, bayrak fail-open).
//   ④ `openSack` arka kapısı guard'sız bırakılır → §4.6 kırmızı.
//   ⑤ `block` kapısı yalnız `createShipment`e konur → §2.7/§2.8 kırmızı.
//   ⑥ Hızlı Sevk uyarı üretmez → §2.10 kırmızı ("warn rejimi sahada sessiz").
//   ⑦ `ic` modunda iz KALDIRMA da engellenir → §5.3 kırmızı.
//   ⑧ `executeDirectShip`teki sipariş kapısı silinir → §2.12 kırmızı (fason
//      doğrudan sevk `block`u atlatır — 2026-09-03'te CANLI ölçülen boşluk).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { Prisma, RollStatus, ShipmentDestination, ShipmentStatus } from "@prisma/client";
import {
  SETTING_KEYS,
  readShippingOrderRequirement,
  readShippingWeighRequiredEnabled,
  readShippingManualWeightRestrictedEnabled,
  readShippingInvoiceMode,
  readShippingOrderCoverage,
} from "../src/services/system-setting.service";
import {
  assertInvoiceTraceAllowed,
  invoiceTraceWarning,
} from "../src/services/helpers/shipping-invoice-mode.helper";

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
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

interface Hata {
  statusCode?: number;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}
/** Hatayı YUTMADAN yakala — `statusCode` + makine-okunur `code` birlikte ölçülür. */
async function hataOf(fn: () => Promise<unknown>): Promise<Hata | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as Record<string, unknown> | undefined;
      return {
        statusCode: e.statusCode,
        message: e.message,
        code: typeof d?.code === "string" ? d.code : undefined,
        details: d,
      };
    }
    return { message: String(e) };
  }
}

const TS = Date.now().toString().slice(-6);
const SACK_PREFIX = `TST-SFLG-${TS}-`;

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
/** §7 kapsama bölümünün yarattığı siparişler — teardown FK sırasına göre siler. */
const orderIdsToClean: string[] = [];
/** §2.12 (fason doğrudan sevk ikizi) fixture izleri — teardown bunları toplar. */
const fasonWoIds: string[] = [];
const fasonDispatchIds: string[] = [];
const subService = new SubcontractorService();

/** Bayrakların ÖNCEKİ değerleri — teardown birebir geri yükler. */
const FLAG_KEYS = [
  SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT,
  SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED,
  SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED,
  SETTING_KEYS.SHIPPING_INVOICE_MODE,
  // ⚠️ SEVK ONAYI da bu dosyada DEĞİŞTİRİLİYOR (§2.10 "geçmişe etki yok" ve
  // §3.4 "PLANNED sevkiyata çuval ekle" senaryoları PLANNED sevkiyat ister).
  // Listeye girmezse bir sonraki koşum BAŞKA bir rejimde başlar ve §2.x'in
  // yarısı sessizce farklı bir şeyi ölçer.
  SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
] as const;
const prevFlags = new Map<string, Prisma.JsonValue | undefined>();

async function setFlag(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Dolu (ve istenirse tartılı) bir DEPO çuvalı üretir. */
async function makeSack(qty = 100, weigh = false): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-SFLG-R${TS}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(roll.id);
  const sack = (
    await shippingService.openSack(
      { customerId: CUSTOMER, sackNo: `${SACK_PREFIX}${sackIds.length}` },
      ADMIN,
    )
  ).data as { id: string };
  sackIds.push(sack.id);
  await shippingService.scanIntoSack({ sackId: sack.id, barcode: roll.barcode! }, ADMIN);
  if (weigh) {
    await shippingService.weighSack({ sackId: sack.id, weightKg: 25, source: "MANUAL" }, ADMIN);
  }
  return sack.id;
}

type CreateOpts = {
  orderIds?: string[];
  orderless?: boolean;
  destination?: ShipmentDestination;
};
async function kurSevkiyat(sackId: string, opts: CreateOpts = {}) {
  const res = await shippingService.createShipment(
    {
      sackIds: [sackId],
      customerId: CUSTOMER,
      orderIds: opts.orderIds,
      orderless: opts.orderless,
      destination: opts.destination,
    },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  shipmentIds.push(id);
  return { id, warnings: res.warnings ?? [] };
}

async function run(): Promise<void> {
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin",
  ).id;
  CUSTOMER = (
    await prisma.customer.create({
      data: { code: `TEST-SFLG-C-${TS}`, name: `Sevk Bayrak Musteri ${TS}` },
      select: { id: true },
    })
  ).id;
  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-SFLG-I-${TS}`, name: `Sevk Bayrak Urun ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  for (const k of FLAG_KEYS) {
    prevFlags.set(
      k,
      (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §1 — VARSAYILAN = BUGÜNKÜ DAVRANIŞ (ortam verisinden BAĞIMSIZ ölçüm)
  // ═══════════════════════════════════════════════════════════════════════════
  // ⚠️ CANLI DB'YE BAKILMAZ: sahte "kayıt yok" istemcisiyle çağrılır. Birinin
  // panelden açtığı bir dev kurulumunda canlı okuma sahte kırmızı verirdi ve
  // bekçi tam da en önemli vaadi ölçemez hâle gelirdi.
  console.log("\n=== §1: kayıt YOKKEN varsayılan = bugünkü davranış ===");
  const bosIstemci = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  check(
    "§1.1: orderRequirement varsayılanı 'warn' (siparişsiz sevk KURULUR, uyarı döner)",
    (await readShippingOrderRequirement(bosIstemci)) === "warn",
  );
  check(
    "§1.2: weighRequiredEnabled varsayılanı false (yalnız ihracat tartı ister)",
    (await readShippingWeighRequiredEnabled(bosIstemci)) === false,
  );
  check(
    "§1.3: manualWeightRestrictedEnabled varsayılanı false (elle kg herkeste)",
    (await readShippingManualWeightRestrictedEnabled(bosIstemci)) === false,
  );
  check(
    "§1.4: invoiceMode varsayılanı 'dis' (elle fatura izi serbest)",
    (await readShippingInvoiceMode(bosIstemci)) === "dis",
  );

  // Kod sigortası — DB'de çöp değer varken de varsayılana düşülür.
  const copIstemci = {
    systemSetting: { findUnique: () => Promise.resolve({ value: "BLOCK" }) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  check(
    "§1.5: ÇÖP değer ('BLOCK') varsayılana düşer — elle SQL sahayı kilitleyemez",
    (await readShippingOrderRequirement(copIstemci)) === "warn",
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // §2 — shipping.orderRequirement
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== §2: sipariş bağı rejimi (off | warn | block) ===");
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "warn");

  const w1 = await kurSevkiyat(await makeSack());
  check(
    "§2.1: warn + siparişsiz → sevkiyat KURULUR ve uyarı döner (bugünkü davranış)",
    w1.warnings.length === 1 && /siparişe yazılmadı/i.test(w1.warnings[0]!),
    w1.warnings[0]?.slice(0, 60) ?? "(uyarı yok)",
  );

  const w2 = await kurSevkiyat(await makeSack(), { orderless: true });
  check(
    "§2.2: warn + `orderless: true` → uyarı SUSAR (niyet beyan edildi)",
    w2.warnings.length === 0,
    w2.warnings.join(" | ").slice(0, 60),
  );

  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-SFLG-O-${TS}`,
      customerId: CUSTOMER,
      lines: { create: [{ itemId: ITEM, quantity: 500 }] },
    },
    select: { id: true },
  });
  const w3 = await kurSevkiyat(await makeSack(), { orderIds: [order.id] });
  check("§2.3: warn + sipariş seçili → uyarı YOK", w3.warnings.length === 0);

  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "off");
  const w4 = await kurSevkiyat(await makeSack());
  check("§2.4: off + siparişsiz → sevkiyat kurulur, uyarı SUSAR", w4.warnings.length === 0);

  // ⚠️ `off` YALNIZ siparişsizlik uyarısını susturur. Önizlemenin diğer iki
  // uyarısı (fazla mal · mükerrer tahsis) farklı soruların cevabıdır ve her
  // rejimde ayakta kalmalı — diziyi topluca susturmak kırmızı tonlu mükerrer
  // sevk uyarısını da öldürürdü.
  // Fazlalık GERÇEKTEN doğsun diye talep dar tutulur (1 m istek ↔ 100 m mal):
  // aynı siparişi kullanmak allocation'ı tam kapatır ve kontrol VAKUMEN yeşile
  // düşerdi ("uyarı yok" ile "uyarı susturuldu" ayırt edilemez).
  const darOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-SFLG-O-${TS}-DAR`,
      customerId: CUSTOMER,
      lines: { create: [{ itemId: ITEM, quantity: 1 }] },
    },
    select: { id: true },
  });
  const onizlemeSack = await makeSack(100);
  const prevOff = (await shippingService.previewCreateShipment({
    sackIds: [onizlemeSack],
    customerId: CUSTOMER,
    orderIds: [darOrder.id],
  })) as { data: { warnings: string[]; totals: { surplusMeters: number } } };
  check(
    "§2.5-zemin: önizleme gerçekten FAZLA mal ölçtü (kontrol vakumen yeşil değil)",
    prevOff.data.totals.surplusMeters > 1,
    `surplus=${prevOff.data.totals.surplusMeters}`,
  );
  check(
    "§2.5: off rejiminde FAZLA MAL uyarısı ayakta (dizi topluca susturulmadı)",
    prevOff.data.warnings.some((x) => /yazılamayan/i.test(x)),
    prevOff.data.warnings.join(" | ").slice(0, 80),
  );

  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "block");
  const blockSack = await makeSack();
  const e1 = await hataOf(() => kurSevkiyat(blockSack));
  check(
    "§2.6: block + siparişsiz → 400 ORDER_REQUIRED",
    e1?.statusCode === 400 && e1?.code === "ORDER_REQUIRED",
    `${e1?.statusCode ?? "—"} / ${e1?.code ?? "—"}`,
  );
  const b2 = await kurSevkiyat(blockSack, { orderless: true });
  check(
    "§2.7: block + `orderless: true` → GEÇER (numune/fazla mal meşru; kural niyet beyanı)",
    Boolean(b2.id),
  );

  // KAÇIŞ KAPISI ①: Hızlı Sevk (`from-rolls`) — kapı orada da olmalı.
  const quickRoll = await prisma.roll.create({
    data: {
      barcode: `TEST-SFLG-QR${TS}`,
      itemId: ITEM,
      initialQty: 80,
      currentQty: 80,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(quickRoll.id);
  const e2 = await hataOf(() =>
    shippingService.createShipmentFromRolls(
      { rollIds: [quickRoll.id], customerId: CUSTOMER },
      ADMIN,
    ),
  );
  check(
    "§2.8: block + HIZLI SEVK siparişsiz → 400 ORDER_REQUIRED (kaçış kapısı ① kapalı)",
    e2?.statusCode === 400 && e2?.code === "ORDER_REQUIRED",
    `${e2?.statusCode ?? "—"} / ${e2?.code ?? "—"}`,
  );

  // KAÇIŞ KAPISI ②: kur → sonra bağı KALDIR (boş dizi).
  const e3 = await hataOf(() => shippingService.setShipmentOrders(b2.id, [], ADMIN));
  check(
    "§2.9: block + `setShipmentOrders([])` → 400 (kaçış kapısı ② kapalı)",
    e3?.statusCode === 400 && e3?.code === "ORDER_REQUIRED",
    `${e3?.statusCode ?? "—"} / ${e3?.code ?? "—"}`,
  );

  // ⭐ GEÇMİŞE ETKİ YOK (tasarım §11): bayrak açılmadan ÖNCE kurulmuş siparişsiz
  // PLANNED sevkiyatın ÇIKIŞI kilitlenmemeli — mal bina içinde kalmasın.
  await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, true);
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "warn");
  const eskiPlanli = await kurSevkiyat(await makeSack());
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "block");
  const dispatchErr = await hataOf(() => shippingService.dispatchShipment(eskiPlanli.id, {}, ADMIN));
  check(
    "⭐ §2.10: block AÇILDIKTAN sonra ESKİ siparişsiz PLANNED sevkiyat yine SEVK EDİLEBİLİR",
    dispatchErr === null,
    dispatchErr?.message?.slice(0, 70) ?? "",
  );
  await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);

  // ⭐ HIZLI SEVK UYARI ÜRETİR (2026-09-03 düzeltmesi). Öncesinde `from-rolls`
  // hiç `warnings` döndürmüyordu: "warn" rejimi tablette KOMPLE sessizdi.
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "warn");
  const quickRoll2 = await prisma.roll.create({
    data: {
      barcode: `TEST-SFLG-QR2${TS}`,
      itemId: ITEM,
      initialQty: 80,
      currentQty: 80,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(quickRoll2.id);
  const quickRes = await shippingService.createShipmentFromRolls(
    { rollIds: [quickRoll2.id], customerId: CUSTOMER },
    ADMIN,
  );
  shipmentIds.push((quickRes.data as { id: string }).id);
  check(
    "⭐ §2.11: warn + HIZLI SEVK siparişsiz → UYARI döner (iki yol ayrışmıyor)",
    (quickRes.warnings ?? []).length === 1 &&
      /siparişe yazılmadı/i.test((quickRes.warnings ?? [])[0] ?? ""),
    (quickRes.warnings ?? []).join(" | ").slice(0, 60) || "(uyarı yok)",
  );
  // ⭐ §2.12 — FASON DOĞRUDAN SEVK İKİZİ (§5.5'in `orderRequirement` aynası)
  // ---------------------------------------------------------------------------
  // Mal fabrikaya HİÇ girmeden fasondan müşteriye çıkar; `createShipment`ten
  // geçmez. Kapı oraya konmadığı sürece `block` rejimi bu yoldan sessizce
  // atlatılır — 2026-09-03'te CANLI ölçüldü: 110 m, 0 sipariş bağı, HTTP 200.
  // Kardeş bayrak `invoiceMode` bu yolu zaten kapsıyordu (§5.5); aynı muhakeme
  // bir bayrakta yapılmış, ikizinde atlanmıştı.
  const boyaSt = await prisma.station.findFirst({
    where: { code: "BOYA_FASON" },
    select: { id: true },
  });
  const kursunSt = await prisma.station.findFirst({
    where: { code: "KURSUN_KK2" },
    select: { id: true },
  });
  const boyer = await ensureTestDyeHouse();
  if (!boyaSt || !kursunSt) {
    check("§2.12-zemin: fason istasyonları (BOYA_FASON/KURSUN_KK2) bulundu", false, "seed eksik");
  } else {
    /** Fasonda bekleyen tek toplu bir sevk üretir (doğrudan sevke hazır). */
    const kurFason = async (tag: string): Promise<string> => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `IE-SFLG-${tag}-${TS}`,
          type: "STOCK_PRODUCTION",
          status: "IN_PROGRESS",
          targetItemId: ITEM,
          steps: {
            create: [
              { stationId: boyaSt.id, stepSequence: 1, status: "PENDING" },
              { stationId: kursunSt.id, stepSequence: 2, status: "PENDING" },
            ],
          },
        },
        include: { steps: { orderBy: { stepSequence: "asc" } } },
      });
      fasonWoIds.push(wo.id);
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-SFLG-F${TS}-${tag}`,
          itemId: ITEM,
          initialQty: 110,
          currentQty: 110,
          width: 150,
          status: RollStatus.STOCK,
          createdById: ADMIN,
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      const d = await subService.dispatch(
        {
          workOrderId: wo.id,
          stepId: wo.steps[0].id,
          subcontractorId: boyer.id,
          rollIds: [r.id],
        },
        ADMIN,
      );
      const dispatchId = (d.data as { id: string }).id;
      fasonDispatchIds.push(dispatchId);
      return dispatchId;
    };

    // Zemin: bayrak KAPALIYKEN (varsayılan `warn`) doğrudan sevk siparişsiz GEÇER.
    // Bu kontrol olmadan §2.12 vakumen yeşil kalabilirdi (fixture zaten patlıyorsa
    // her rejimde hata döner ve "kapı çalışıyor" sanılırdı).
    await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, null);
    const dsWarn = await kurFason("W");
    const warnErr = await hataOf(() =>
      subService.executeDirectShip(
        { dispatchId: dsWarn, reason: "Bekci zemin sevki", customerId: CUSTOMER },
        ADMIN,
      ),
    );
    check(
      "§2.12-zemin: varsayılan rejimde fason doğrudan sevk siparişsiz GEÇER (sıfır fark)",
      warnErr === null,
      warnErr?.message.slice(0, 70) ?? "",
    );

    await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "block");
    const dsBlock = await kurFason("B");
    const dsErr2 = await hataOf(() =>
      subService.executeDirectShip(
        { dispatchId: dsBlock, reason: "Bekci block sevki", customerId: CUSTOMER },
        ADMIN,
      ),
    );
    check(
      "⭐ §2.12: block + FASON DOĞRUDAN SEVK siparişsiz → 400 ORDER_REQUIRED (kaçış kapısı ③ kapalı)",
      dsErr2?.statusCode === 400 && dsErr2?.code === "ORDER_REQUIRED",
      `${dsErr2?.statusCode ?? "—"} / ${dsErr2?.code ?? "—"}`,
    );
    const kacakBelge = await prisma.directShipment.count({ where: { dispatchId: dsBlock } });
    check(
      "§2.12b: reddedilen sevkten HİÇBİR DirectShipment doğmadı (kapı tx'ten ÖNCE)",
      kacakBelge === 0,
      `${kacakBelge} belge`,
    );

    // Kaçış kapısı: niyet beyan edilirse GEÇER — fason çoğu zaman son duraktır
    // (numune / kalan mal); kaçışsız `block` bu akışı tamamen kilitlerdi.
    const dsOk = await hataOf(() =>
      subService.executeDirectShip(
        {
          dispatchId: dsBlock,
          reason: "Bekci block sevki",
          customerId: CUSTOMER,
          orderless: true,
        },
        ADMIN,
      ),
    );
    check(
      "⭐ §2.12c: block + `orderless: true` → GEÇER (fason son-durak akışı kilitlenmiyor)",
      dsOk === null,
      dsOk?.message.slice(0, 70) ?? "",
    );
  }
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, null);

  // ═══════════════════════════════════════════════════════════════════════════
  // §3 — shipping.weighRequiredEnabled
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== §3: sevk öncesi tartı zorunluluğu ===");
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  const yurticiTartisiz = await kurSevkiyat(await makeSack());
  check(
    "⭐ §3.1: bayrak KAPALI + yurtiçi TARTISIZ → sevkiyat GEÇER (sıfır-fark kanıtı)",
    Boolean(yurticiTartisiz.id),
  );

  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, true);
  const acikTartisiz = await makeSack();
  const w400 = await hataOf(() => kurSevkiyat(acikTartisiz));
  check(
    "§3.2: bayrak AÇIK + tartısız → createShipment 400 WEIGH_REQUIRED",
    w400?.statusCode === 400 && w400?.code === "WEIGH_REQUIRED",
    `${w400?.statusCode ?? "—"} / ${w400?.code ?? "—"}`,
  );
  check(
    "§3.3: hata HANGİ ÇUVAL olduğunu söylüyor (operatörün yapacağı iş budur)",
    Array.isArray(w400?.details?.sackNos) &&
      (w400!.details!.sackNos as string[]).some((x) => x.startsWith(SACK_PREFIX)),
    JSON.stringify(w400?.details?.sackNos ?? null).slice(0, 70),
  );

  // addSacksToShipment — ikinci enforcement noktası (PLANNED sevkiyata ekleme).
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, true);
  const planli = await kurSevkiyat(await makeSack(100, true));
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, true);
  const eklenecek = await makeSack();
  const addErr = await hataOf(() => shippingService.addSacksToShipment(planli.id, [eklenecek], ADMIN));
  check(
    "§3.4: bayrak AÇIK → addSacksToShipment tartısız çuvalı 400 ile reddeder",
    addErr?.statusCode === 400 && addErr?.code === "WEIGH_REQUIRED",
    `${addErr?.statusCode ?? "—"} / ${addErr?.code ?? "—"}`,
  );

  // ⭐ ETKİLEŞİM: içerik değişince kg SIFIRLANIR → sevk 400'e düşer.
  const contentRoll = await prisma.roll.create({
    data: {
      barcode: `TEST-SFLG-CR${TS}`,
      itemId: ITEM,
      initialQty: 50,
      currentQty: 50,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(contentRoll.id);
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  const etkilesimSack = await makeSack(100, true);
  const kgOnce = await prisma.sack.findUnique({
    where: { id: etkilesimSack },
    select: { weightKg: true },
  });
  await shippingService.scanIntoSack({ sackId: etkilesimSack, barcode: contentRoll.barcode! }, ADMIN);
  const kgSonra = await prisma.sack.findUnique({
    where: { id: etkilesimSack },
    select: { weightKg: true },
  });
  check(
    "§3.5a: tartılı çuvala top eklenince kg SIFIRLANIR (bayat kg belgeye gitmesin)",
    kgOnce?.weightKg != null && kgSonra?.weightKg == null,
    `${String(kgOnce?.weightKg)} → ${String(kgSonra?.weightKg)}`,
  );
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, true);
  const etkilesimErr = await hataOf(() => kurSevkiyat(etkilesimSack));
  check(
    "⭐ §3.5b: bayrak AÇIKKEN sıfırlanan tartı sevki KİLİTLER (destek çağrısı sınıfı)",
    etkilesimErr?.code === "WEIGH_REQUIRED",
    etkilesimErr?.message?.slice(0, 70) ?? "",
  );

  // ⭐ İHRACAT BAYRAKTAN BAĞIMSIZ — bayrak yalnız GENİŞLETİR, gevşetmez.
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  const ihracatSack = await makeSack();
  const expErr = await hataOf(() =>
    kurSevkiyat(ihracatSack, { destination: ShipmentDestination.EXPORT }),
  );
  check(
    "⭐ §3.6: bayrak KAPALI ama hedef İHRACAT → yine 400 (mevzuat kuralı bayraklanamaz)",
    expErr?.statusCode === 400,
    expErr?.message?.slice(0, 60) ?? "",
  );

  // Hızlı Sevk — bayrak açıkken KOMPLE kapanır (çuval görünmeden doğar).
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, true);
  const quickRoll3 = await prisma.roll.create({
    data: {
      barcode: `TEST-SFLG-QR3${TS}`,
      itemId: ITEM,
      initialQty: 60,
      currentQty: 60,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(quickRoll3.id);
  const quickWeighErr = await hataOf(() =>
    shippingService.createShipmentFromRolls({ rollIds: [quickRoll3.id], customerId: CUSTOMER }, ADMIN),
  );
  check(
    "§3.7: bayrak AÇIK → HIZLI SEVK 400 (çuval görünmeden doğar, tartılamaz)",
    quickWeighErr?.statusCode === 400 && quickWeighErr?.code === "WEIGH_REQUIRED",
    `${quickWeighErr?.statusCode ?? "—"} / ${quickWeighErr?.code ?? "—"}`,
  );

  // ⚠️ BİLİNÇLİ MUAF: `setDestination` kapısızdır (çıkış `dispatchShipment`te
  // yakalanır). "Unutulmuş kapı" sanılıp dördüncü bir kontrol EKLENMESİN diye
  // burada ADIYLA kilitlenir.
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  const destSack = await makeSack();
  const destSh = await kurSevkiyat(destSack);
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, true);
  const destErr = await hataOf(() =>
    shippingService.setDestination(destSh.id, ShipmentDestination.EXPORT, ADMIN),
  );
  check(
    "§3.8: `setDestination` BİLİNÇLİ kapısız (tartı sormaz) — çıkışta yakalanır",
    destErr === null,
    destErr?.message?.slice(0, 60) ?? "",
  );
  await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);
  await setFlag(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, null);

  // ═══════════════════════════════════════════════════════════════════════════
  // §4 — shipping.manualWeightRestrictedEnabled
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== §4: elle tartı kısıtı (YENİ İZİN KODU YOK) ===");
  const TABLET = ["mobile:tarti-paket", "mobile:sevkiyat"];
  const SEVKIYATCI = ["shipping:write"];

  await setFlag(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, false);
  const m1 = await makeSack();
  const m1Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 12.5, source: "MANUAL" }, ADMIN, undefined, {
      permissions: TABLET,
    }),
  );
  check(
    "⭐ §4.1: bayrak KAPALI → tablet operatörü elle kg GİREBİLİR (bugünkü davranış)",
    m1Err === null,
    m1Err?.message?.slice(0, 60) ?? "",
  );

  await setFlag(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, true);
  const m2Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 13.5, source: "MANUAL" }, ADMIN, undefined, {
      permissions: TABLET,
    }),
  );
  check(
    "§4.2: bayrak AÇIK + yetkisiz → 403 MANUAL_WEIGHT_RESTRICTED",
    m2Err?.statusCode === 403 && m2Err?.code === "MANUAL_WEIGHT_RESTRICTED",
    `${m2Err?.statusCode ?? "—"} / ${m2Err?.code ?? "—"}`,
  );
  const m3Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 14.5, source: "MANUAL" }, ADMIN, undefined, {
      permissions: SEVKIYATCI,
    }),
  );
  check(
    "§4.3: bayrak AÇIK + `shipping:write` → GEÇER (kaçış yolu yetkilide durur)",
    m3Err === null,
    m3Err?.message?.slice(0, 60) ?? "",
  );

  // ⭐ ESKİ İSTEMCİ SÖZLEŞMESİ: `source` opsiyoneldir ve gönderilmezse MANUAL
  // sayılır → guard `declaredSource`e BAKMALI. `data.source`a bakan bir yazım
  // undefined'ı sessizce geçirir ve bayrak fail-open olur.
  const m4Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 15.5 }, ADMIN, undefined, {
      permissions: TABLET,
    }),
  );
  check(
    "⭐ §4.4: bayrak AÇIK + `source` HİÇ gönderilmedi (eski istemci) → yine 403",
    m4Err?.statusCode === 403 && m4Err?.code === "MANUAL_WEIGHT_RESTRICTED",
    `${m4Err?.statusCode ?? "—"} / ${m4Err?.code ?? "—"}`,
  );

  // Kantar yolu AÇIK kalmalı — yoksa bayrak "hiç tartma" demek olurdu.
  const m5Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 16.5, source: "SCALE" }, ADMIN, undefined, {
      permissions: TABLET,
    }),
  );
  check(
    "§4.5: bayrak AÇIK + SCALE beyanı → GEÇER (operatör kantardan tartar)",
    m5Err === null,
    m5Err?.message?.slice(0, 60) ?? "",
  );

  // ⭐ ARKA KAPI: `openSack` gövdesindeki kg de aynı guard'dan geçmeli.
  const m6Err = await hataOf(() =>
    shippingService.openSack(
      { customerId: CUSTOMER, weightKg: 9.5, sackNo: `${SACK_PREFIX}BACKDOOR` },
      ADMIN,
      { permissions: TABLET },
    ),
  );
  check(
    "⭐ §4.6: `openSack` gövdesindeki kg ARKA KAPISI da kapalı (403)",
    m6Err?.statusCode === 403 && m6Err?.code === "MANUAL_WEIGHT_RESTRICTED",
    `${m6Err?.statusCode ?? "—"} / ${m6Err?.code ?? "—"}`,
  );
  const backdoorSack = await prisma.sack.findFirst({
    where: { sackNo: `${SACK_PREFIX}BACKDOOR` },
    select: { id: true },
  });
  check("§4.6b: arka kapı reddedildi → çuval HİÇ doğmadı", backdoorSack === null);

  // F221 — `permissions` verilmezse enforcement ATLANIR (dahili çağrı bozulmaz).
  const m7Err = await hataOf(() =>
    shippingService.weighSack({ sackId: m1, weightKg: 17.5, source: "MANUAL" }, ADMIN),
  );
  check(
    "§4.7: `permissions` verilmeyen DAHİLİ çağrı muaf (F221 deseni)",
    m7Err === null,
    m7Err?.message?.slice(0, 60) ?? "",
  );
  await setFlag(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, null);

  // ═══════════════════════════════════════════════════════════════════════════
  // §5 — shipping.invoiceMode
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== §5: fatura izi rejimi (dis | ic | ikisi) ===");
  await setFlag(SETTING_KEYS.SHIPPING_INVOICE_MODE, "dis");
  const invSh = await kurSevkiyat(await makeSack());
  const i1Err = await hataOf(() =>
    shippingService.setShipmentInvoice(invSh.id, `FT-${TS}`, null, ADMIN),
  );
  check("§5.1: dis → elle fatura izi YAZILIR (bugünkü davranış)", i1Err === null, i1Err?.message ?? "");

  await setFlag(SETTING_KEYS.SHIPPING_INVOICE_MODE, "ic");
  const i2Err = await hataOf(() =>
    shippingService.setShipmentInvoice(invSh.id, `FT2-${TS}`, null, ADMIN),
  );
  check(
    "§5.2: ic → elle iz YAZMA 400 INVOICE_TRACE_DISABLED",
    i2Err?.statusCode === 400 && i2Err?.code === "INVOICE_TRACE_DISABLED",
    `${i2Err?.statusCode ?? "—"} / ${i2Err?.code ?? "—"}`,
  );
  const i3Err = await hataOf(() => shippingService.setShipmentInvoice(invSh.id, null, null, ADMIN));
  check(
    "⭐ §5.3: ic → izi KALDIRMA yine AÇIK (mod öncesi yanlış izler kalıcı olmasın)",
    i3Err === null,
    i3Err?.message?.slice(0, 60) ?? "",
  );
  const izSonrasi = await prisma.shipment.findUnique({
    where: { id: invSh.id },
    select: { invoiceNo: true },
  });
  check("§5.3b: iz gerçekten silindi (invoiceNo NULL)", izSonrasi?.invoiceNo === null);

  await setFlag(SETTING_KEYS.SHIPPING_INVOICE_MODE, "ikisi");
  const i4 = await shippingService.setShipmentInvoice(invSh.id, `FT3-${TS}`, null, ADMIN);
  check(
    "§5.4: ikisi → elle iz serbest; iç faturası YOKKEN uyarı da YOK",
    (i4.warnings ?? []).length === 0,
    (i4.warnings ?? []).join(" | ").slice(0, 60),
  );

  // Doğrudan sevk İKİZİ — aynı rejime tabi (kapsam dışı bırakmak sessiz kaçış
  // kapısı olurdu: aynı ekran, iki farklı kural).
  await setFlag(SETTING_KEYS.SHIPPING_INVOICE_MODE, "ic");
  const dsErr = await hataOf(() =>
    shippingService.setDirectShipmentInvoice(
      "00000000-0000-0000-0000-000000000000",
      `FTD-${TS}`,
      null,
      ADMIN,
    ),
  );
  check(
    "⭐ §5.5: ic → DOĞRUDAN SEVK izi de 400 (rejim kapısı statü kontrolünden ÖNCE)",
    dsErr?.statusCode === 400 && dsErr?.code === "INVOICE_TRACE_DISABLED",
    `${dsErr?.statusCode ?? "—"} / ${dsErr?.code ?? "—"}`,
  );

  // Saf yüklem sondaları — servis fixture'ı gerektirmeyen sınırlar.
  const pureErr = await hataOf(async () =>
    assertInvoiceTraceAllowed("ic", { clearing: false }),
  );
  check("§5.6: `assertInvoiceTraceAllowed('ic', yazma)` 400 üretir", pureErr?.statusCode === 400);
  const pureOk = await hataOf(async () => assertInvoiceTraceAllowed("ic", { clearing: true }));
  check("§5.6b: aynı yüklem KALDIRMA'da sessiz", pureOk === null);
  check(
    "§5.7: `invoiceTraceWarning('ikisi', iç fatura VAR)` amber not üretir",
    (invoiceTraceWarning("ikisi", { clearing: false, internalDocNo: "SF-1" }) ?? "").includes("SF-1"),
  );
  check(
    "§5.7b: aynı not `dis` rejiminde ÜRETİLMEZ (uyarı yalnız geçiş dönemine ait)",
    invoiceTraceWarning("dis", { clearing: false, internalDocNo: "SF-1" }) === null,
  );
  await setFlag(SETTING_KEYS.SHIPPING_INVOICE_MODE, null);

  // ═══════════════════════════════════════════════════════════════════════════
  // §6 — ÇIKIŞSIZ KAPI ŞERHİ: ÖNKOŞUL PANELDE GÖRÜNÜR (bağlayıcı kullanıcı şartı)
  // ═══════════════════════════════════════════════════════════════════════════
  // İki bayrak, açıldığı an sahayı DURDURABİLİR ve durdurma sebebi koddadır,
  // ekranda değil: `orderRequirement=block` (tablet sipariş göndermiyor) ve
  // `manualWeightRestricted` (eski istemci `source` göndermiyor). Karar: bayrak
  // YAZILIR ama panelde açan kişi önkoşulu OKUR.
  //
  // ⚠️ ÖLÇÜM METİNDEN YAPILIR (ölü şerh koruması): bayrak varsa cümle de olmalı.
  // Bir sonraki tur açıklamayı sadeleştirirken bu satırı silerse bekçi kırmızı
  // verir — "bayrak var, uyarısı yok" hâli sessizce doğamaz.
  console.log("\n=== §6: çıkışsız kapı şerhi panelde yazılı mı ===");
  const { readFileSync, existsSync } = await import("fs");
  const path = await import("path");
  const PANEL = path.resolve(__dirname, "../../Electron/src/pages/GeneralSettings/settings-config.ts");
  check("§6-zemin: Electron panel dosyası okunabildi", existsSync(PANEL), PANEL);
  const panelSrc = existsSync(PANEL) ? readFileSync(PANEL, "utf8") : "";
  /** `key`/`enumKey` satırından SONRAKİ ilk `desc:` metnini alır. */
  const descOf = (anahtar: string): string => {
    const re = new RegExp(
      `(?:key|enumKey):\\s*"${anahtar}"(?:(?!(?:key|enumKey):\\s*")[\\s\\S])*?desc:\\s*"((?:[^"\\\\]|\\\\.)*)"`,
    );
    return re.exec(panelSrc)?.[1] ?? "";
  };
  const blockDesc = descOf("shippingOrderRequirement");
  const manualDesc = descOf("shippingManualWeightRestrictedEnabled");
  check(
    "§6-zemin: iki bayrağın panel açıklaması bulundu (regex bozulduysa §6 vakumen yeşil kalır)",
    blockDesc.length > 80 && manualDesc.length > 80,
    `block=${blockDesc.length} manual=${manualDesc.length}`,
  );
  check(
    "⭐ §6.1: `orderRequirement` açıklaması ÖNKOŞUL (APK) cümlesini taşıyor",
    blockDesc.includes("ÖNKOŞUL") && /APK/.test(blockDesc),
    blockDesc.slice(0, 70),
  );
  check(
    "⭐ §6.2: `manualWeightRestricted` açıklaması ÖNKOŞUL (güncel istemci) cümlesini taşıyor",
    manualDesc.includes("ÖNKOŞUL") && /güncel/i.test(manualDesc),
    manualDesc.slice(0, 70),
  );
  check(
    "§6.3: tartı bayrağının açıklaması 'içerik değişti → yeniden tartın' etkileşimini söylüyor",
    /SIFIRLANIR|sıfırlan/i.test(descOf("shippingWeighRequiredEnabled")),
    descOf("shippingWeighRequiredEnabled").slice(-70),
  );

  // ===========================================================================
  console.log("\n§7 — shipping.orderCoverage (KAPSAMA: İKİNCİ EKSEN, 2026-09-06)");
  // ===========================================================================
  // ⚠️ NEDEN AYRI EKSEN — ölçüm (fabrika yedeği 2026-09-05): 89 sevk edilmiş
  // sevkiyatın 88'inde sipariş ZATEN seçilmişti, yani `orderRequirement=block`
  // 42 boşluklu sevkiyatın (11.384,7 m) HİÇBİRİNİ durdurmazdı. Bu bölüm tam o
  // kör noktayı ölçer: sipariş SEÇİLİ ama mal deftere YAZILMIYOR.
  //
  // Kurgu: 100 m'lik çuval, 10 m'lik tek kalemli sipariş.
  // ⚠️ Beklenen yazılamayan metraj 90 DEĞİL 100'dür: tahsis TOP BAZLIDIR, top
  // bölünmez. 100 m'lik tek top 10 m'lik kaleme SIĞMAZ, dolayısıyla o kaleme
  // hiç yazılmaz. Bu bir hata değil, alanın kuralı — §7.6 aynı kurgu 100 m'lik
  // kalemle kurulduğunda tahsisin YAZILDIĞINI ölçerek bunu ispatlar.
  const kapsamaSiparis = await prisma.order.create({
    data: {
      orderNumber: `TEST-SFLG-COV-${TS}`,
      customerId: CUSTOMER,
      orderDate: new Date(),
      lines: { create: [{ itemId: ITEM, quantity: new Prisma.Decimal(10), width: 150 }] },
    },
    select: { id: true },
  });
  orderIdsToClean.push(kapsamaSiparis.id);

  // (a) VARSAYILAN `off` → bugünkü davranış: kurulur, kapsama uyarısı YOK.
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_COVERAGE, null);
  check(
    "§7.1: kayıt YOKKEN kapsama okuyucusu 'off' döner (bugünkü davranış)",
    (await readShippingOrderCoverage()) === "off",
  );
  const covOff = await kurSevkiyat(await makeSack(100), { orderIds: [kapsamaSiparis.id] });
  check(
    "⭐ §7.2: `off` → sevkiyat kurulur ve KAPSAMA uyarısı ÇIKMAZ",
    !covOff.warnings.some((w) => /yazılamayan/i.test(w)),
    covOff.warnings.join(" | ") || "(uyarı yok)",
  );

  // (b) `warn` → kurulur AMA uyarı çıkar. Bugün bu bilgi yalnız önizlemede vardı.
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_COVERAGE, "warn");
  const covWarn = await kurSevkiyat(await makeSack(100), { orderIds: [kapsamaSiparis.id] });
  check(
    "⭐ §7.3: `warn` → sevkiyat KURULUR ve 'yazılamayan ~N m' uyarısı yanıtta",
    covWarn.warnings.some((w) => /yazılamayan/i.test(w)),
    covWarn.warnings.join(" | ") || "(uyarı yok)",
  );

  // (c) `block` → kurulum 409. Kaçış `orderless` beyanı.
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_COVERAGE, "block");
  const covSack = await makeSack(100);
  const covErr = await hataOf(() => kurSevkiyat(covSack, { orderIds: [kapsamaSiparis.id] }));
  check(
    "⭐ §7.4: `block` → kurulum DURUR (409 ORDER_COVERAGE)",
    covErr !== null && (covErr as { statusCode?: number }).statusCode === 409 && /ORDER_COVERAGE/.test(JSON.stringify(covErr)),
    covErr ? `${(covErr as { statusCode?: number }).statusCode} ${JSON.stringify(covErr).slice(0, 90)}` : "hata YOK",
  );
  const covBypass = await kurSevkiyat(covSack, { orderIds: [kapsamaSiparis.id], orderless: true });
  check(
    "⭐ §7.5: `block` iken 'orderless' beyanı KAÇIŞTIR (numune/fazla mal meşru)",
    !!covBypass.id,
  );

  // (d) TAM KAPSANAN sevkiyat hiçbir rejimde durdurulmaz — kapı yalnız EKSİK
  //     kapsamada ısırır (körlük zemini: kapı her şeyi reddetmiyor).
  const tamSiparis = await prisma.order.create({
    data: {
      orderNumber: `TEST-SFLG-COV2-${TS}`,
      customerId: CUSTOMER,
      orderDate: new Date(),
      lines: { create: [{ itemId: ITEM, quantity: new Prisma.Decimal(100), width: 150 }] },
    },
    select: { id: true },
  });
  orderIdsToClean.push(tamSiparis.id);
  const covTam = await kurSevkiyat(await makeSack(100), { orderIds: [tamSiparis.id] });
  check(
    "⭐ §7.6: mal TAM yazılabiliyorsa `block` rejiminde bile kurulur (kapı kör değil)",
    !!covTam.id,
  );

  // (e) Sipariş HİÇ seçilmediyse kapsama SUSAR — o soruyu `orderRequirement`
  //     cevaplar; iki eksen aynı sevkiyat için çift uyarı basmamalı.
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "off");
  const covBos = await kurSevkiyat(await makeSack(100), { orderless: true });
  check(
    "⭐ §7.7: sipariş seçilmemişse kapsama ekseni SUSAR (çift uyarı yok)",
    !covBos.warnings.some((w) => /yazılamayan/i.test(w)),
    covBos.warnings.join(" | ") || "(uyarı yok)",
  );
  await setFlag(SETTING_KEYS.SHIPPING_ORDER_COVERAGE, null);
}

async function teardown(): Promise<void> {
  for (const [k, v] of prevFlags) {
    try {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
      else
        await prisma.systemSetting.update({
          where: { key: k },
          data: { value: v === null ? Prisma.JsonNull : v },
        });
    } catch {
      /* ayar geri alınamadıysa geç */
    }
  }
  // ⚠️ ÖN EK YETMEZ: Hızlı Sevk (`from-rolls`) çuvalı SUNUCUDA açar ve ona
  // sıradaki `CV…` numarasını verir — bizim `TST-SFLG-` ön ekimizi taşımaz.
  // İlk yazımda teardown yalnız ön eke bakıyordu ve o çuvallar (+ bağlı
  // sevkiyat) DB'de kalıp müşteri silinmesini FK ile engelliyordu; artık
  // MÜŞTERİ üzerinden de toplanır (test kendi yarattığını siler).
  const allSacks = await prisma.sack.findMany({
    where: { OR: [{ sackNo: { startsWith: SACK_PREFIX } }, { customerId: CUSTOMER || undefined }] },
    select: { id: true, shipmentId: true },
  });
  const musteriSevkleri = CUSTOMER
    ? await prisma.shipment.findMany({ where: { customerId: CUSTOMER }, select: { id: true } })
    : [];
  shipmentIds.push(...musteriSevkleri.map((x) => x.id));
  const musteriToplari = CUSTOMER
    ? await prisma.roll.findMany({
        where: { OR: [{ sack: { customerId: CUSTOMER } }, { shipment: { customerId: CUSTOMER } }] },
        select: { id: true },
      })
    : [];
  rollIds.push(...musteriToplari.map((x) => x.id));
  const sids = [
    ...new Set([...shipmentIds, ...allSacks.map((s) => s.shipmentId).filter((x): x is string => !!x)]),
  ];
  const sackAll = [...new Set([...sackIds, ...allSacks.map((s) => s.id)])];
  // §2.12 FASON FIXTURE'I — ① sevk/belge katmanı, ROLL SİLMELERİNDEN ÖNCE.
  // Sıra load-bearing: `SubcontractorDispatchItem` → Roll FK'si RESTRICT, yani
  // kalem durduğu sürece top silinemez; top silinmezse ürün ve müşteri de
  // silinemez ve bir sonraki koşum bayat fixture'la başlar.
  if (fasonDispatchIds.length > 0) {
    const dsRows = await prisma.directShipment.findMany({
      where: { dispatchId: { in: fasonDispatchIds } },
      select: { id: true },
    });
    const dsIds = dsRows.map((d) => d.id);
    await prisma.subcontractorDirectShipAllocation
      .deleteMany({ where: { dispatchId: { in: fasonDispatchIds } } })
      .catch(() => {});
    await prisma.printedDocument
      .deleteMany({ where: { sourceId: { in: [...dsIds, ...fasonDispatchIds] } } })
      .catch(() => {});
    await prisma.roll
      .updateMany({ where: { directShipmentId: { in: dsIds } }, data: { directShipmentId: null } })
      .catch(() => {});
    await prisma.directShipment.deleteMany({ where: { id: { in: dsIds } } }).catch(() => {});
    await prisma.subcontractorDispatchItem
      .deleteMany({ where: { dispatchId: { in: fasonDispatchIds } } })
      .catch(() => {});
    await prisma.subcontractorDispatch
      .deleteMany({ where: { id: { in: fasonDispatchIds } } })
      .catch(() => {});
  }
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...sackAll, ...sids] } } }).catch(() => {});
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackAll } } }).catch(() => {});
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  // §2.12 FASON FIXTURE'I — ② iş emri katmanı, ROLL SİLMELERİNDEN SONRA
  // (top → adım/parti FK'leri toplar silinene kadar ayakta).
  if (fasonWoIds.length > 0) {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fasonWoIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fasonWoIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: fasonWoIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: fasonWoIds } } }).catch(() => {});
  }
  await prisma.sack.deleteMany({ where: { id: { in: sackAll } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch(() => {});
  await prisma.orderLine
    .deleteMany({ where: { order: { orderNumber: { startsWith: `TEST-SFLG-O-${TS}` } } } })
    .catch(() => {});
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: `TEST-SFLG-O-${TS}` } } }).catch(() => {});
  // §7 kapsama siparişleri — ayrı önek (`TEST-SFLG-COV`), FK sırası: kalem → sipariş.
  if (orderIdsToClean.length > 0) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIdsToClean } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIdsToClean } } }).catch(() => {});
  }
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } }).catch(() => {});
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => {});
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
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
