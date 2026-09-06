// =============================================================================
// TEST: SEVK BELGESİNDE MÜŞTERİDEKİ AD + KOLON BAŞLIĞI ÖZELLEŞTİRME (2026-09-04)
// Çalıştır: npx tsx scripts/test_shipment_doc_customer_name.ts
// =============================================================================
// Fabrika talebi üç parçaydı ve üçü AYRI sınıf risk taşıyor:
//   (A) müşterideki ad belgeye GİRSİN     → donmuş çekirdek (yanlışı KALICI)
//   (B) hangi adın basılacağı BAYRAĞA bağlı → dört kapı (sessiz kaybolma)
//   (C) kolon başlıkları fabrika tarafından yazılsın → kullanıcı girdisi (XSS)
//
// ⚠️ EN ÖNEMLİ BÖLÜM §1'DİR — "hiçbir şey açılmadıysa çıktı DÜNKÜNÜN AYNISI".
// Paketin tüm güvenliği oraya dayanır: `shipping.docItemNameMode` varsayılanı
// `bizdeki` ve o rejimde belgeye TEK BAYT eklenmez (yeni kolon çizilmez, yeni
// etiket basılmaz). Bu ölçülmezse "varsayılan = bugünkü davranış" cümlesi bir
// temenni olur.
//
// ⚠️ İKİNCİ SINIF RİSK: AD DONAR, REJİM DONMAZ. Ad snapshot'a yazılır (sevk
// anındaki gerçek), rejim HER baskıda canlı okunur (sunum). İkisi karışırsa iki
// ayrı arıza doğar: (a) rejim de donarsa "müşteri adıyla bas" ayarı sahadaki
// eski belgelere HİÇ ulaşmaz — tam da ayarı açtıran şikâyet oradadır; (b) ad da
// canlı okunursa müşteri kartındaki karşılığı düzeltmek GEÇMİŞ irsaliyeleri
// değiştirir (donmuş belge kuralının ihlali). §3 ikisini de ölçer.
//
// NEGATİF SONDALAR — HEPSİ ÖLÇÜLDÜ (her biri md5 ile birebir geri alındı):
//   ① `nameMode` varsayılanı "musterideki"           → 2 kırmızı (§1 bayt eşitliği)
//   ② `custOr` fail-open fallback'i kaldırılır       → 1 kırmızı (§4)
//   ③ override kademesi atlanır (yalnız master)      → 5 kırmızı (§2+§3)
//   ④ rejim canlı okunmaz, sabitlenir                → 2 kırmızı (§3)
//   ⑤ `applyColumnCfg` başlığı KAÇIRMAZ              → 1 kırmızı (§6, XSS)
//   ⑥ `updateSchema` satırı silinir                  → 3 kırmızı (§5)
//   ⑦ `docConfigSchema.labels` silinir               → 1 kırmızı (§6 önizleme)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ItemType, Prisma, PrintedDocType, RollStatus, ShipmentStatus } from "@prisma/client";
import { shippingService } from "../src/services/shipping.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import {
  renderShipmentDispatchHtml,
  type ShipmentDispatchDoc,
} from "../src/services/document-render/shipment-dispatch.html";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { applyColumnCfg, type DocCol } from "../src/services/document-render/doc-table";
import { loadShipmentCustomerNames } from "../src/services/helpers/shipment-customer-name.helper";
import {
  SETTING_KEYS,
  SHIPPING_DOC_ITEM_NAME_MODES,
  DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE,
  readShippingDocItemNameMode,
  DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE,
  readShippingDocCekiNameMode,
  sanitizeDocumentsConfig,
} from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { docConfigSchema } from "../src/controllers/printed-document.controller";

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

const TS = Date.now().toString().slice(-6);
const P = `TEST-DCN-${TS}`;

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
let COLOR = "";
let ORDER = "";
let SHIPMENT = "";
let SACK = "";
const rollIds: string[] = [];

/** Bayrağın önceki değeri — teardown birebir geri yükler. */
let prevFlag: { value: Prisma.JsonValue } | null = null;
/** Çeki rejimi satırının koşum ÖNCESİ hâli — finally'de BİREBİR geri yüklenir. */
let prevCekiFlag: { value: unknown } | null = null;

