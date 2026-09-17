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
//   J) ⭐ J1 BAYRAKLARI (2026-08-15) — İKİSİ DE VARSAYILAN KAPALI:
//      `purchase.blockOverReceiptEnabled` (siparişten fazla kabulü engelle) ve
//      `goodsReceipt.requirePriceEnabled` (satırda birim fiyat zorunlu).
//      İLK KONTROL HER İKİSİNDE DE KAPALI-PARİTEDİR: bayrak kapalıyken fazla
//      mal YAZILIR (yalnız uyarılır) ve fiyatsız satır KABUL EDİLİR — yani
//      bugünkü davranış bayt-bayt korunur. Açıkken: satır bazlı 400, mesaj
//      SOMUT (kalem + sipariş miktarı + gelmiş + bu satırla oluşacak / para
//      birimi) ve YOL GÖSTERİR (hangi ayar, hangi ekrandan kapatılır).
//      MUAFİYET SONDALARI: siparişsiz (serbest) fiş · fiş iptali (ters yol) ·
//      `unitPrice: 0` (bedava numune "fiyat yok" DEĞİLDİR).
//      PARÇALI SONUÇ: engellenen satır `failed[]`e sebebiyle düşer, SAĞLAM
//      satır KALIR ("42 girdi, 8'ini yutma" kuralı) ve iki guard'ın SIRASI
//      (önce fiyat = satırın kendi tutarlılığı, sonra sipariş kapsaması =
//      bağlam) mekanik olarak kilitlidir.
//   K) ⭐ C4 (2026-08-15) — TEDARİKÇİ = müşteri-tipli cari **XOR** fason firma.
//      Alış HER cariden yapılabilir (Logo/Mikro/SAP BP) ama TEK cariden. XOR
//      ihlali 400 + İZ BIRAKMAZ; fason bacağı kolona yazılır; detay/liste İKİ
//      bacağı da AYNI şekilde (`{id, code, name}`) döner; alış siparişi uyumu
//      BACAK+KİMLİK birlikte ölçülür (yalnız `supplierId` karşılaştıran eski
//      kural iki NULL'u "eşit" sayıp fişi yanlış cariye yazardı); donmuş fiş
//      belgesi fason adını basar; GR→alış faturası `CariKind.SUBCONTRACTOR`
//      hesabına bağlanır.
//   L) ⭐ C2 (2026-08-15) — FİŞ SEVİYESİNDE HAM STOK GİRİŞİ (`rawStockEntry`).
//      İLK KONTROL KAPALI-PARİTE: alan yokken (ve `false` iken) toplar
//      `WAREHOUSE` doğar — bugünkü davranış bayt-bayt. Açıkken `STOCK` + 'H'
//      barkod tipi; karar FİŞTE saklandığı için SONRADAN eklenen satır da aynı
//      rafa düşer; İPLİK dalı ETKİLENMEZ (kg defteri raf taşımaz); ham stok
//      fişi İPTAL EDİLEBİLİR (`STOCK` iptal-edilebilir statü listesinde —
//      olmasaydı bu fişler tanım gereği iptal edilemezdi).
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
import {
  GoodsReceiptStatus,
  ItemType,
  ItemUnit,
  PriceKind,
  Prisma,
  RollEntrySource,
  RollStatus,
  WarehouseEventType,
  YarnMovementKind,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { InventoryService } from "../src/services/inventory.service";
import { invoiceService } from "../src/services/invoice.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
// §K — fason firma TEST tarafından üretilir; seed'in `BOYER`i pasif olabilir
// ve `findFirst` onu yine bulur (2026-08-02 saha bulgusu, fixture dosyası başlığı).

import { ensureIplikModuluAcik } from "./fixture-module-flags";

/** ⚠️ Modül düzeyinde: `finally` bloğu `main()` gövdesinin DIŞINDA koşar. */
let modulGeriAl: (() => Promise<void>) | null = null;
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
/**
 * Fişlerin GENEL kalemi — testin KENDİ yarattığı FABRIC kalemi.
 *
 * ⚠️ 2026-09-13: burası `item.findFirst({ isActive: true })` idi, yani "ortamda
 * herhangi bir aktif kalem" varsayıyordu ([TD-38] / reçete md. 11 ihlali).
 * Ölçüldü: aktif kalemi olmayan bir DB'de bekçi 0/1 ile P2025 verdi. §H ve §9
 * kendi kalemlerini zaten yaratıyordu — eksik olan TEK yer bu genel kalemdi.
 *
 * ⚠️ TÜR FABRIC ve BİLİNÇLİ: `goods-receipt.service` yalnız `itemType === YARN`
 * dalında kg defterine yazar; ortamdan gelen kalem hangi türdeyse ölçülen dal da
 * o oluyordu. Sabit bir FABRIC kalem, ölçümü koşumdan bağımsız kılar.
 */
let baseItemId: string | null = null;
/** §H fixture'ı — testin KENDİ yarattığı YARN kalemi (ortam verisine bağımlılık YASAK). */
let yarnItemId: string | null = null;
let sarfItemId: string | null = null;
/** §J fixture'ları — bayrak bölümü KENDİ kalemlerini/siparişlerini yaratır:
 *  ortamdaki bir kalemin fiyat satırı olup olmadığına bağlı bir bekçi, dolu
 *  dev DB'sinde yeşil, temiz CI DB'sinde kırmızı olurdu (ve tersi). */
const jItemIds: string[] = [];
const jOrderIds: string[] = [];
const jCustomerIds: string[] = [];
/** §K + §L fixture'ları (C4 fason bacağı + C2 raf kararı). */
const kItemIds: string[] = [];
const kOrderIds: string[] = [];
const kCustomerIds: string[] = [];
const kSubcontractorIds: string[] = [];
const kInvoiceIds: string[] = [];

const OVER_KEY = SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED;
const PRICE_KEY = SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED;
const priorFlags = new Map<string, { existed: boolean; value: Prisma.JsonValue }>();

/** Ayar doğrudan yazılır (enforcement reader cache'siz → anında etkili);
 *  HTTP/panel sözleşmesini `test_feature_flag_contract` ölçer. */
async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}

