// =============================================================================
// BEKÇİ — SEVK ONAYI SONRASI OTOMATİK SATIŞ FATURASI TASLAĞI
// =============================================================================
// Çalıştırma: npx tsx scripts/test_auto_draft_shipment.ts
//
// NEYİ ÖLÇER: `shipping.service.maybeAutoDraftInvoiceAfterDispatch` +
// `collectShipmentInvoiceDraftLines` — yani "mal çıktı" olayının muhasebe
// tarafındaki eşleniği. Bayrak `finance.autoDraftFromShipmentEnabled`
// (varsayılan KAPALI), modül şalteri `finance.enabled` ONUN ÜSTÜNDE.
//
// ⚠️ KAPALI PARİTE İLKESİ (bu bekçinin İLK bölümü, ve bilerek ilk):
// Bayrak kapalıyken sistem BUGÜNKÜ davranışını BAYT-BAYT sürdürmeli — ne
// fatura doğar ne de kullanıcıya giden mesaj değişir. Yeni bir özelliğin en
// sinsi bedeli, kapalıyken bile değiştirdiği metin/akıştır; onu ölçmeyen bir
// bekçi "özellik çalışıyor" der ve bayrağı hiç açmamış fabrikanın ekranındaki
// sessiz farkı göremez. Bu yüzden §1 ve §4 mesajı TAM EŞİTLİKLE karşılaştırır,
// `includes` ile değil.
//
// ÖLÇÜLENLER:
//   §1 KAPALI PARİTE — hızlı sevkte fatura doğmaz, mesaj bayt-bayt bugünkü
//   §2 AÇIK + hızlı sevk — taslak doğar: SALES/DRAFT, sevkiyata bağlı,
//      issueDate = dispatchedAt, notes sevkiyat no'su, satırlar ÜRÜN KIRILIMI
//      (3 top / 2 ürün → 2 satır), qty = currentQty toplamı, birim "m",
//      fiyat D2 zincirinden (müşteri istisnası kart varsayılanını EZER),
//      fiyatsız kalem 0 ile doğar (taslağı ENGELLEMEZ — onay seddi yakalar)
//   §3 İDEMPOTENT KANCA — elde aktif fatura varken ikinci taslak DOĞMAZ
//   §4 MODÜL ŞALTERİ — `finance.enabled` kapalıyken bayrak açık olsa da no-op
//   §5 ONAY AÇIK REJİMİ — PLANNED sevkiyatta taslak YOK; `dispatchShipment`
//      ile onaylanınca DOĞAR (kancanın üç çağrı yolundan ikisi ölçülmüş olur)
//   §6 KÖRLÜK ZEMİNİ — fixture gerçekten kuruldu mu (yeşil ≠ "hiç bakılmadı")
//
// NEGATİF SONDA (2026-08-14 — koşuldu, kırmızı GÖRÜLDÜ, dosya shasum ile
// birebir geri yüklendi: dc724ae3…). `shipping.service.
// maybeAutoDraftInvoiceAfterDispatch` gövdesinin başına `return null;`
// konuldu → **31 geçti/0 başarısız** yerine **10 geçti/5 başarısız**:
//   ❌ §2a (taslak doğmadı) + "§2 ATLANDI" (13 alt kontrolün ön koşulu düştü)
//   ❌ §5d · ❌ §5e (dispatchShipment yolu da ölü)
//   ❌ §6c (körlük zemini: hiç taslak doğmamış)
//   ⏭  §3 hiç KOŞMADI — ön koşulu "elde aktif fatura var" (bilinçli: kanca
//      çalışmıyorsa idempotentliğini ölçmenin anlamı yok)
//   ✅ §1 ve §4 YEŞİL KALDI ve bu DOĞRUDUR: kapalı-parite tanım gereği
//      "kanca çalışmıyor" hâlini ölçer — sondada da doğru cevabı verir.
//      Sonda §1'i de kırmızıya düşürseydi, §1 kapalı-pariteyi değil kancanın
//      varlığını ölçüyor olurdu.
// =============================================================================
import { Currency, InvoiceStatus, InvoiceType, PriceKind, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS, readFinanceDefaultVatRate } from "../src/services/system-setting.service";
import { D } from "../src/services/helpers/finance.helper";

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

const TAG = `TEST-ADS-${Date.now()}`;
const rollIds: string[] = [];
const shipmentIds: string[] = [];
const itemIds: string[] = [];
let customerId: string | null = null;
let colorId: string | null = null;