async function setMode(v: string | null): Promise<void> {
  if (v === null) {
    await prisma.systemSetting
      .deleteMany({ where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE } })
      .catch(() => {});
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE },
    create: {
      key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE,
      value: v,
      description: "test",
    },
    update: { value: v },
  });
}

/** Çeki rejimi ayarını yaz/sil (null = satırı kaldır). */
async function setCekiMode(v: string | null): Promise<void> {
  if (v === null) {
    await prisma.systemSetting
      .delete({ where: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE } })
      .catch(() => {});
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE },
    create: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE, value: v, description: "test" },
    update: { value: v },
  });
}

/**
 * Sample doc'u verilen rejimle bas — snapshot zarfı elle kurulur (DB'siz).
 * `ceki` verilmezse meta'ya HİÇ yazılmaz: eski çağrı yollarının bayt eşitliği korunur.
 */
function renderSample(
  mode: "bizdeki" | "musterideki" | "ikisi" | undefined,
  ceki?: "devral" | "bizdeki" | "musterideki" | "ikisi",
): string {
  const doc = SAMPLE_PRINTED_DOCS[PrintedDocType.SHIPMENT_DISPATCH] as unknown as ShipmentDispatchDoc;
  return renderShipmentDispatchHtml(
    {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      company: { name: "Test", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
      docConfigOverride: null,
      doc: doc as unknown as Record<string, unknown>,
    },
    {
      ...(mode === undefined ? {} : { itemNameMode: mode }),
      ...(ceki === undefined ? {} : { cekiNameMode: ceki }),
    },
  );
}

async function run(): Promise<void> {
  // ---------------------------------------------------------------------------
  console.log("\n§1 — VARSAYILAN `bizdeki`: çıktı BUGÜNKÜNÜN AYNISI");
  // ---------------------------------------------------------------------------
  await setMode(null);
  check(
    "kayıt YOKKEN okuyucu 'bizdeki' döner",
    (await readShippingDocItemNameMode()) === "bizdeki",
    `DEFAULT=${DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE}`,
  );
  await setMode("__hicboylebirdegeryok__");
  check(
    "⭐ DB'de ÇÖP değer varken de 'bizdeki' (kod sigortası)",
    (await readShippingDocItemNameMode()) === "bizdeki",
  );
  await setMode(null);

  // Rejim VERİLMEDEN basılan HTML = rejim açıkça `bizdeki` verilen HTML.
  // `meta.itemNameMode` taşımayan her eski çağrı yolu (renderDraftHtml, testler)
  // bu eşitliğe güvenir.
  const htmlDefault = renderSample(undefined);
  const htmlBizdeki = renderSample("bizdeki");
  check(
    "⭐ rejim verilmeyen render ile `bizdeki` render BİREBİR aynı bayt",
    htmlDefault === htmlBizdeki,
    `${htmlDefault.length} ↔ ${htmlBizdeki.length}`,
  );
  check(
    "`bizdeki` çıktısında MÜŞTERİ kolon başlıkları HİÇ geçmiyor",
    !htmlBizdeki.includes("MÜŞTERİ STOK ADI") &&
      !htmlBizdeki.includes("MÜŞTERİ DESEN") &&
      !htmlBizdeki.includes("MÜŞTERİ VARYANT"),
  );
  check(
    "`bizdeki` çıktısında müşteri ADI DEĞERİ de geçmiyor (hücre sızıntısı yok)",
    !htmlBizdeki.includes("AKTOS"),
  );
  check("`bizdeki` çıktısı kendi kolonlarını basıyor", htmlBizdeki.includes("STOK ADI"));

  // ---------------------------------------------------------------------------
  console.log("\n§2 — ZİNCİR: bir-seferlik override > master alias > yok");
  // ---------------------------------------------------------------------------
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  ADMIN = admin?.id ?? "";
  const customer = await prisma.customer.create({
    data: { code: `${P}-C`, name: `${P} Müşteri` },
    select: { id: true },
  });
  CUSTOMER = customer.id;
  const item = await prisma.item.create({
    data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  ITEM = item.id;
  const color = await prisma.color.create({
    data: { code: `${P}-K`, name: `${P} RENK` },
    select: { id: true },
  });
  COLOR = color.id;

  // Master alias (müşteri kartındaki kalıcı karşılık).
  await prisma.customerItemAlias.create({
    data: { customerId: CUSTOMER, itemId: ITEM, alias: "MASTER-URUN" },
  });
  await prisma.customerColorAlias.create({
    data: { customerId: CUSTOMER, colorId: COLOR, alias: "MASTER-RENK" },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: `${P}-O`,
      customerId: CUSTOMER,
      orderDate: new Date(),
      lines: {
        create: [
          { itemId: ITEM, colorId: COLOR, quantity: new Prisma.Decimal(100) },
        ],
      },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  ORDER = order.id;
  const lineId = order.lines[0]?.id as string;

  // Master YALNIZ başına: override yokken master kazanır.
  const namesMaster = await loadShipmentCustomerNames(prisma, {
    customerId: CUSTOMER,
    sackIds: [],
    orderIds: [ORDER],
    itemIds: [ITEM],
    colorIds: [COLOR],
  });
  check(
    "override YOKKEN master alias okunur",
    namesMaster.itemName(ITEM, COLOR) === "MASTER-URUN" &&
      namesMaster.colorName(COLOR) === "MASTER-RENK",
    `${namesMaster.itemName(ITEM, COLOR)} / ${namesMaster.colorName(COLOR)}`,
  );

  // Bir-seferlik override yazıldı → master EZİLİR. Kullanıcının cümlesi:
  // "bir seferliğine bile değiştiyse O ismi kullanırız".
  await prisma.orderLine.update({
    where: { id: lineId },
    data: { customerItemName: "TEK-SEFERLIK-URUN", customerColorName: "TEK-SEFERLIK-RENK" },
  });
  const namesOverride = await loadShipmentCustomerNames(prisma, {
    customerId: CUSTOMER,
    sackIds: [],
    orderIds: [ORDER],
    itemIds: [ITEM],
    colorIds: [COLOR],
  });
  check(
    "⭐ bir-seferlik override master alias'ı EZİYOR",
    namesOverride.itemName(ITEM, COLOR) === "TEK-SEFERLIK-URUN" &&
      namesOverride.colorName(COLOR) === "TEK-SEFERLIK-RENK",
    `${namesOverride.itemName(ITEM, COLOR)} / ${namesOverride.colorName(COLOR)}`,
  );
  check(
    "hiç karşılığı olmayan üründe null döner (uydurulmaz)",
    namesOverride.itemName("00000000-0000-0000-0000-000000000000", null) === null &&
      namesOverride.colorName(null) === null,
  );

  // ---------------------------------------------------------------------------
  console.log("\n§3 — AD DONAR, REJİM DONMAZ (donmuş belge kuralı)");
  // ---------------------------------------------------------------------------
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}-S`,
      customerId: CUSTOMER,
      status: ShipmentStatus.PLANNED,
      orders: { create: [{ orderId: ORDER }] },
    },
    select: { id: true },
  });
  SHIPMENT = shipment.id;
  const sack = await prisma.sack.create({
    data: { sackNo: `${P}-CV`, seq: 1, shipmentId: SHIPMENT, customerId: CUSTOMER },
    select: { id: true },
  });
  SACK = sack.id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `${P}-R1`,
      itemId: ITEM,
      colorId: COLOR,
      initialQty: new Prisma.Decimal(100),
      currentQty: new Prisma.Decimal(100),
      width: new Prisma.Decimal(150),
      status: RollStatus.WAREHOUSE,
      sackId: SACK,
      shipmentId: SHIPMENT,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);

  // TASLAK (PLANNED) yol — donmuş belge yok, canlı içerik üretilir.
  const draft = (await shippingService.getDispatchReport(SHIPMENT)).data as {
    frozen: boolean;
    products: { name: string; customerName?: string | null }[];
    cekiRows: { customerDesen?: string | null; customerVaryant?: string | null }[];
  };
  check("taslak fiş donmamış (frozen:false)", draft.frozen === false);
  check(
    "⭐ ürün satırı müşterideki adı taşıyor (override zinciriyle)",
    draft.products[0]?.customerName === "TEK-SEFERLIK-URUN TEK-SEFERLIK-RENK 150cm.",
    String(draft.products[0]?.customerName),
  );
  check(
    "bizim adımız DEĞİŞMEDİ (kolon eklendi, mevcut alan korundu)",
    draft.products[0]?.name === `${P} KUMAS ${P} RENK 150cm.`,
    String(draft.products[0]?.name),
  );
  check(
    "çeki satırı da müşteri desen/varyant taşıyor",
    draft.cekiRows[0]?.customerDesen === "TEK-SEFERLIK-URUN" &&
      draft.cekiRows[0]?.customerVaryant === "TEK-SEFERLIK-RENK",
  );

  // Şimdi DONDUR — sevk anındaki ad snapshot'a yazılır.
  await prisma.shipment.update({
    where: { id: SHIPMENT },
    data: { status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() },
  });
  await prisma.$transaction(async (tx) => {
    await printedDocumentService.freezeForSource(
      tx,
      PrintedDocType.SHIPMENT_DISPATCH,
      SHIPMENT,
      ADMIN || undefined,
    );
  });

  // Sevkten SONRA hem master alias hem override DEĞİŞTİRİLİR.
  await prisma.customerItemAlias.updateMany({
    where: { customerId: CUSTOMER, itemId: ITEM },
    data: { alias: "SONRADAN-DEGISTI" },
  });
  await prisma.orderLine.update({
    where: { id: lineId },
    data: { customerItemName: "SONRADAN-DEGISTI-2" },
  });

  const frozen = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, SHIPMENT))
    .data as { snapshot: { doc: ShipmentDispatchDoc } } | null;
  check(
    "⭐ DONMUŞ belge sonradan değişen ad'dan ETKİLENMİYOR",
    frozen?.snapshot.doc.products[0]?.customerName === "TEK-SEFERLIK-URUN TEK-SEFERLIK-RENK 150cm.",
    String(frozen?.snapshot.doc.products[0]?.customerName),
  );

  // REJİM ise DONMAZ: aynı donmuş belge, ayar değişince FARKLI kolonla basılır.
  await setMode("bizdeki");
  const printedBizdeki = (
    await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, SHIPMENT, undefined, {})
  ).data as { html: string } | null;
  await setMode("musterideki");
  const printedMusteri = (
    await printedDocumentService.getHtml(PrintedDocType.SHIPMENT_DISPATCH, SHIPMENT, undefined, {})
  ).data as { html: string } | null;
  check(
    "⭐ REJİM donmuyor — aynı belge ayar değişince müşteri adıyla basılıyor",
    Boolean(printedBizdeki?.html.includes("STOK ADI")) &&
      !printedBizdeki?.html.includes("TEK-SEFERLIK-URUN") &&
      Boolean(printedMusteri?.html.includes("TEK-SEFERLIK-URUN")),
  );
  check(
    "`musterideki` rejiminde BİZİM adımız basılmıyor (tek kolon)",
    !printedMusteri?.html.includes(`${P} KUMAS`),
  );
  await setMode(null);

  // ---------------------------------------------------------------------------
  console.log("\n§4 — REJİM DAVRANIŞI (fail-open + iki kolon)");
  // ---------------------------------------------------------------------------
  const htmlMusteri = renderSample("musterideki");
  const htmlIkisi = renderSample("ikisi");
  check(
    "`musterideki`: müşteri başlığı basılır, bizimki basılmaz",
    htmlMusteri.includes("MÜŞTERİ STOK ADI") && !htmlMusteri.includes(">STOK ADI<"),
  );
  check(
    "⭐ FAIL-OPEN: karşılığı OLMAYAN üründe BİZİM adımız basılır (hücre boş kalmaz)",
    htmlMusteri.includes("Süet Kumaş · Antrasit"),
    "örnek veride 2. ürünün customerName'i bilerek null",
  );
  check(
    "`musterideki`: karşılığı OLAN üründe müşteri adı basılır",
    htmlMusteri.includes("AKTOS · SAND"),
  );
  check(
    "`ikisi`: İKİ başlık da basılır",
    htmlIkisi.includes("STOK ADI") && htmlIkisi.includes("MÜŞTERİ STOK ADI"),
  );
  check(
    "`ikisi`: çeki listesinde de dört ad kolonu",
    htmlIkisi.includes("MÜŞTERİ DESEN") && htmlIkisi.includes("MÜŞTERİ VARYANT"),
  );

  // ---------------------------------------------------------------------------
  console.log("\n§5 — DÖRT KAPI (bayrak sessizce kaybolmasın)");
  // ---------------------------------------------------------------------------
  // Kapı 1: PATCH şeması. Kapı 2: setFeatureFlags yazma dalı (round-trip).
  // Kapı 3: getFeatureFlags yükü. Kapı 4: Electron paneli (§16'nın işi, burada
  // yalnız değer kümesi aynası ölçülür).
  for (const v of SHIPPING_DOC_ITEM_NAME_MODES) {
    check(
      `updateSchema '${v}' değerini kabul ediyor`,
      updateSchema.safeParse({ shippingDocItemNameMode: v }).success,
    );
  }
  check(
    "updateSchema UYDURMA değeri reddediyor",
    !updateSchema.safeParse({ shippingDocItemNameMode: "musteride" }).success,
  );
  for (const v of SHIPPING_DOC_ITEM_NAME_MODES) {
    await prisma.systemSetting
      .deleteMany({ where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE } })
      .catch(() => {});
    const { systemSettingService } = await import("../src/services/system-setting.service");
    await systemSettingService.setFeatureFlags(
      { shippingDocItemNameMode: v } as never,
      ADMIN || undefined,
    );
    check(`set→read turu '${v}' korunuyor`, (await readShippingDocItemNameMode()) === v);
  }
  await setMode(null);

  // ---------------------------------------------------------------------------
  console.log("\n§6 — KOLON BAŞLIĞI ÖZELLEŞTİRME");
  // ---------------------------------------------------------------------------
  const cols: DocCol<unknown>[] = [
    { key: "name", label: "STOK ADI", align: "l", cell: () => "" },
    { key: "rollCount", label: "TOP ADEDİ", align: "r", cell: () => "" },
  ];
  const renamed = applyColumnCfg(cols, { labels: { name: "ÜRÜN" } });
  check("başlık override'ı uygulanıyor", renamed[0]?.label === "ÜRÜN");
  check("override verilmeyen kolon yerleşik başlığını koruyor", renamed[1]?.label === "TOP ADEDİ");

  const blanked = applyColumnCfg(cols, { labels: { name: "   " } });
  check(
    "BOŞ dize = varsayılana dön (başlıksız kolon üretilmez)",
    blanked[0]?.label === "STOK ADI",
  );

  const xss = applyColumnCfg(cols, { labels: { name: '<img src=x onerror="alert(1)">' } });
  check(
    "⭐ başlık override'ı HTML KAÇIRILIYOR (kullanıcı girdisi)",
    xss[0]?.label === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    String(xss[0]?.label),
  );
  const hiddenWithLabel = applyColumnCfg(cols, { hidden: ["name"], labels: { name: "ÜRÜN" } });
  check(
    "gizli kolonun başlığı basılmaz (override görünürlüğü açmaz)",
    hiddenWithLabel.length === 1 && hiddenWithLabel[0]?.key === "rollCount",
  );

  // Kayıt kapısı + önizleme kapısı (İKİSİ birlikte — biri düşerse ayar ya
  // kaydolmaz ya da canlı önizlemede görünmez).
  const saved = sanitizeDocumentsConfig({
    shipmentDispatch: { columns: { urun: { labels: { name: "  ÜRÜN  ", rollCount: "" } } } },
  });
  check(
    "⭐ sanitize başlığı SAKLIYOR (trim'li) ve boş olanı DÜŞÜRÜYOR",
    saved.shipmentDispatch?.columns?.urun?.labels?.name === "ÜRÜN" &&
      saved.shipmentDispatch?.columns?.urun?.labels?.rollCount === undefined,
    JSON.stringify(saved.shipmentDispatch?.columns?.urun),
  );
  const uzun = "X".repeat(120);
  const savedLong = sanitizeDocumentsConfig({
    shipmentDispatch: { columns: { urun: { labels: { name: uzun } } } },
  });
  check(
    "sanitize başlığı 40 karakterde kırpıyor",
    savedLong.shipmentDispatch?.columns?.urun?.labels?.name?.length === 40,
  );
  const parsed = docConfigSchema.safeParse({
    columns: { urun: { labels: { name: "ÜRÜN" } } },
  });
  check(
    "⭐ önizleme şeması (docConfigSchema) `labels`ı ATMIYOR",
    parsed.success &&
      (parsed.data as { columns?: Record<string, { labels?: Record<string, string> }> })?.columns
        ?.urun?.labels?.name === "ÜRÜN",
  );

  // Uçtan uca: başlık override'ı GERÇEK belgede basılıyor mu?
  const htmlRenamed = renderShipmentDispatchHtml(
    {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      company: { name: "Test", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
      docConfigOverride: { columns: { urun: { labels: { name: "ÜRÜN KODU" } } } },
      doc: SAMPLE_PRINTED_DOCS[PrintedDocType.SHIPMENT_DISPATCH],
    },
    {},
  );
  check(
    "⭐ uçtan uca: özel başlık sevk irsaliyesinde basılıyor",
    htmlRenamed.includes("ÜRÜN KODU") && !htmlRenamed.includes(">STOK ADI<"),
  );

  // ---------------------------------------------------------------------------
  console.log("\n§7 — ÇEKİ BÖLÜMÜ AYRI REJİM (`shipping.docCekiNameMode`, 2026-09-06)");
  // ---------------------------------------------------------------------------
  // NEDEN VAR: çeki listesi sevk irsaliyesinin bir BÖLÜMÜ ama tek başına da
  // basılabiliyor ve ambar elemanının kontrol listesi olarak kullanılıyor; orada
  // "hem bizdeki hem müşterideki ad" anlamlı, müşteriye giden ÜRÜN LİSTESİNDE değil.
  // Tek global rejim ikisini birden çeviriyordu.
  await setCekiMode(null);
  check(
    "kayıt YOKKEN çeki okuyucusu 'devral' döner",
    (await readShippingDocCekiNameMode()) === "devral",
    `DEFAULT=${DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE}`,
  );
  await setCekiMode("__hicboylebirdegeryok__");
  check(
    "⭐ DB'de ÇÖP değer varken de 'devral' (kod sigortası)",
    (await readShippingDocCekiNameMode()) === "devral",
  );
  await setCekiMode(null);

  // ⭐ EN ÖNEMLİ: bayrak yazılmadıkça ÇIKTI DEĞİŞMEZ.
  check(
    "⭐ çeki rejimi HİÇ verilmeyen render = `devral` verilen render (BİREBİR bayt)",
    renderSample("bizdeki") === renderSample("bizdeki", "devral"),
  );
  check(
    "⭐ `devral` genel rejimi izler: genel `musterideki` iken de bayt eşitliği",
    renderSample("musterideki") === renderSample("musterideki", "devral"),
  );

  // ⭐ İKİNCİ EN ÖNEMLİ: çeki değişirken ÜRÜN LİSTESİ sabit kalmalı.
  const cekiIkisi = renderSample("bizdeki", "ikisi");
  check("⭐ çeki `ikisi` çıktıyı DEĞİŞTİRİYOR (bayrak gerçekten bağlı)", renderSample("bizdeki") !== cekiIkisi);
  check(
    "⭐ çeki `ikisi` müşteri DESEN/VARYANT kolonlarını getiriyor",
    cekiIkisi.includes("MÜŞTERİ DESEN") && cekiIkisi.includes("MÜŞTERİ VARYANT"),
  );
  check(
    "⭐ …ama ÜRÜN LİSTESİ kolonu GELMİYOR (müşteriye giden yüzey korunuyor)",
    !cekiIkisi.includes("MÜŞTERİ STOK ADI"),
  );

  // Ters yön: genel `musterideki` iken çeki `bizdeki` YALNIZ çekiyi geri çevirir.
  const cekiBiz = renderSample("musterideki", "bizdeki");
  check(
    "⭐ genel `musterideki` + çeki `bizdeki` → ürün listesinde müşteri adı DURUYOR",
    cekiBiz.includes("MÜŞTERİ STOK ADI"),
  );
  check(
    "⭐ …ve çeki bölümünde müşteri kolonları YOK",
    !cekiBiz.includes("MÜŞTERİ DESEN") && !cekiBiz.includes("MÜŞTERİ VARYANT"),
  );

  // ---------------------------------------------------------------------------
  console.log("\n§8 — EKRAN İLE KÂĞIT AYNI ADI VERİR (ayrışan yüzey, 2026-09-06)");
  // ---------------------------------------------------------------------------
  // Sipariş seçim ekranı (`listOpenOrdersWithCoverage`) ve sevkiyat detayı
  // (`getShipmentById`) eskiden YALNIZ `OrderLine` override'ını taşıyordu; belge
  // ise master alias kademesini de çözüyordu. Ölçüldü (fabrika yedeği): sevk
  // edilmiş 1.778 topun 424'ünde (%24) master alias VAR ama override YOK →
  // irsaliyede müşteri adı basılıyor, ekranda hiç görünmüyordu.
  const line = await prisma.orderLine.findFirst({
    where: { orderId: ORDER },
    select: { id: true, customerItemName: true, customerColorName: true },
  });
  const lineIdY = line?.id as string;
  const onceki = { i: line?.customerItemName ?? null, c: line?.customerColorName ?? null };

  // (a) override YOK → ekran MASTER alias'ı göstermeli (eski davranışta null'dı).
  await prisma.orderLine.update({
    where: { id: lineIdY },
    data: { customerItemName: null, customerColorName: null },
  });
  const acikRes = (await shippingService.listOpenOrdersWithCoverage({ customerId: CUSTOMER })) as {
    data: { order: { id: string }; lines: { customerItemName: string | null; customerColorName: string | null }[] }[];
  };
  const acikSatir = acikRes.data.find((o) => o.order.id === ORDER)?.lines[0];
  // ⚠️ Beklenti SABİT YAZILMAZ: §3 master alias'ı bilerek değiştiriyor ("ad donar,
  // rejim donmaz"). Beklenen değer DB'den okunur — yoksa bu kontrol §3'ün yan
  // etkisiyle kırmızı verir ve ölçtüğünü sandığı şeyi ölçmez.
  const canliAlias = await prisma.customerItemAlias.findFirst({
    where: { customerId: CUSTOMER, itemId: ITEM },
    select: { alias: true },
  });
  const canliRenkAlias = await prisma.customerColorAlias.findFirst({
    where: { customerId: CUSTOMER, colorId: COLOR },
    select: { alias: true },
  });
  check(
    "⭐ override YOKKEN sipariş seçim ekranı MASTER alias'ı taşıyor",
    !!canliAlias?.alias &&
      acikSatir?.customerItemName === canliAlias.alias &&
      acikSatir?.customerColorName === canliRenkAlias?.alias,
    `${acikSatir?.customerItemName} (beklenen ${canliAlias?.alias}) / ${acikSatir?.customerColorName}`,
  );

  // (b) override VARSA override kazanır — kademe sırası ekranda da aynı.
  await prisma.orderLine.update({
    where: { id: lineIdY },
    data: { customerItemName: "EKRAN-OVERRIDE", customerColorName: null },
  });
  const acikRes2 = (await shippingService.listOpenOrdersWithCoverage({ customerId: CUSTOMER })) as {
    data: { order: { id: string }; lines: { customerItemName: string | null; customerColorName: string | null }[] }[];
  };
  const acikSatir2 = acikRes2.data.find((o) => o.order.id === ORDER)?.lines[0];
  check(
    "⭐ override VARSA ekranda override kazanır (kademe sırası kâğıtla aynı)",
    acikSatir2?.customerItemName === "EKRAN-OVERRIDE",
    String(acikSatir2?.customerItemName),
  );
  check(
    "…renk tarafı override'sız kaldığı için hâlâ MASTER",
    acikSatir2?.customerColorName === "MASTER-RENK",
    String(acikSatir2?.customerColorName),
  );

  // (c) KÖRLÜK/UYDURMA ZEMİNİ: karşılığı OLMAYAN üründe alan NULL kalmalı —
  // arayüz bizim adımızı "müşterideki ad" diye basmasın.
  const kararsizItem = await prisma.item.create({
    data: { code: `${P}-I2`, name: `${P} KARSILIKSIZ`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  await prisma.orderLine.create({
    data: { orderId: ORDER, itemId: kararsizItem.id, quantity: new Prisma.Decimal(10) },
  });
  const acikRes3 = (await shippingService.listOpenOrdersWithCoverage({ customerId: CUSTOMER })) as {
    data: { order: { id: string }; lines: { item: { id: string }; customerItemName: string | null }[] }[];
  };
  const karsiliksiz = acikRes3.data
    .find((o) => o.order.id === ORDER)
    ?.lines.find((l) => l.item.id === kararsizItem.id);
  check(
    "⭐ müşteri karşılığı YOKSA alan NULL (bizim adımız 'müşterideki ad' diye basılmaz)",
    karsiliksiz !== undefined && karsiliksiz.customerItemName === null,
    `bulundu=${karsiliksiz !== undefined} deger=${String(karsiliksiz?.customerItemName)}`,
  );

  await prisma.orderLine.update({
    where: { id: lineIdY },
    data: { customerItemName: onceki.i, customerColorName: onceki.c },
  });
}

async function teardown(): Promise<void> {
  await prisma.printedDocument
    .deleteMany({ where: { sourceId: SHIPMENT || "00000000-0000-0000-0000-000000000000" } })
    .catch(() => {});
  if (rollIds.length) {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  }
  if (SACK) {
    await prisma.sackAllocation.deleteMany({ where: { sackId: SACK } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: SACK } }).catch(() => {});
  }
  if (SHIPMENT) {
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: SHIPMENT } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: SHIPMENT } }).catch(() => {});
  }
  if (ORDER) {
    await prisma.orderLine.deleteMany({ where: { orderId: ORDER } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: ORDER } }).catch(() => {});
  }
  if (CUSTOMER) {
    await prisma.customerItemAlias.deleteMany({ where: { customerId: CUSTOMER } }).catch(() => {});
    await prisma.customerColorAlias.deleteMany({ where: { customerId: CUSTOMER } }).catch(() => {});
  }
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } }).catch(() => {});
  if (COLOR) await prisma.color.deleteMany({ where: { id: COLOR } }).catch(() => {});
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => {});
  // Bayrağı önceki hâline BİREBİR döndür — sonraki test başka rejimde başlamasın.
  if (prevFlag) {
    await prisma.systemSetting
      .upsert({
        where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE },
        create: {
          key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE,
          value: prevFlag.value as Prisma.InputJsonValue,
          description: "restore",
        },
        update: { value: prevFlag.value as Prisma.InputJsonValue },
      })
      .catch(() => {});
  } else {
    await setMode(null);
  }
  // Çeki rejimi de BİREBİR geri yüklenir (bayrak yazan bekçi kuralı).
  if (prevCekiFlag) {
    await prisma.systemSetting
      .upsert({
        where: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE },
        create: {
          key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE,
          value: prevCekiFlag.value as Prisma.InputJsonValue,
          description: "restore",
        },
        update: { value: prevCekiFlag.value as Prisma.InputJsonValue },
      })
      .catch(() => {});
  } else {
    await setCekiMode(null);
  }
}

prisma.systemSetting
  .findUnique({
    where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE },
    select: { value: true },
  })
  .then(async (r) => {
    prevFlag = r;
    prevCekiFlag = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE },
      select: { value: true },
    });
    return run();
  })
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