async function rememberFlag(key: string): Promise<void> {
  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  priorFlags.set(key, { existed: row !== null, value: row?.value ?? null });
}

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
// ⚠️ MODÜL ORTAMI (2026-09-02): iplik kg defterinin kapısı SERVİS düzeyindedir
// (`applyYarnMovementTx` ilk işi `readIplikEnabled`). Fabrika profilinde iplik
// KAPALI olduğu için bu test onsuz 403 alır ve defteri HİÇ ölçemez. Fixture
// modülü açar, `finally` BULDUĞU değere geri yazar — gevşetilen kapı DEĞİL,
// kurulan ORTAMDIR (kapının kendi bekçileri: test_iplik_regime_gate §4d +
// test_module_flag_off).
  modulGeriAl = await ensureIplikModuluAcik();

  console.log("=== Mal kabul bekçisi ===\n");

  const def = await ensureDefaultWarehouse();
  const item = await prisma.item.create({
    data: { code: `${TAG}-KUM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  baseItemId = item.id;

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

  // ── A9) KK1 AĞIRLIK POLİTİKASI MAL KABULE SIZMAZ (saha planı A1, 2026-08-15)
  // `kk1.weightEntryEnabled` bir KK1 İSTASYON politikasıdır (kantar yoksa elle
  // kg girilmesin); mal kabul ise DEPO GİRİŞİDİR ve kumaş kg+metre çift birimle
  // alınır. Muafiyet (`skipKk1WeightPolicy`) düşerse bu satır "Ağırlık (kg)
  // girişi bu istasyonda kapalı" ile reddedilir — saha vakası: 10 satır birden.
  // AYRI fişte ölçülür ki A/B bölümlerinin defter beklentileri değişmesin.
  await rememberFlag("kk1.weightEntryEnabled");
  await setFlag("kk1.weightEntryEnabled", false);
  const kgReceipt = await goodsReceiptService.create({ warehouseId: wh.id });
  const kgReceiptId = (kgReceipt.data as { id: string }).id;
  receiptIds.push(kgReceiptId);
  const kgOut = (await goodsReceiptService.addLines(kgReceiptId, [
    { itemId: item.id, initialQty: 40, weightKg: 12.5 },
  ])) as unknown as { created: string[]; failed: Array<{ reason: string }> };
  check(
    "A9) ⭐ Bayrak KAPALIYKEN kg'li mal kabul satırı KABUL edildi",
    kgOut.created.length === 1 && kgOut.failed.length === 0,
    kgOut.failed[0]?.reason?.slice(0, 70) ?? "",
  );
  const kgRoll = await prisma.roll.findFirst({
    where: { goodsReceiptId: kgReceiptId },
    select: { weightKg: true },
  });
  check("A9b) Ağırlık topa yazıldı (12.5 kg)", kgRoll != null && Number(kgRoll.weightKg) === 12.5, String(kgRoll?.weightKg));

  // ── A10) ⭐ `Roll` YALNIZ KUMAŞ DOĞURUR — kapı FAIL-CLOSED ────────────────
  // İplik dalı (`itemType === YARN`) satırı kg defterine götürür; geri kalan HER
  // tür `createInitialEntry`'ye düşüyordu ve orada tür kontrolü YOKTU → bir varil
  // boya (`CONSUMABLE`) barkodlu bir KUMAŞ TOPU doğurup metrajla envantere
  // yazılıyordu. Kapı "FABRIC ise geç" kurulur: enuma dördüncü tür eklendiği gün
  // sessizce top doğurmasın.
  const sarfItem = await prisma.item.create({
    data: { code: `${TAG}-SARF`, name: `${TAG} Boya`, itemType: ItemType.CONSUMABLE, unit: ItemUnit.KG },
    select: { id: true },
  });
  sarfItemId = sarfItem.id;
  const sarfReceipt = await goodsReceiptService.create({ warehouseId: wh.id });
  const sarfReceiptId = (sarfReceipt.data as { id: string }).id;
  receiptIds.push(sarfReceiptId);
  const sarfOut = (await goodsReceiptService.addLines(sarfReceiptId, [
    { itemId: sarfItem.id, initialQty: 25 },
  ])) as unknown as { created: string[]; failed: Array<{ reason: string }> };
  check(
    "A10) ⭐ SARF kalemi satırı REDDEDİLDİ (top doğmadı)",
    sarfOut.created.length === 0 && sarfOut.failed.length === 1,
    `created=${sarfOut.created.length} failed=${sarfOut.failed.length}`,
  );
  check(
    "A10b) Red sebebi kalem TÜRÜNÜ söylüyor (operatör ne yapacağını bilsin)",
    Boolean(sarfOut.failed[0]?.reason?.includes("top olarak eklenemez")),
    sarfOut.failed[0]?.reason?.slice(0, 80) ?? "",
  );
  const sarfRolls = await prisma.roll.count({ where: { itemId: sarfItem.id } });
  check("A10c) ⭐ Sarf kaleminden HİÇ top doğmadı (envanter kirlenmedi)", sarfRolls === 0, `top=${sarfRolls}`);

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

  // ── D) Doğrulama sınıfı hata: HEPSİ YA DA HİÇBİRİ (C8, 2026-09-17) ─────────
  // Eski D: "hatalı satır failed[]'e düşer, sağlam satır kalır" — bu, DOĞRULAMA sınıfı (var olmayan ürün, lot
  // zorunlu, bobin…) için içi boş/yarım fiş doğuruyordu (kullanıcı bulgusu C8). Artık ön-uçuş: fiş BAŞLIĞI
  // açılmadan 400 `RECEIPT_LINES_INVALID`, sağlam satır da YAZILMAZ. `failed[]` sözleşmesi KOŞU ANI hataları
  // (yarış/409 — bkz. §F/§G iptal yarışı) için aynen kalır. Ayrıntı: test_goods_receipt_preflight.
  const n0 = await prisma.goodsReceipt.count({ where: { warehouseId: wh.id } });
  type PreflightErr = { code?: string; lines?: Array<{ lineNo: number; code: string }> };
  let partialErr = null as PreflightErr | null;
  try {
    await goodsReceiptService.create({
      warehouseId: wh.id,
      lines: [
        { itemId: item.id, initialQty: 30 },
        { itemId: "00000000-0000-4000-8000-000000000000", initialQty: 20 }, // var olmayan ürün
      ],
    });
  } catch (e) {
    partialErr = (e as { details?: PreflightErr }).details ?? null;
  }
  check("D1) ⭐ var olmayan ürün → 400 RECEIPT_LINES_INVALID, hatalı satır SEBEBİYLE (lineNo 2, ITEM_NOT_FOUND)", partialErr?.code === "RECEIPT_LINES_INVALID" && partialErr.lines?.[0]?.lineNo === 2 && partialErr.lines[0]!.code === "ITEM_NOT_FOUND", JSON.stringify(partialErr?.lines));
  check("D2) ⭐ sağlam satır da yazılmadı, fiş başlığı doğmadı (hepsi ya da hiçbiri)", (await prisma.goodsReceipt.count({ where: { warehouseId: wh.id } })) === n0);

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

  // ── §J ⭐ J1 BAYRAKLARI ───────────────────────────────────────────────────
  // İkisi de OPT-IN. Bölümün İLK kontrolü her iki bayrakta da KAPALI-PARİTEDİR:
  // "bayrak kapalı = bugünkü davranış bayt-bayt" iddiası ölçülmeden geri kalan
  // her kontrol havada kalır.
  {
    await rememberFlag(OVER_KEY);
    await rememberFlag(PRICE_KEY);
    await setFlag(OVER_KEY, false);
    await setFlag(PRICE_KEY, false);

    const supplier = await prisma.customer.create({
      data: { code: `${TAG}-TED`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
      select: { id: true },
    });
    jCustomerIds.push(supplier.id);

    const mkItem = async (suffix: string, type: ItemType, unit: ItemUnit): Promise<{ id: string; name: string }> => {
      const it = await prisma.item.create({
        data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}`, itemType: type, unit },
        select: { id: true, name: true },
      });
      jItemIds.push(it.id);
      return it;
    };
    // Fiyat satırı OLMAYAN kalemler (②'nin "çözülemedi" dalı) + kart fiyatı OLAN
    // bir kalem (②'nin ön-dolum dalı) + siparişte HİÇ olmayan kalem (①'in
    // unmatched dalı) + iplik (iki guard da satır TİPİNDEN bağımsız olmalı).
    const jFab = await mkItem("JKUM", ItemType.FABRIC, ItemUnit.MT);
    const jOther = await mkItem("JKUM2", ItemType.FABRIC, ItemUnit.MT);
    const jYarn = await mkItem("JIPL", ItemType.YARN, ItemUnit.KG);
    const jPriced = await mkItem("JFIY", ItemType.FABRIC, ItemUnit.MT);
    await prisma.itemPrice.create({
      data: { itemId: jPriced.id, kind: PriceKind.PURCHASE, currency: "TRY", price: new Prisma.Decimal("7.25") },
    });

    const mkOrder = async (itemId: string, qty: number): Promise<{ id: string; orderNo: string }> => {
      const po = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId, qty }] }))
        .data as unknown as { id: string; orderNo: string };
      jOrderIds.push(po.id);
      return po;
    };
    const mkReceipt = async (purchaseOrderId: string | null): Promise<string> => {
      const r = await goodsReceiptService.create({
        warehouseId: wh.id,
        supplierId: supplier.id,
        ...(purchaseOrderId ? { purchaseOrderId } : {}),
      });
      const id = (r.data as { id: string }).id;
      receiptIds.push(id);
      return id;
    };
    type LinesOutJ = {
      created: string[];
      createdYarn: string[];
      failed: Array<{ index: number; reason: string }>;
    };
    const reasonOf = (out: LinesOutJ, index: number): string =>
      out.failed.find((f) => f.index === index)?.reason ?? "";

    // ── J1) ① FAZLA KABUL ENGELİ ──────────────────────────────────────────
    // J1a — KAPALI PARİTE: 100 ısmarlandı, 140 geldi → satır YAZILIR ve yalnız
    // UYARILIR. Bu, bayrağın var oluş sebebi olan bugünkü davranıştır; bozulursa
    // fabrikada fazla mal sisteme HİÇ girilemez hâle gelir.
    const poOff = await mkOrder(jFab.id, 100);
    const rOff = await mkReceipt(poOff.id);
    const outOff = (await goodsReceiptService.addLines(rOff, [
      { itemId: jFab.id, initialQty: 140 },
    ])) as unknown as LinesOutJ & { purchaseOrder: { overReceiptLines: number[] } | null };
    check(
      "J1a) ⭐ BAYRAK KAPALI: fazla kabul YAZILDI (1 top, 0 atlanan) — bugünkü davranış bayt-bayt",
      outOff.created.length === 1 && outOff.failed.length === 0,
      `created=${outOff.created.length} failed=${outOff.failed.length}`,
    );
    check(
      "J1b) ⭐ Kapalı rejimde UYARI korunuyor (overReceiptLines dolu)",
      (outOff.purchaseOrder?.overReceiptLines.length ?? 0) === 1,
      JSON.stringify(outOff.purchaseOrder?.overReceiptLines),
    );

    // J1c — AÇIK: aynı senaryo 400 ile reddedilir, mesaj SOMUT + YOL GÖSTERİR.
    await setFlag(OVER_KEY, true);
    const poOn = await mkOrder(jFab.id, 100);
    const rOn = await mkReceipt(poOn.id);
    const outOn = (await goodsReceiptService.addLines(rOn, [
      { itemId: jFab.id, initialQty: 140 },
    ])) as unknown as LinesOutJ;
    const onReason = reasonOf(outOn, 0);
    check(
      "J1c) ⭐ BAYRAK AÇIK: aşan satır REDDEDİLDİ ve failed[]'e SEBEBİYLE düştü",
      outOn.created.length === 0 && outOn.failed.length === 1,
      `created=${outOn.created.length} failed=${outOn.failed.length}`,
    );
    check(
      "J1d) ⭐ Mesaj SOMUT: kalem + sipariş no + ısmarlanan + gelmiş + bu satırla oluşacak",
      onReason.includes(jFab.name) &&
        onReason.includes(poOn.orderNo) &&
        onReason.includes("100 m") &&
        onReason.includes("140 m") &&
        onReason.includes("40 m fazla"),
      onReason.slice(0, 160),
    );
    check(
      "J1e) ⭐ Mesaj YOL GÖSTERİYOR (hangi ayar + hangi ekrandan kapatılır + siparişsiz fiş çıkışı)",
      onReason.includes("Siparişten fazla mal kabulünü engelle") &&
        onReason.includes("Ayarlar > Depo & Satın Alma") &&
        onReason.includes("siparişe bağlı OLMAYAN"),
      onReason.slice(-140),
    );
    const rollsOn = await prisma.roll.count({ where: { goodsReceiptId: rOn } });
    check("J1f) ⭐ Reddedilen satır İZ BIRAKMADI (fişte top yok)", rollsOn === 0, `top=${rollsOn}`);

    // J1g — SINIR: eşitlik aşım DEĞİL (100 ısmarlandı, 100 geldi → geçer).
    const poEq = await mkOrder(jFab.id, 100);
    const rEq = await mkReceipt(poEq.id);
    const outEq = (await goodsReceiptService.addLines(rEq, [
      { itemId: jFab.id, initialQty: 100 },
    ])) as unknown as LinesOutJ;
    check(
      "J1g) ⭐ Sipariş miktarına EŞİT satır geçer (aşım değil)",
      outEq.created.length === 1 && outEq.failed.length === 0,
      `created=${outEq.created.length} failed=${outEq.failed.length}`,
    );

    // J1h — PENDING SAYACI: aynı çağrıda 60 + 60. Kaynak okuması çağrı başında
    // yapıldığı için, çağrı-içi sayaç olmasaydı İKİSİ de "60 ≤ 100" diye geçer
    // ve guard tam kendi fişinde delinirdi.
    const poSplit = await mkOrder(jFab.id, 100);
    const rSplit = await mkReceipt(poSplit.id);
    const outSplit = (await goodsReceiptService.addLines(rSplit, [
      { itemId: jFab.id, initialQty: 60 },
      { itemId: jFab.id, initialQty: 60 },
    ])) as unknown as LinesOutJ;
    check(
      "J1h) ⭐ ÇAĞRI-İÇİ SAYAÇ: 60 geçti, ikinci 60 aşımdan reddedildi",
      outSplit.created.length === 1 &&
        outSplit.failed.length === 1 &&
        reasonOf(outSplit, 1).includes("60 m gelmiş"),
      `created=${outSplit.created.length} failed=${outSplit.failed.length} · ${reasonOf(outSplit, 1).slice(0, 90)}`,
    );

    // J1i — SİPARİŞTE HİÇ OLMAYAN ÜRÜN de engellenir, mesajı AYRIDIR.
    const outUnmatched = (await goodsReceiptService.addLines(rEq, [
      { itemId: jOther.id, initialQty: 5 },
    ])) as unknown as LinesOutJ;
    check(
      "J1i) ⭐ Siparişte OLMAYAN ürün reddedildi ve sebebi ayrı cümle ('siparişinde YOK')",
      outUnmatched.created.length === 0 &&
        reasonOf(outUnmatched, 0).includes("siparişinde YOK") &&
        reasonOf(outUnmatched, 0).includes("Yanlış sipariş seçilmiş olabilir"),
      reasonOf(outUnmatched, 0).slice(0, 120),
    );

    // J1j — MUAFİYET: SİPARİŞSİZ (serbest) fiş. Bayrak AÇIKKEN bile geçer —
    // guard'ın kapsamı "siparişe bağlı fiş"tir; serbest kabulü kilitlemek malı
    // kayıt dışı bırakırdı (üretici fabrika akışı da bu daldan geçer).
    const rFree = await mkReceipt(null);
    const outFree = (await goodsReceiptService.addLines(rFree, [
      { itemId: jFab.id, initialQty: 500 },
    ])) as unknown as LinesOutJ;
    check(
      "J1j) ⭐ MUAF: siparişsiz fişte 500 m geçti (bayrak açıkken de)",
      outFree.created.length === 1 && outFree.failed.length === 0,
      `created=${outFree.created.length} failed=${outFree.failed.length}`,
    );

    // J1k — MUAFİYET: TERS YOL. Bayrak AÇIKKEN fiş iptali çalışmalı; guard
    // satır doğuran yola bağlıdır, "her mal kabul yoluna" değil.
    const cancelOut = await goodsReceiptService.cancel(rEq, `${TAG} bayrak muafiyeti`);
    const rEqStatus = await prisma.goodsReceipt.findUnique({ where: { id: rEq }, select: { status: true } });
    check(
      "J1k) ⭐ MUAF: bayrak açıkken fiş İPTALİ geçti (ters yol kilitlenmedi)",
      rEqStatus?.status === GoodsReceiptStatus.CANCELLED &&
        (cancelOut.data as { cancelledRolls: number }).cancelledRolls === 1,
      `status=${rEqStatus?.status}`,
    );

    // ── J2) ② BİRİM FİYAT ZORUNLULUĞU ─────────────────────────────────────
    await setFlag(OVER_KEY, false);
    // J2a — KAPALI PARİTE: fiyatsız satır kabul edilir ve fiyat NULL kalır
    // ("fiyat bilinmiyor" ≠ "bedava" — sıfıra düşmez).
    const rPriceOff = await mkReceipt(null);
    const outPriceOff = (await goodsReceiptService.addLines(rPriceOff, [
      { itemId: jFab.id, initialQty: 10 },
    ])) as unknown as LinesOutJ;
    const priceOffRoll = await prisma.roll.findUnique({
      where: { id: outPriceOff.created[0] ?? "" },
      select: { purchasePrice: true },
    });
    check(
      "J2a) ⭐ BAYRAK KAPALI: fiyatsız satır kabul edildi, fiyat NULL kaldı",
      outPriceOff.created.length === 1 && priceOffRoll?.purchasePrice === null,
      `created=${outPriceOff.created.length} fiyat=${String(priceOffRoll?.purchasePrice)}`,
    );

    await setFlag(PRICE_KEY, true);
    const rPriceOn = await mkReceipt(null);
    const outPriceOn = (await goodsReceiptService.addLines(rPriceOn, [
      { itemId: jFab.id, initialQty: 10 },
    ])) as unknown as LinesOutJ;
    const priceReason = reasonOf(outPriceOn, 0);
    check(
      "J2b) ⭐ BAYRAK AÇIK: fiyatı çözülemeyen satır reddedildi (failed[] + iz yok)",
      outPriceOn.created.length === 0 &&
        outPriceOn.failed.length === 1 &&
        (await prisma.roll.count({ where: { goodsReceiptId: rPriceOn } })) === 0,
      `created=${outPriceOn.created.length}`,
    );
    check(
      "J2c) ⭐ Mesaj SOMUT + YOL GÖSTERİYOR (kalem + para birimi + iki çıkış yolu + ayar)",
      priceReason.includes(jFab.name) &&
        priceReason.includes("TRY alış fiyatı") &&
        priceReason.includes("Tanımlar > Kalem Fiyatları") &&
        priceReason.includes("Ayarlar > Depo & Satın Alma"),
      priceReason.slice(0, 170),
    );

    // J2d — SATIRIN KENDİ FİYATI zinciri karşılar.
    const outOwn = (await goodsReceiptService.addLines(rPriceOn, [
      { itemId: jFab.id, initialQty: 10, unitPrice: 12.5 },
    ])) as unknown as LinesOutJ;
    const ownRoll = await prisma.roll.findUnique({
      where: { id: outOwn.created[0] ?? "" },
      select: { purchasePrice: true },
    });
    check(
      "J2d) Satırda fiyat varsa geçer ve topa YAZILIR (12.5)",
      outOwn.created.length === 1 && Number(ownRoll?.purchasePrice) === 12.5,
      `fiyat=${String(ownRoll?.purchasePrice)}`,
    );

    // J2e — KALEM KARTI zinciri karşılar (guard KENDİ zincirini kurmuyor:
    // ölçülen şey mevcut `priceFor` ön-dolumunun sonucudur).
    const outCard = (await goodsReceiptService.addLines(rPriceOn, [
      { itemId: jPriced.id, initialQty: 10 },
    ])) as unknown as LinesOutJ;
    const cardRoll = await prisma.roll.findUnique({
      where: { id: outCard.created[0] ?? "" },
      select: { purchasePrice: true },
    });
    check(
      "J2e) ⭐ Kalem kartındaki alış fiyatı zinciri karşılıyor (7.25 ön-dolduruldu)",
      outCard.created.length === 1 && Number(cardRoll?.purchasePrice) === 7.25,
      `fiyat=${String(cardRoll?.purchasePrice)}`,
    );

    // J2f — MUAFİYET: `0` MEŞRU BİR FİYATTIR (bedava numune). Guard'ın falsy
    // kontrolüne kayması bu satırı sessizce reddederdi.
    const outZero = (await goodsReceiptService.addLines(rPriceOn, [
      { itemId: jFab.id, initialQty: 10, unitPrice: 0 },
    ])) as unknown as LinesOutJ;
    check(
      "J2f) ⭐ `unitPrice: 0` geçer (bedava numune ≠ fiyat yok)",
      outZero.created.length === 1 && outZero.failed.length === 0,
      `created=${outZero.created.length} failed=${outZero.failed.length}`,
    );

    // J2g — İPLİK satırı da aynı kapıdan geçer: guard satır TİPİNDEN bağımsız.
    const outYarn = (await goodsReceiptService.addLines(rPriceOn, [
      { itemId: jYarn.id, initialQty: 40 },
    ])) as unknown as LinesOutJ;
    const yarnRows = await prisma.yarnMovement.count({ where: { goodsReceiptId: rPriceOn } });
    check(
      "J2g) ⭐ Fiyatsız İPLİK satırı da reddedildi ve defterde hareket doğmadı",
      outYarn.createdYarn.length === 0 && outYarn.failed.length === 1 && yarnRows === 0,
      `iplik=${outYarn.createdYarn.length} hareket=${yarnRows}`,
    );

    // ── J3) PARÇALI SONUÇ + GUARD SIRASI (ikisi birden açık) ──────────────
    await setFlag(OVER_KEY, true);
    const poMix = await mkOrder(jFab.id, 100);
    const rMix = await mkReceipt(poMix.id);
    const outMix = (await goodsReceiptService.addLines(rMix, [
      { itemId: jFab.id, initialQty: 50, unitPrice: 10 }, // sağlam
      { itemId: jFab.id, initialQty: 10 }, // fiyat yok
      { itemId: jFab.id, initialQty: 80, unitPrice: 10 }, // 50+80 > 100 → aşım
      { itemId: jFab.id, initialQty: 500 }, // hem fiyatsız hem aşım
    ])) as unknown as LinesOutJ;
    check(
      "J3a) ⭐ PARÇALI SONUÇ: sağlam satır KALDI, üçü sebebiyle atlandı (yutulmadı)",
      outMix.created.length === 1 && outMix.failed.length === 3,
      `created=${outMix.created.length} failed=${outMix.failed.length}`,
    );
    check(
      "J3b) Sebepler AYRIŞIYOR: 2. satır fiyat, 3. satır sipariş kapsaması",
      reasonOf(outMix, 1).includes("birim fiyat çözülemedi") && reasonOf(outMix, 2).includes("ısmarlandı"),
      `${reasonOf(outMix, 1).slice(0, 40)} || ${reasonOf(outMix, 2).slice(0, 40)}`,
    );
    check(
      "J3c) ⭐ SIRA SÖZLEŞMESİ: iki guard da ihlal edilince ÖNCE fiyat söylenir (satırın kendi tutarlılığı)",
      reasonOf(outMix, 3).includes("birim fiyat çözülemedi"),
      reasonOf(outMix, 3).slice(0, 90),
    );

    check(
      "J-zemin) Körlük zemini: bayrak bölümü 4 kalem + 5 sipariş fixture'ı kurdu",
      jItemIds.length === 4 && jOrderIds.length >= 5,
      `kalem=${jItemIds.length} sipariş=${jOrderIds.length}`,
    );
  }

  // ── §K ⭐ C4 — TEDARİKÇİ = MÜŞTERİ-TİPLİ CARİ **XOR** FASON FİRMA ─────────
  // Alış HER cariden yapılabilir (Logo/Mikro/SAP BP standardı) ama TEK cariden:
  // "iki tedarikçili fiş" diye bir şey yoktur. Kural şemada CHECK ile değil
  // SERVİSTE (tek kapı) yaşıyor — çünkü operatörün duyması gereken şey bir
  // constraint adı değil somut bir cümledir; o cümlenin de tek kopyası olmalı.
  {
    // ⚠️ §J BAYRAKLARI AÇIK BIRAKIYOR (geri yükleme `finally`de). Aşağıdaki iki
    // bölüm o rejimi MİRAS ALMAMALI: `requirePriceEnabled` açıkken fiyatsız her
    // satır reddedilir ve §L'in ölçtüğü şey (topun hangi rafa doğduğu) hiç
    // ölçülemez — üstelik `every` boş dizide TRUE döndüğü için bazı kontroller
    // sahte-yeşil kalırdı (ilk yazımda tam bu oldu, ölçüldü).
    await setFlag(OVER_KEY, false);
    await setFlag(PRICE_KEY, false);

    // Rol modeli faz 2 (E): BAĞLI profil alış tarafında KARTA çözülür (`test_supplier_party_tek_adres`); C4 fason
    // bacağı BAĞSIZ profilindir → bu bölüm fixture'ın bağ durumundan bağımsız, kendi bağsız profiliyle ölçer.
    const dye = await prisma.subcontractor.create({ data: { code: `${TAG}-FSN`, name: `${TAG} Fason Bağsız` }, select: { id: true, name: true } });
    kSubcontractorIds.push(dye.id);
    const kSupplier = await prisma.customer.create({
      data: { code: `${TAG}-KTED`, name: `${TAG} K Tedarikçi`, type: "SUPPLIER" },
      select: { id: true },
    });
    kCustomerIds.push(kSupplier.id);
    const kItem = await prisma.item.create({
      data: { code: `${TAG}-KKUM`, name: `${TAG} K Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
      select: { id: true },
    });
    kItemIds.push(kItem.id);

    // K1 — XOR: iki bacak birden → 400 ve fiş DOĞMAZ. (İhlalin sessizce
    // "birini seçmesi" en kötü davranış olurdu: alış faturası yanlış cariye
    // borç yazar ve kimse sebebini göremez.)
    const beforeCount = await prisma.goodsReceipt.count();
    let xorErr = "";
    try {
      await goodsReceiptService.create({
        warehouseId: wh.id,
        supplierId: kSupplier.id,
        subcontractorId: dye.id,
      });
    } catch (e) {
      xorErr = (e as Error).message;
    }
    const afterCount = await prisma.goodsReceipt.count();
    check(
      "K1a) ⭐ XOR: iki tedarikçi birden → 400 (mesaj somut)",
      xorErr.includes("ikisi birden seçilemez"),
      xorErr.slice(0, 100),
    );
    check("K1b) ⭐ Reddedilen fiş İZ BIRAKMADI (fiş sayısı değişmedi)", beforeCount === afterCount, `${beforeCount} → ${afterCount}`);

    // K2 — Fason bacaklı fiş: kolon yazılır, müşteri bacağı NULL kalır.
    const kFason = await goodsReceiptService.create({
      warehouseId: wh.id,
      subcontractorId: dye.id,
      lines: [{ itemId: kItem.id, initialQty: 60, unitPrice: 5 }],
    });
    const kFasonId = (kFason.data as { id: string }).id;
    receiptIds.push(kFasonId);
    const kRow = await prisma.goodsReceipt.findUnique({
      where: { id: kFasonId },
      select: { supplierId: true, subcontractorId: true },
    });
    check(
      "K2a) ⭐ Fason firmadan mal kabul YAZILDI (subcontractorId dolu, supplierId NULL)",
      kRow?.subcontractorId === dye.id && kRow?.supplierId === null,
      `sub=${kRow?.subcontractorId?.slice(0, 8)} sup=${kRow?.supplierId}`,
    );

    // K3 — YÜZEY PARİTESİ: detay ve liste İKİ bacağı da AYNI şekilde döner.
    // Şekiller ayrışırsa panel hangi bacağın hangi alanı taşıdığını ezberler
    // ve ilk unutan yüzeyde tedarikçi hanesi sessizce boş kalır.
    const kDetail = (await goodsReceiptService.loadDetail(kFasonId)) as {
      subcontractorSupplier?: { id: string; code: string; name: string } | null;
      supplier?: unknown;
      rawStockEntry?: boolean;
    };
    check(
      "K3a) ⭐ Detay `subcontractorSupplier` {id, code, name} döndürüyor",
      kDetail.subcontractorSupplier?.id === dye.id &&
        typeof kDetail.subcontractorSupplier?.code === "string" &&
        typeof kDetail.subcontractorSupplier?.name === "string",
      JSON.stringify(kDetail.subcontractorSupplier),
    );
    const kList = await goodsReceiptService.list({ page: 1, pageSize: 200, filters: { subcontractorId: dye.id } });
    const kListRow = (kList.rows as Array<{ id: string; subcontractorSupplier?: { id: string; code: string; name: string } | null }>)
      .find((r) => r.id === kFasonId);
    check(
      "K3b) ⭐ Liste `filter[subcontractorId]` ile süzüyor + aynı şekli taşıyor",
      kListRow !== undefined && kListRow.subcontractorSupplier?.id === dye.id,
      `bulundu=${kListRow !== undefined}`,
    );

    // K4 — ALIŞ SİPARİŞİ UYUMU BACAK + KİMLİK BİRLİKTE ölçülür.
    // ⚠️ Yalnız `supplierId` eşitliğine bakan eski kural, fason siparişe
    // müşteri-tipli tedarikçili fiş bağlanmasına izin VERİRDİ ("iki taraf da
    // null" diye eşit sayılırdı) ve fiş sessizce yanlış cariye yazılırdı.
    const kFasonPo = (await purchaseOrderService.create({
      subcontractorId: dye.id,
      lines: [{ itemId: kItem.id, qty: 100 }],
    })).data as unknown as { id: string; orderNo: string };
    kOrderIds.push(kFasonPo.id);
    let mismatchErr = "";
    try {
      await goodsReceiptService.create({
        warehouseId: wh.id,
        supplierId: kSupplier.id,
        purchaseOrderId: kFasonPo.id,
      });
    } catch (e) {
      mismatchErr = (e as Error).message;
    }
    check(
      "K4a) ⭐ Fason siparişe MÜŞTERİ-tipli tedarikçili fiş bağlanamaz (bacak+kimlik)",
      mismatchErr.includes("aynı değil"),
      mismatchErr.slice(0, 90),
    );
    const kInherit = await goodsReceiptService.create({ warehouseId: wh.id, purchaseOrderId: kFasonPo.id });
    const kInheritId = (kInherit.data as { id: string }).id;
    receiptIds.push(kInheritId);
    const kInheritRow = await prisma.goodsReceipt.findUnique({
      where: { id: kInheritId },
      select: { supplierId: true, subcontractorId: true },
    });
    check(
      "K4b) ⭐ Tedarikçisiz fiş siparişten MİRAS aldı — fason bacağıyla",
      kInheritRow?.subcontractorId === dye.id && kInheritRow?.supplierId === null,
      `sub=${kInheritRow?.subcontractorId?.slice(0, 8)}`,
    );

    // K5 — RESMİ FİŞ BELGESİ de iki bacağı okur. Yalnız `supplier` okunsaydı
    // fason alımın kâğıdı tedarikçi hanesine "—" basardı; o kâğıt tam da
    // depocu-tedarikçi mutabakatının kendisidir.
    const kHtml = (await printedDocumentService.getHtml("GOODS_RECEIPT" as never, kFasonId)).data?.html ?? "";
    const kFrozen = await prisma.printedDocument.findFirst({
      where: { docType: "GOODS_RECEIPT", sourceId: kFasonId },
      select: { snapshot: true },
    });
    const kDoc = (kFrozen?.snapshot as { doc?: { header?: { supplierName?: string | null } } } | null)?.doc ?? {};
    check(
      "K5) ⭐ Donmuş fiş belgesi fason firmayı TEDARİKÇİ olarak basıyor",
      kDoc.header?.supplierName === dye.name && kHtml.includes(dye.name),
      `snapshot=${kDoc.header?.supplierName ?? "—"}`,
    );

    // K6 — GR → ALIŞ FATURASI: fason bacağı `invoice.subcontractorId` ile
    // doğar. Fatura katmanı iki tarafı zaten taşıyordu; eksik olan tek şey
    // fişin bacağını OKUMAKTI — okunmasaydı bu fişten fatura kesmenin hiçbir
    // yolu olmazdı (generic uç `goodsReceiptId` kabul etmiyor).
    // ⚠️ Hata YUTULMAZ, SEBEBE ÇEVRİLİR (L4 ile aynı gerekçe): fason bacağı
    // düşerse çağrı 400 fırlatır ve `await` main'i çökertir — kırmızı görünür
    // ama HANGİ kontrolün düştüğü yazmaz.
    let kInvErr = "";
    const kInv = await invoiceService.createDraftFromGoodsReceipt(kFasonId).catch((e: unknown) => {
      kInvErr = (e as Error).message;
      return { data: { id: "" } };
    });
    if (kInvErr) check("K6-hata) Fatura taslağı üretilemedi (sebep aşağıda)", false, kInvErr.slice(0, 120));
    const kInvId = (kInv.data as { id: string }).id;
    if (kInvId) kInvoiceIds.push(kInvId);
    // ⚠️ Taslak hiç doğmadıysa (yukarıdaki catch) `findUnique` boş id ile
    // çağrılıp ham bir Prisma hatasıyla ÇÖKERDİ; sonda koşan kişi K6a/K6b'yi
    // adıyla kırmızı görmeli.
    const kInvRow = kInvId
      ? await prisma.invoice.findUnique({
          where: { id: kInvId },
          select: {
            type: true,
            status: true,
            cari: { select: { kind: true, customerId: true, subcontractorId: true } },
          },
        })
      : null;
    check(
      "K6a) ⭐ Fason tedarikçili fişten ALIŞ FATURASI taslağı doğdu",
      kInvRow?.type === "PURCHASE" && kInvRow?.status === "DRAFT",
      `${kInvRow?.type}/${kInvRow?.status}`,
    );
    // Cari hesabın tek adresi KART (rol modeli faz 2): profil bağlıysa hesap kartta (kind=CUSTOMER), bağsızsa eski yol.
    const kProfil = await prisma.subcontractor.findUniqueOrThrow({ where: { id: dye.id }, select: { customerId: true } });
    const kBeklenen = kProfil.customerId
      ? kInvRow?.cari?.kind === "CUSTOMER" && kInvRow?.cari?.customerId === kProfil.customerId && kInvRow?.cari?.subcontractorId === null
      : kInvRow?.cari?.kind === "SUBCONTRACTOR" && kInvRow?.cari?.subcontractorId === dye.id && kInvRow?.cari?.customerId === null;
    check(
      `K6b) ⭐ Taslak fason carisine bağlandı — profil ${kProfil.customerId ? "BAĞLI → hesap KARTTA (kind=CUSTOMER)" : "BAĞSIZ → fason hesabı (kind=SUBCONTRACTOR)"}`,
      kBeklenen,
      `kind=${kInvRow?.cari?.kind} cust=${kInvRow?.cari?.customerId?.slice(0, 8)} sub=${kInvRow?.cari?.subcontractorId?.slice(0, 8)}`,
    );
  }

  // ── §L ⭐ C2 — FİŞ SEVİYESİNDE HAM STOK GİRİŞİ (`rawStockEntry`) ─────────
  // Perde/tekstil ticaretinde İKİ meşru alım var: satılacak BİTMİŞ mal
  // (`WAREHOUSE`) ve işlenmek üzere alınan HAM mal (fasona gidecek → `STOCK`).
  // İLK KONTROL KAPALI-PARİTEDİR: alan verilmeyince davranış bayt-bayt
  // bugünküdür — özelliğin bedeli yoksa gerisi konuşulabilir.
  {
    const lItem = await prisma.item.create({
      data: { code: `${TAG}-LKUM`, name: `${TAG} L Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
      select: { id: true },
    });
    kItemIds.push(lItem.id);
    const lYarn = await prisma.item.create({
      data: { code: `${TAG}-LIPL`, name: `${TAG} L İplik`, itemType: ItemType.YARN, unit: ItemUnit.KG },
      select: { id: true },
    });
    kItemIds.push(lYarn.id);

    // L1 — ALAN YOK → WAREHOUSE (bayt-bayt bugünkü davranış).
    const lDefault = await goodsReceiptService.create({
      warehouseId: wh.id,
      lines: [{ itemId: lItem.id, initialQty: 30 }],
    });
    const lDefaultId = (lDefault.data as { id: string }).id;
    receiptIds.push(lDefaultId);
    const lDefaultRolls = await prisma.roll.findMany({
      where: { goodsReceiptId: lDefaultId },
      select: { status: true, barcode: true },
    });
    check(
      "L1a) ⭐ KAPALI PARİTE: alan verilmeyince toplar WAREHOUSE doğar",
      lDefaultRolls.length === 1 && lDefaultRolls[0]!.status === RollStatus.WAREHOUSE,
      `status=${lDefaultRolls[0]?.status}`,
    );
    check(
      "L1b) Barkod tipi statüden türer — satılabilir girişte 'F'",
      /^T\d{6}F/.test(lDefaultRolls[0]?.barcode ?? ""),
      lDefaultRolls[0]?.barcode ?? "—",
    );
    const lFalse = await goodsReceiptService.create({
      warehouseId: wh.id,
      rawStockEntry: false,
      lines: [{ itemId: lItem.id, initialQty: 20 }],
    });
    const lFalseId = (lFalse.data as { id: string }).id;
    receiptIds.push(lFalseId);
    const lFalseStatus = (await prisma.roll.findFirst({ where: { goodsReceiptId: lFalseId }, select: { status: true } }))?.status;
    check("L1c) `rawStockEntry: false` de WAREHOUSE (açık ve örtük aynı dal)", lFalseStatus === RollStatus.WAREHOUSE, `${lFalseStatus}`);

    // L2 — AÇIK → STOCK. Karar FİŞTE saklanır ve satırlar SONRADAN eklense
    // bile aynı rafa düşer ("fiş bir kaptır": ikinci parti sessizce başka rafa
    // düşemez).
    const lRaw = await goodsReceiptService.create({
      warehouseId: wh.id,
      rawStockEntry: true,
      lines: [{ itemId: lItem.id, initialQty: 40 }],
    });
    const lRawId = (lRaw.data as { id: string }).id;
    receiptIds.push(lRawId);
    await goodsReceiptService.addLines(lRawId, [{ itemId: lItem.id, initialQty: 25 }]);
    const lRawRolls = await prisma.roll.findMany({
      where: { goodsReceiptId: lRawId },
      select: { status: true, barcode: true, entrySource: true, warehouseId: true },
    });
    check(
      "L2a) ⭐ `rawStockEntry: true` → İKİ satır da STOCK (create + sonradan eklenen)",
      lRawRolls.length === 2 && lRawRolls.every((r) => r.status === RollStatus.STOCK),
      lRawRolls.map((r) => r.status).join(","),
    );
    // ⚠️ `every` BOŞ DİZİDE TRUE döner → satır sayısı da ölçülür, yoksa
    // "hiç top doğmadı" ile "hepsi doğru" AYNI yeşile çıkar (ilk yazımda tam
    // bu oldu ve bayrak sızıntısını gizledi).
    check(
      "L2b) ⭐ Ham girişte barkod tipi 'H' (etiket de doğru şeyi söyler)",
      lRawRolls.length === 2 && lRawRolls.every((r) => /^T\d{6}H/.test(r.barcode ?? "")),
      lRawRolls.map((r) => r.barcode).join(","),
    );
    check(
      "L2c) Kaynak/depo damgası DEĞİŞMEDİ (yalnız RAF değişti)",
      lRawRolls.length === 2 &&
        lRawRolls.every((r) => r.entrySource === RollEntrySource.PURCHASE_RECEIPT && r.warehouseId === wh.id),
      `${lRawRolls[0]?.entrySource}`,
    );
    const lRawDetail = (await goodsReceiptService.loadDetail(lRawId)) as { rawStockEntry?: boolean };
    check("L2d) Detay `rawStockEntry` alanını taşıyor (panel rozeti)", lRawDetail.rawStockEntry === true, `${lRawDetail.rawStockEntry}`);

    // L3 — İPLİK ETKİLENMEZ ve etkilenemez: kg defteri kalem × DEPO bazında
    // tutulur, RAF (statü) kavramı taşımaz. Ham iplik ayrımı istenirse doğru
    // çözüm ayrı DEPO'dur, buraya sessiz bir bayrak eklemek değil.
    const lYarnOut = await goodsReceiptService.addLines(lRawId, [{ itemId: lYarn.id, initialQty: 15 }]);
    const lYarnMove = await prisma.yarnMovement.findFirst({
      where: { goodsReceiptId: lRawId, itemId: lYarn.id },
      select: { kind: true, qtyKg: true, warehouseId: true },
    });
    // L5 — SATIR BAŞINA TOP SINIFI ÜÇLÜ (EK 7, kullanıcı kararı 2026-09-18): `lineClass` RAW / SEMI_FINISHED / FINISHED;
    // eski `rawStock` (EK 5 istemcisi) GERİYE DÖNÜK kabul; alan yoksa fişinki (eski istemci bayt bayt); iplikte yok sayılır.
    // Yarı mamul satırı elle yarı mamul girişiyle AYNI doğar (STOCK + entrySource=SEMI_FINISHED) ve Envanter'in
    // "Yarı Mamul" sekmesine (`rollScope=SEMI_FINISHED`) düşer, RAW_STOCK birleşimine girer, RAW_STOCK_PURE'a girmez.
    // Sondalar: `receiptLineBirth` SEMI'de PURCHASE_RECEIPT dönerse L5a/L5c ❌; `resolveReceiptLineClass` rawStock'u
    // yok sayarsa L5b ❌; FINISHED'ı STOCK'a çevirirse L5a ❌.
    const lMix = await goodsReceiptService.create({
      warehouseId: wh.id,
      rawStockEntry: false,
      lines: [
        { itemId: lItem.id, initialQty: 10, lineClass: "RAW" },
        { itemId: lItem.id, initialQty: 11 },
        { itemId: lItem.id, initialQty: 12, lineClass: "FINISHED" },
        { itemId: lItem.id, initialQty: 13, lineClass: "SEMI_FINISHED" },
      ],
    });
    const lMixId = (lMix.data as { id: string }).id;
    receiptIds.push(lMixId);
    const lMixRolls = await prisma.roll.findMany({
      where: { goodsReceiptId: lMixId },
      orderBy: { initialQty: "asc" },
      select: { id: true, status: true, initialQty: true, entrySource: true },
    });
    const lBirth = (r: (typeof lMixRolls)[number]) => `${r.status}/${r.entrySource}`;
    check(
      "L5a) ⭐ bitmiş fişte RAW → STOCK/PURCHASE_RECEIPT · alan yok → WAREHOUSE (fiş) · FINISHED → WAREHOUSE · SEMI_FINISHED → STOCK/SEMI_FINISHED",
      lMixRolls.length === 4 &&
        lBirth(lMixRolls[0]!) === `${RollStatus.STOCK}/${RollEntrySource.PURCHASE_RECEIPT}` &&
        lBirth(lMixRolls[1]!) === `${RollStatus.WAREHOUSE}/${RollEntrySource.PURCHASE_RECEIPT}` &&
        lBirth(lMixRolls[2]!) === `${RollStatus.WAREHOUSE}/${RollEntrySource.PURCHASE_RECEIPT}` &&
        lBirth(lMixRolls[3]!) === `${RollStatus.STOCK}/${RollEntrySource.SEMI_FINISHED}`,
      lMixRolls.map((r) => `${r.initialQty}:${lBirth(r)}`).join(","),
    );
    // L5b — eski istemci `rawStock` (EK 5 sözleşmesi) hâlâ okunur; `lineClass` varsa o kazanır; ham fişte satır fişi ezer;
    // iplik satırında ikisi de yok sayılır (IN yazıldı).
    const lRaw2 = await goodsReceiptService.create({
      warehouseId: wh.id,
      rawStockEntry: true,
      lines: [
        { itemId: lItem.id, initialQty: 7, rawStock: false },
        { itemId: lItem.id, initialQty: 8, rawStock: true, lineClass: "FINISHED" },
      ],
    });
    const lRaw2Id = (lRaw2.data as { id: string }).id;
    receiptIds.push(lRaw2Id);
    const lMix2 = await goodsReceiptService.addLines(lRaw2Id, [{ itemId: lYarn.id, initialQty: 3, rawStock: true, lineClass: "SEMI_FINISHED" }]);
    const lRaw2Rolls = await prisma.roll.findMany({ where: { goodsReceiptId: lRaw2Id }, orderBy: { initialQty: "asc" }, select: { status: true } });
    check(
      "L5b) ⭐ eski `rawStock:false` ham fişi ezer → WAREHOUSE; `lineClass` `rawStock`u ezer (FINISHED → WAREHOUSE); iplikte yok sayılır",
      lRaw2Rolls.length === 2 && lRaw2Rolls.every((r) => r.status === RollStatus.WAREHOUSE) && lMix2.createdYarn.length === 1 && lMix2.failed.length === 0,
      `${lRaw2Rolls.map((r) => r.status).join(",")} yarn=${lMix2.createdYarn.length}`,
    );
    // L5c — Envanter sekmesi sınıflaması: yarı mamul top SEMI_FINISHED kapsamında, RAW_STOCK_PURE'da DEĞİL, RAW_STOCK
    // birleşiminde VAR; ham top tersi (test_semi_finished_entry §5 birleşim kuralının mal kabul ayağı).
    const lInv = new InventoryService();
    const lScopeIds = async (scope: string): Promise<string[]> => {
      const where = (lInv as unknown as { buildRollWhere: (p: { filters: Record<string, string> }, f: readonly string[]) => Record<string, unknown> }).buildRollWhere(
        { filters: { rollScope: scope, status: "ALL" } },
        [],
      );
      const rows = await prisma.roll.findMany({ where: { AND: [where as never, { goodsReceiptId: lMixId }] }, select: { id: true } });
      return rows.map((r) => r.id);
    };
    const lRawRollId = lMixRolls[0]!.id;
    const lSemiRollId = lMixRolls[3]!.id;
    const [lPure, lSemi, lUnion] = await Promise.all([lScopeIds("RAW_STOCK_PURE"), lScopeIds("SEMI_FINISHED"), lScopeIds("RAW_STOCK")]);
    check(
      "L5c) ⭐ yarı mamul satırın topu Yarı Mamul sekmesinde (SEMI_FINISHED), Ham Stok'ta (RAW_STOCK_PURE) DEĞİL, RAW_STOCK birleşiminde VAR; ham satırın topu tersi",
      lSemi.includes(lSemiRollId) && !lSemi.includes(lRawRollId) && lPure.includes(lRawRollId) && !lPure.includes(lSemiRollId) && lUnion.includes(lSemiRollId) && lUnion.includes(lRawRollId),
      `semi=${lSemi.length} pure=${lPure.length} union=${lUnion.length}`,
    );

    check(
      "L3) ⭐ Ham stok fişinde İPLİK satırı normal IN yazdı (raf ayrımı taşımaz)",
      lYarnOut.createdYarn.length === 1 &&
        lYarnOut.failed.length === 0 &&
        lYarnMove?.kind === YarnMovementKind.IN &&
        lYarnMove?.warehouseId === wh.id,
      `kind=${lYarnMove?.kind} kg=${lYarnMove?.qtyKg?.toString()}`,
    );

    // L4 — ⭐ HAM STOK FİŞİ İPTAL EDİLEBİLİR. `STOCK` iptal-edilebilir statü
    // listesine EKLENMESEYDİ bu fişlerin iptali tanım gereği İMKÂNSIZ olurdu
    // ("N top işlem görmüş" 409'u), üstelik hiçbir top işlem görmemişken.
    // ⚠️ HATA YUTULMAZ, SEBEBE ÇEVRİLİR: iptal 409 fırlatırsa `await` main'i
    // çökertir ve paket "1 başarısız" der ama HANGİ kontrolün düştüğünü
    // söylemez. Sonda koşan kişi kırmızıyı adıyla görmeli.
    let lCancelErr = "";
    const lCancel = await goodsReceiptService
      .cancel(lRawId, `${TAG} ham stok iptali`)
      .catch((e: unknown) => {
        lCancelErr = (e as Error).message;
        return { data: { cancelledRolls: -1, skipped: [] } };
      });
    const lCancelData = lCancel.data as { cancelledRolls: number; skipped: unknown[] };
    if (lCancelErr) check("L4-hata) İptal 409 verdi (sebep aşağıda)", false, lCancelErr.slice(0, 120));
    const lAfter = await prisma.roll.findMany({ where: { goodsReceiptId: lRawId }, select: { status: true } });
    check(
      "L4a) ⭐ Ham stok fişi İPTAL EDİLEBİLDİ (STOCK guard listesinde)",
      lCancelData.cancelledRolls === 2 && lCancelData.skipped.length === 0,
      `iptal=${lCancelData.cancelledRolls} atlanan=${lCancelData.skipped.length}`,
    );
    check(
      "L4b) Toplar CANCELLED, yarım iptal yok",
      lAfter.length === 2 && lAfter.every((r) => r.status === RollStatus.CANCELLED),
      lAfter.map((r) => r.status).join(","),
    );
  }

  check("Körlük zemini: en az 5 fiş üretildi", receiptIds.length >= 5, `${receiptIds.length} fiş`);
  check(
    "Körlük zemini: §K/§L fixture'ı kuruldu (3 kalem + fason sipariş)",
    kItemIds.length === 3 && kOrderIds.length === 1 && kInvoiceIds.length === 1,
    `kalem=${kItemIds.length} sipariş=${kOrderIds.length} fatura=${kInvoiceIds.length}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    if (modulGeriAl) {
      await modulGeriAl().catch((e: Error) =>
        console.error("   ⚠️  modül bayrakları geri yazılamadı:", e.message),
      );
    }
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
      // ⚠️ FATURA FİŞTEN ÖNCE SİLİNİR: `invoices_goodsReceiptId_fkey` RESTRICT'tir
      // (§K6 fişten taslak fatura üretiyor). Sıra ters yazılırsa temizlik
      // "violates RESTRICT setting" ile düşer ve fişler bir sonraki koşuma
      // artık olarak kalır.
      if (kInvoiceIds.length) {
        await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: kInvoiceIds } } });
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: kInvoiceIds } } });
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: kInvoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: kInvoiceIds } } });
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
      if (sarfItemId) {
        await prisma.item.deleteMany({ where: { id: sarfItemId } });
      }
      // Genel FABRIC kalem EN SONDA: fiş satırları ve toplar ona RESTRICT ile
      // bağlı; yukarıdaki bloklar onları düşürdükten sonra silinebilir.
      if (baseItemId) {
        await prisma.item.deleteMany({ where: { id: baseItemId } });
      }
      // §J temizliği — SIRA ZORUNLU: sipariş kalemi → kalem FK'sı RESTRICT'tir,
      // yani siparişler kalemlerden ÖNCE düşmeli (kalem satırları PO silinince
      // CASCADE ile gider). Fişler zaten yukarıda silindi.
      if (jOrderIds.length) await prisma.purchaseOrder.deleteMany({ where: { id: { in: jOrderIds } } });
      if (jItemIds.length) {
        await prisma.yarnStock.deleteMany({ where: { itemId: { in: jItemIds } } });
        await prisma.yarnMovement.deleteMany({ where: { itemId: { in: jItemIds } } });
        await prisma.roll.deleteMany({ where: { itemId: { in: jItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: jItemIds } } }); // itemPrice CASCADE
      }
      if (jCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: jCustomerIds } } });
      // §K/§L temizliği (faturalar yukarıda, fişlerden ÖNCE düşürüldü).
      if (kOrderIds.length) await prisma.purchaseOrder.deleteMany({ where: { id: { in: kOrderIds } } });
      if (kItemIds.length) {
        await prisma.yarnStock.deleteMany({ where: { itemId: { in: kItemIds } } });
        await prisma.yarnMovement.deleteMany({ where: { itemId: { in: kItemIds } } });
        await prisma.roll.deleteMany({ where: { itemId: { in: kItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: kItemIds } } });
      }
      if (kCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: kCustomerIds } } });
      if (kSubcontractorIds.length) {
        // Bölümün KENDİ bağsız profili (fixture değil): lazy açılan hesabı ve profili birlikte kaldır.
        const kSubCari = (await prisma.cariAccount.findMany({ where: { subcontractorId: { in: kSubcontractorIds } }, select: { id: true } })).map((c) => c.id);
        if (kSubCari.length) {
          await prisma.cariTransaction.deleteMany({ where: { cariId: { in: kSubCari } } });
          await prisma.cariBalance.deleteMany({ where: { cariId: { in: kSubCari } } });
          await prisma.cariAccount.deleteMany({ where: { id: { in: kSubCari } } });
        }
        await prisma.subcontractor.deleteMany({ where: { id: { in: kSubcontractorIds } } });
      }
      // ⚠️ FASON FİRMANIN `CariAccount`u SİLİNMEZ ve bu bilinçli: fixture firma
      // KALICIDIR (29 test paylaşıyor) ve hesap lazy açılır — bakiyesiz, defter
      // satırsız boş bir kayıttır, mutabakat bekçilerinde nötrdür. Silmek,
      // aynı anda koşan başka bir testin hesabını yok etme riskidir.
      // Bayrak satırları TESTTEN ÖNCEKİ hâline döner (varsa değer, yoksa satır
      // silinir) — bekçi ortamın ayarını kalıcı olarak değiştiremez.
      for (const [key, prior] of priorFlags) {
        if (prior.existed)
          await prisma.systemSetting.update({ where: { key }, data: { value: prior.value ?? Prisma.JsonNull } });
        else await prisma.systemSetting.deleteMany({ where: { key } });
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