const AUTO_KEY = SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED;
const FIN_KEY = SETTING_KEYS.FINANCE_ENABLED;
const CONF_KEY = SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED;
const priorFlags = new Map<string, { existed: boolean; value: unknown }>();

/** Ayar doğrudan yazılır — üç okuyucu da ENFORCEMENT READER (cache'siz), yani
 *  bir sonraki çağrıda anında etkili. HTTP/panel sözleşmesini
 *  `test_feature_flag_contract` ölçer; burası davranışı ölçer. */
async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}
async function rememberFlag(key: string): Promise<void> {
  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  priorFlags.set(key, { existed: row !== null, value: row?.value ?? null });
}
/** ⚠️ ÖZGÜN DEĞERE geri koyar: kayıt YOKTU ise satır SİLİNİR (false yazmak
 *  "ayar hiç dokunulmamış" ile "ayar kapatılmış" durumlarını karıştırırdı ve
 *  bu DB'de `finance.enabled` GERÇEKTEN açıktır — öyle bırakılmalı). */
async function restoreFlags(): Promise<void> {
  for (const [key, prev] of priorFlags) {
    if (prev.existed) {
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: prev.value as never },
        update: { value: prev.value as never },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
}

async function makeRoll(itemId: string, qty: number, warehouseId: string, opts?: { colorId?: string; width?: number }): Promise<string> {
  const res = await inventory.createInitialEntry(
    { itemId, initialQty: qty, ...(opts?.colorId ? { colorId: opts.colorId } : {}), ...(opts?.width != null ? { width: opts.width } : {}) },
    undefined,
    undefined,
    false,
    { forcedStatus: RollStatus.WAREHOUSE, warehouseId },
  );
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

type QuickResult = { data: { id: string; shipmentNo: string; status: string; dispatched: boolean }; message?: string };
async function quickShip(rIds: string[], custId: string): Promise<QuickResult> {
  const res = (await shippingService.createShipmentFromRolls({
    rollIds: rIds,
    customerId: custId,
    clientToken: crypto.randomUUID(),
  })) as QuickResult;
  shipmentIds.push(res.data.id);
  return res;
}

async function invoicesOf(shipmentId: string): Promise<Array<{ id: string; docNo: string; type: InvoiceType; status: InvoiceStatus; currency: Currency; issueDate: Date; notes: string | null; shipmentId: string | null; goodsReceiptId: string | null }>> {
  return prisma.invoice.findMany({
    where: { shipmentId },
    select: { id: true, docNo: true, type: true, status: true, currency: true, issueDate: true, notes: true, shipmentId: true, goodsReceiptId: true },
  });
}

async function main(): Promise<void> {
  console.log("=== Sevk sonrası otomatik fatura taslağı bekçisi ===\n");

  await rememberFlag(AUTO_KEY);
  await rememberFlag(FIN_KEY);
  await rememberFlag(CONF_KEY);

  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok — `ensureDefaultWarehouse` boş döndü.");

  // ⚠️ KALEMLER TESTİN KENDİSİNİN: fiyat çözümü ölçülüyor ve ortamdaki bir
  // kalemin `ItemPrice` satırı OLUP OLMAMASI bekçiyi dolu dev DB'sinde yeşil,
  // temiz CI DB'sinde kırmızı yapardı (test_goods_receipt §J dersi).
  const itemA = await prisma.item.create({
    data: { code: `${TAG}-A`, name: `${TAG} Kumaş A`, itemType: "FABRIC", unit: "MT" },
    select: { id: true, name: true },
  });
  itemIds.push(itemA.id);
  const itemB = await prisma.item.create({
    data: { code: `${TAG}-B`, name: `${TAG} Kumaş B`, itemType: "FABRIC", unit: "MT" },
    select: { id: true, name: true },
  });
  itemIds.push(itemB.id);
  const color = await prisma.color.create({ data: { code: `${TAG}-C`, name: `${TAG} Renk` }, select: { id: true, name: true } });
  colorId = color.id;
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  customerId = customer.id;

  // ── §1 KAPALI PARİTE ────────────────────────────────────────────────────
  // İLK bölüm olması bilinçli: bayrak henüz hiç açılmamışken ölçülür, yani
  // "kapalı davranış" sonradan geri çevrilmiş bir duruma değil GERÇEK
  // başlangıç durumuna bakar.
  await setFlag(AUTO_KEY, false);
  await setFlag(CONF_KEY, false);
  const p1 = await makeRoll(itemA.id, 120, wh.id, { colorId: color.id, width: 150 });
  const p2 = await makeRoll(itemA.id, 80, wh.id, { colorId: color.id, width: 150 });
  const off = await quickShip([p1, p2], customer.id);
  check("§1a Ön koşul: hızlı sevk doğrudan DISPATCHED", off.data.dispatched && off.data.status === ShipmentStatus.DISPATCHED, `status=${off.data.status}`);
  const offInv = await invoicesOf(off.data.id);
  check("§1b ⭐ Bayrak KAPALI → hiçbir fatura doğmadı", offInv.length === 0, `${offInv.length} fatura`);
  check(
    "§1c ⭐ Mesaj BAYT-BAYT bugünkü (taslak notu sızmıyor)",
    off.message === `Sevk edildi: ${off.data.shipmentNo} (2 top)`,
    JSON.stringify(off.message),
  );

  // ── §2 AÇIK + HIZLI SEVK ────────────────────────────────────────────────
  await setFlag(AUTO_KEY, true);
  // FİYAT FIXTURE'I — D2 zinciri: müşteri istisnası kart varsayılanını EZER.
  // Yalnız kart varsayılanı yazılsaydı "zincir çözülüyor mu" değil "tek satır
  // okunuyor mu" ölçülürdü; iki satır birlikte zinciri kilitler.
  await prisma.itemPrice.create({
    data: { itemId: itemA.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "10.0000" },
  });
  await prisma.itemPrice.create({
    data: { itemId: itemA.id, customerId: customer.id, kind: PriceKind.SALE, currency: Currency.TRY, price: "12.5000" },
  });
  // itemB'nin fiyatı BİLEREK YOK → satır 0 ile doğmalı (taslak yine doğar).

  const q1 = await makeRoll(itemA.id, 120, wh.id, { colorId: color.id, width: 150 });
  const q2 = await makeRoll(itemA.id, 80, wh.id, { colorId: color.id, width: 150 });
  const q3 = await makeRoll(itemB.id, 55, wh.id, { colorId: color.id, width: 150 });
  const on = await quickShip([q1, q2, q3], customer.id);
  const onShipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: on.data.id },
    select: { shipmentNo: true, dispatchedAt: true },
  });
  const onInv = await invoicesOf(on.data.id);
  check("§2a ⭐ Bayrak AÇIK → taslak DOĞDU (tek fatura)", onInv.length === 1, `${onInv.length} fatura`);

  const inv = onInv[0];
  if (!inv) {
    check("§2 ATLANDI — fatura doğmadı, alt kontroller ölçülemez", false);
  } else {
    check("§2b Tür SALES", inv.type === InvoiceType.SALES, inv.type);
    check("§2c Durum DRAFT (onay HER ZAMAN elle)", inv.status === InvoiceStatus.DRAFT, inv.status);
    check(
      "§2d Kaynak bağı TYPED FK ile sevkiyata yazıldı (mal kabul alanı boş)",
      inv.shipmentId === on.data.id && inv.goodsReceiptId === null,
      `${inv.docNo} shipmentId=${inv.shipmentId === on.data.id ? "eşleşti" : inv.shipmentId}`,
    );
    const gap = onShipment.dispatchedAt ? Math.abs(inv.issueDate.getTime() - onShipment.dispatchedAt.getTime()) : Number.NaN;
    check(
      "§2e ⭐ issueDate = sevkiyatın dispatchedAt'i (`new Date()` değil — gece yarısını geçen sevk ertesi güne atmasın)",
      Number.isFinite(gap) && gap <= 2000,
      `fark=${Number.isFinite(gap) ? gap : "?"} ms`,
    );
    check("§2f notes sevkiyat numarasını taşıyor", (inv.notes ?? "").includes(onShipment.shipmentNo), inv.notes ?? "(boş)");
    check("§2g Para birimi TRY (cari kartı yokken varsayılan)", inv.currency === Currency.TRY, inv.currency);

    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId: inv.id },
      orderBy: { lineNo: "asc" },
      select: { itemId: true, description: true, qty: true, unit: true, unitPrice: true, vatRate: true },
    });
    check("§2h ⭐ SATIR = ÜRÜN KIRILIMI, TOP DEĞİL (3 top / 2 ürün → 2 satır)", lines.length === 2, `${lines.length} satır`);

    const lineA = lines.find((l) => l.itemId === itemA.id);
    const lineB = lines.find((l) => l.itemId === itemB.id);
    check("§2i Aynı kalem+renk+en TEK satırda toplandı (120+80=200)", lineA != null && D(lineA.qty).equals(200), `qty=${lineA?.qty}`);
    check("§2j İkinci kalem kendi satırında (55)", lineB != null && D(lineB.qty).equals(55), `qty=${lineB?.qty}`);
    // Açıklama biçimi `collectShipmentDocContent`'in ürün özetiyle BİREBİR
    // aynı olmalı (JSDoc sözleşmesi): muhasebeci faturayı sevk fişinin yanına
    // koyup satır satır karşılaştırıyor.
    const wantDesc = `${itemA.name} ${color.name} 150cm.`;
    check(
      "§2k Açıklama biçimi ürün özetiyle birebir (`ürün renk Ncm.`)",
      lineA?.description === wantDesc,
      lineA?.description === wantDesc ? wantDesc : `gelen="${lineA?.description}" beklenen="${wantDesc}"`,
    );
    check(
      "§2l ⭐ Birim DEFTERİN birimi 'm' (kart 'MT' yazıyor diye o basılmaz)",
      lineA?.unit === "m" && lineB?.unit === "m",
      `${lineA?.unit}/${lineB?.unit}`,
    );
    check(
      "§2m ⭐ Fiyat D2 zincirinden — müşteri istisnası (12.50) kart varsayılanını (10.00) EZDİ",
      lineA != null && D(lineA.unitPrice).equals("12.5"),
      `unitPrice=${lineA?.unitPrice}`,
    );
    check(
      "§2n ⭐ Fiyatsız kalem 0 ile doğar (taslak yine üretilir — uyarıyı onay seddi verir)",
      lineB != null && D(lineB.unitPrice).equals(0),
      `unitPrice=${lineB?.unitPrice}`,
    );
    const wantVat = await readFinanceDefaultVatRate();
    check(
      "§2o KDV oranı firma parametresinden (üç yüzey tek ayardan okur)",
      lines.every((l) => D(l.vatRate).equals(wantVat)),
      `beklenen=${wantVat} gelen=${lines.map((l) => String(l.vatRate)).join(",")}`,
    );
    check(
      "§2p ⭐ Yanıt mesajına taslak notu eklendi (sessiz doğru cevap ≠ görünür cevap)",
      (on.message ?? "").includes("fatura taslağı oluşturuldu") && (on.message ?? "").includes(inv.docNo),
      JSON.stringify(on.message),
    );

    // ── §3 İDEMPOTENT KANCA ───────────────────────────────────────────────
    // Kanca PRIVATE; bekçi onu doğrudan çağırır çünkü ölçülecek şey tam olarak
    // "aynı sevkiyat için İKİNCİ kez tetiklenirse ne olur" sorusudur ve public
    // yollar (ikinci dispatch) daha önce, başka bir guard'da reddediliyor —
    // yani kancanın kendi seddi hiç sınanmamış olurdu.
    const before = await prisma.invoice.count({ where: { shipmentId: on.data.id } });
    const hook = (shippingService as unknown as {
      maybeAutoDraftInvoiceAfterDispatch: (shipmentId: string, userId?: string) => Promise<string | null>;
    }).maybeAutoDraftInvoiceAfterDispatch.bind(shippingService);
    const again = await hook(on.data.id);
    const after = await prisma.invoice.count({ where: { shipmentId: on.data.id } });
    check("§3a Tekrar tetiklenince kanca sessizce no-op (not döndürmez)", again === null, String(again));
    check("§3b ⭐ İKİNCİ taslak DOĞMADI (fatura sayısı değişmedi)", after === before && after === 1, `${before} → ${after}`);
  }

  // ── §4 MODÜL ŞALTERİ ────────────────────────────────────────────────────
  // `finance.enabled` bayrağın ÜSTÜNDE: modül kapalıyken özellik bayrağı açık
  // olsa bile kanca no-op'tur (bayrağın JSDoc sözleşmesi). Ölçülmezse modül
  // kapalı bir kurulumda muhasebe verisi sessizce doğmaya başlar.
  await setFlag(FIN_KEY, false);
  const g1 = await makeRoll(itemA.id, 45, wh.id, { colorId: color.id, width: 150 });
  const gated = await quickShip([g1], customer.id);
  const gatedInv = await invoicesOf(gated.data.id);
  check("§4a ⭐ finance.enabled KAPALI + bayrak AÇIK → taslak DOĞMADI", gatedInv.length === 0, `${gatedInv.length} fatura`);
  check(
    "§4b Mesaj yine bayt-bayt bugünkü",
    gated.message === `Sevk edildi: ${gated.data.shipmentNo} (1 top)`,
    JSON.stringify(gated.message),
  );
  await setFlag(FIN_KEY, true);

  // ── §5 ONAY AÇIK REJİMİ ─────────────────────────────────────────────────
  // Kancanın üç çağrı yolu var; §1-§4 `createShipmentFromRolls` yolunu ölçtü.
  // Burada `dispatchShipment` yolu ölçülür: PLANNED bir sevkiyat "mal çıktı"
  // demez, taslak ancak onayda doğar.
  await setFlag(CONF_KEY, true);
  const c1 = await makeRoll(itemA.id, 70, wh.id, { colorId: color.id, width: 150 });
  const planned = await quickShip([c1], customer.id);
  check("§5a Ön koşul: onay açıkken sevkiyat PLANNED kuruldu", !planned.data.dispatched && planned.data.status === ShipmentStatus.PLANNED, `status=${planned.data.status}`);
  const plannedInv = await invoicesOf(planned.data.id);
  check("§5b ⭐ PLANNED sevkiyatta taslak YOK (mal henüz çıkmadı)", plannedInv.length === 0, `${plannedInv.length} fatura`);
  check(
    "§5c Mesaj bayt-bayt bugünkü (onay bekleyen dal)",
    planned.message === `Sevkiyat kuruldu (onay bekliyor): ${planned.data.shipmentNo}`,
    JSON.stringify(planned.message),
  );
  const dispatched = (await shippingService.dispatchShipment(planned.data.id, {})) as { message?: string };
  const dispatchedInv = await invoicesOf(planned.data.id);
  check("§5d ⭐ Onaydan SONRA taslak DOĞDU (dispatchShipment yolu da kancaya bağlı)", dispatchedInv.length === 1, `${dispatchedInv.length} fatura`);
  check(
    "§5e Onay mesajına da taslak notu eklendi",
    (dispatched.message ?? "").includes("fatura taslağı oluşturuldu"),
    JSON.stringify(dispatched.message),
  );

  // ── §6 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  // "İhlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın:
  // fixture gerçekten kurulmadıysa yukarıdaki tüm sayımlar vakumen doğrudur.
  check("§6a Fixture zemini: en az 4 sevkiyat kuruldu", shipmentIds.length >= 4, `${shipmentIds.length} sevkiyat`);
  check("§6b Fixture zemini: en az 7 top üretildi", rollIds.length >= 7, `${rollIds.length} top`);
  const totalInv = await prisma.invoice.count({ where: { shipmentId: { in: shipmentIds } } });
  check("§6c Fixture zemini: en az 2 taslak gerçekten doğdu", totalInv >= 2, `${totalInv} fatura`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await restoreFlags().catch((e) => console.error("bayrak geri yükleme:", e));

    // FATURA ZİNCİRİ — satır → belge → fatura (InvoiceLine.item FK'si RESTRICT,
    // yani kalemler ancak satırlar gittikten sonra silinebilir).
    const invRows = shipmentIds.length > 0 ? await prisma.invoice.findMany({ where: { shipmentId: { in: shipmentIds } }, select: { id: true } }) : [];
    const invIds = invRows.map((i) => i.id);
    if (invIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: invIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
    }
    // Cari hesap kancanın LAZY açtığı kayıttır (ensureCariAccountTx) — müşteri
    // FK'si RESTRICT olduğu için müşteriden ÖNCE silinmeli.
    if (customerId) {
      const cari = await prisma.cariAccount.findMany({ where: { customerId }, select: { id: true } });
      const cariIds = cari.map((c) => c.id);
      if (cariIds.length > 0) {
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
    }
    if (shipmentIds.length > 0) {
      await prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: shipmentIds } } } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
    }
    if (rollIds.length > 0) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (shipmentIds.length > 0) await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    // SÜPÜRME: hızlı sevkin doğurduğu çuval operatöre görünmez ve id'si yanıtta
    // dönmez — kod bozukken (negatif sonda) yarım kalan çuval listeye HİÇ
    // girmez ve `test_consistency` §6'yı kırmızıya düşürürdü.
    if (customerId) await prisma.sack.deleteMany({ where: { customerId } });
    if (itemIds.length > 0) {
      await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    if (shipmentIds.length > 0 || invIds.length > 0) {
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...shipmentIds, ...invIds] } } });
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
