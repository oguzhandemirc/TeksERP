// =============================================================================
// BEKÇİ — TOPUN ALIŞ SİPARİŞİ KALEMİ İZİ (`Roll.purchaseOrderLineId`, J2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_roll_po_line_trace.ts
//
// NEDEN: "aynı üründen iki terminli sipariş" (100 m Mart + 100 m Nisan) tek bir
// `itemId` taşır. Karşılanma rollup'ı bunu FIFO ile kalemlere DAĞITIR ama gelen
// FİZİKSEL topun hangi kalemin malı olduğu hiçbir yerde yazmıyordu — depocu
// "Nisan partisi geldi mi" sorusuna ancak tarihe bakarak tahmin yürütebiliyordu.
//
// DAMGA KURALI (ürün kodunda `claimStampLine`, burada ölçülür):
//   Topun TAMAMI, `lineNo` sırasında KALAN KAPASİTESİ > 0 olan İLK kaleme
//   yazılır. Kapasiteyi aşsa bile o kalemin malıdır — top fiziksel bir
//   BÜTÜNDÜR, kısmi bölünmez; sıradaki top sıradaki kaleme geçer.
//   Tüm kalemler doluysa (AŞIM) damga İDDİA EDİLMEZ → NULL.
//
// ⚠️ DAMGA ≠ KARŞILANMA. `distributeFifo` miktarı kalemler arasında BÖLEBİLİR,
// damga bölemez: 50 + 100'lük iki kaleme 30+30+30 gelirse rollup "L1: 50,
// L2: 40" der, damga "iki top L1, bir top L2" der. İkisi de doğrudur, çünkü
// biri MİKTAR defteri (tek kaynak: `purchase-order.service`), diğeri FİZİKSEL
// topun izidir (şema yorumu: "iz BİLGİLENDİRİCİDİR, karşılanma hesabı DEĞİL").
// §3 tam olarak bu ikiliyi birlikte ölçer — biri diğerinden türetilmeye
// kalkışılırsa kırmızı verir.
//
// ÖLÇÜLENLER:
//   §1 Siparişsiz fiş → damga NULL (bugünkü davranışla parite)
//   §2 Tek kalemli PO (100) → 60+40 iki top da O kalemi damgalar
//   §3 AYNI ÜRÜN İKİ KALEM (L1:50, L2:100) → 30+30+30 = L1, L1, L2
//      (+ aynı anda rollup L1:50 / L2:40 yazar — iki defterin ayrıklığı)
//   §4 AŞIM (sipariş 100, gelen 100+50) → fazla top NULL damgalı
//   §5 Siparişte OLMAYAN ürün → NULL, top yine yazılır (kayıt gerçeği yazar)
//   §6 Top iptali damgaya DOKUNMAZ (iz kalır — `batchId` emsali)
//   §7 PO kalemi silinirse damga SET NULL ile düşer, TOP YAŞAR
//   §8 EŞZAMANLILIK — aynı siparişe paralel iki fiş: MİKTAR defteri doğru
//      kalır (advisory kilit), damga TAHSİSİ yaklaşıktır (aşağıdaki not)
//   §9 İDEMPOTENT REPLAY defteri İKİNCİ kez tüketmez (+ J1 açıkken meşru
//      satırı 400'lemez)
//
// ⚠️ §8'İN SINIRI — SAPMA DONDURULMAZ. Kapasite defteri her `addLines`
// çağrısının başında okunur; aynı siparişe eşzamanlı iki fiş satır alırsa
// ikisi de bayat defteri görür ve AYNI kalemi damgalayabilir (ölçüldü:
// paralel `[L1, L1]`, sıralı `[L1, L2]`). Bu, ürün kodunda `claimStampLine`
// başlığında gerekçesiyle YAZILI ve kabul edilmiş bir sapmadır — üç olası
// düzeltmenin de neden daha pahalı olduğu orada. Bekçi `[L1, L1]` BEKLEMEZ
// (doğru düzeltmeyi yapanı cezalandırırdı); sapmanın YAYILMAMASI gereken
// sınırları ölçer: miktar defteri doğru, damga ne NULL ne çöp.
//
// NEGATİF SONDALAR (ÜÇÜ DE koşuldu, kırmızı GÖRÜLDÜ, dosyalar sha256 ile
// birebir geri yüklendi — 2026-08-15):
//   ① `inventory.service` create data'sından `purchaseOrderLineId` satırı
//     düşürüldü → exit 1, 10 kontrol kırmızı (§2b/c · §3b/c/d · §4b · §5c ·
//     §6a/c · §7a). §1/§4c/§5b zaten NULL beklediği için YEŞİL kalır ve bu
//     BİLİNÇLİDİR: NULL bekleyen bir kontrol, damgayı hiç yazmayan bir kodu
//     ayırt EDEMEZ; ayırt eden yalnız pozitif kontrollerdir. Sonda tamamen
//     yeşil kalırsa önce fixture'dan şüphelen (kalem hiç eşleşmiyor olabilir).
//   ② `claimStampLine` aşımda son kaleme SAPACAK şekilde körleştirildi
//     (`?? bucket[bucket.length - 1]`) → exit 1, §4c kırmızı: aşan top
//     kapasitesi dolu kalemi damgalayıp onu karşılamış gibi gösterdi.
//   ③ `noteAccepted`ın kapasite düşümü kaldırıldı → exit 1, §3d + §4c kırmızı:
//     defter tükenmeyince TÜM toplar ilk kaleme yığıldı (FIFO ölür).
// §8/§9 EKLENİRKEN KOŞULANLAR (çapraz inceleme, 2026-08-15):
//   ④ `if (!res.idempotent)` kaldırıldı (replay yine sayılır) → exit 1,
//     §9b + §9e kırmızı (§9f de düşer — o §9e'nin BIRAKTIĞI duruma bakar,
//     bağımsız bir sinyal DEĞİLDİR).
//   ⑤ `inventory.service`teki `idempotent: true` işareti düşürüldü → aynı üç
//     kırmızı. İşaretin İKİ ucu da yük taşıyor: üreten ve tüketen.
//   ⑥ Kapasite `remaining: D0` ile körleştirildi → 14 kırmızı, aralarında
//     §8c/§8d (damga tamamen NULL'a düştü) → §8'in damga kontrolleri vakumen
//     yeşil DEĞİL.
//   ⑦ Döngü sonundaki `syncPurchaseOrderSafely` kaldırıldı → §8b + §9d
//     kırmızı (receivedQty [0,0]).
// ⚠️ YEŞİL KALAN SONDA (dürüstlük notu — silme, ölç): `syncPurchaseOrder`daki
//   `pg_advisory_xact_lock` satırı kaldırılıp test 3 KEZ koşuldu → 34/34 YEŞİL.
//   Yani §8 bu kilidin bekçisi DEĞİLDİR: iki senkron bu fixture'da
//   kayıp-güncelleme penceresinde buluşmuyor. Kilidin bekçisi hâlâ YOK ve
//   güvenilir olanı zamanlamaya değil deterministik bir kancaya dayanmalı;
//   flaky bir kırmızı, bekçisiz kalmaktan daha kötüdür. Kilidi silmeden önce
//   `purchase-order.service` başlığındaki TOCTOU gerekçesini oku.
// =============================================================================
import { randomUUID } from "crypto";
import { ItemType, ItemUnit, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { InventoryService } from "../src/services/inventory.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

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

const TAG = `TEST-POLT-${Date.now()}`;
const inventory = new InventoryService();

const receiptIds: string[] = [];
const orderIds: string[] = [];
const itemIds: string[] = [];
const customerIds: string[] = [];
const warehouseIds: string[] = [];

/** Bayraklar TESTTEN ÖNCEKİ hâline döner — bekçi ortamın ayarını kalıcı değiştiremez. */
const OVER_KEY = SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED;
// ⚠️ ETKİN DEĞER = `ticaret.enabled && purchase.blockOverReceiptEnabled`
// (`resolvePurchaseBlockOverReceiptEnabled`). Bekçi eskiden yalnız ikinciyi
// açıyor, ticaret modülünün ortamda AÇIK olduğunu VARSAYIYORDU — kapalıyken
// aşım guard'ı hiç koşmuyor ve §9f "reddedilmedi" diye kırmızı veriyordu.
// Temiz CI DB'sinde ve fabrika yedeğinde `ticaret.enabled = false`. ([TD-17])
const TICARET_KEY = SETTING_KEYS.TICARET_ENABLED;
const PRICE_KEY = SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED;
const priorFlags = new Map<string, { existed: boolean; value: Prisma.JsonValue }>();

async function rememberFlag(key: string): Promise<void> {
  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  priorFlags.set(key, { existed: row !== null, value: row?.value ?? null });
}
async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}

interface LinesOut {
  created: string[];
  createdYarn: string[];
  failed: Array<{ index: number; reason: string }>;
}

/** Topun damgası — testin TEK ölçüm noktası. */
async function stampOf(rollId: string): Promise<string | null> {
  const row = await prisma.roll.findUnique({
    where: { id: rollId },
    select: { purchaseOrderLineId: true },
  });
  return row?.purchaseOrderLineId ?? null;
}

/** Aynı sorunun toplu hâli — SIRALI (havuz üzerinde eşzamanlı sorgu pg uyarısı üretir). */
async function stampsOf(rollIds: string[]): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const id of rollIds) out.push(await stampOf(id));
  return out;
}

async function main(): Promise<void> {
  console.log("=== Top → alış siparişi kalemi izi bekçisi ===\n");

  // ── FIXTURE (ortam verisine bağımlılık YASAK: her şey testin kendisi) ────
  await rememberFlag(OVER_KEY);
  await rememberFlag(TICARET_KEY);
  await rememberFlag(PRICE_KEY);
  // Damga BAYRAKTAN BAĞIMSIZDIR; ikisini de KAPALI kurup ölçüyoruz ki §4/§5
  // (aşım + siparişte olmayan ürün) satırları gerçekten YAZILSIN — J1 açık
  // olsaydı o satırlar 400 ile düşer ve damga hiç ölçülemezdi.
  await setFlag(OVER_KEY, false);
  await setFlag(PRICE_KEY, false);

  const wh = await prisma.warehouse.create({
    data: { code: `${TAG}-D`, name: `${TAG} Depo` },
    select: { id: true },
  });
  warehouseIds.push(wh.id);

  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-TED`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
    select: { id: true },
  });
  customerIds.push(supplier.id);

  const mkItem = async (suffix: string): Promise<string> => {
    const it = await prisma.item.create({
      data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
      select: { id: true },
    });
    itemIds.push(it.id);
    return it.id;
  };
  const itemA = await mkItem("KUM-A");
  const itemB = await mkItem("KUM-B");

  /** Sipariş + kalemleri `lineNo` sırasında döndürür (damga beklentisi bu id'lerdir). */
  const mkOrder = async (
    lines: Array<{ itemId: string; qty: number }>,
  ): Promise<{ id: string; lineIds: string[] }> => {
    const po = (await purchaseOrderService.create({ supplierId: supplier.id, lines })).data as unknown as {
      id: string;
    };
    orderIds.push(po.id);
    const rows = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { lineNo: "asc" },
      select: { id: true },
    });
    return { id: po.id, lineIds: rows.map((r) => r.id) };
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

  const addQtys = async (receiptId: string, itemId: string, qtys: number[]): Promise<LinesOut> =>
    (await goodsReceiptService.addLines(
      receiptId,
      qtys.map((q) => ({ itemId, initialQty: q })),
    )) as unknown as LinesOut;

  // ── §1 SİPARİŞSİZ FİŞ → DAMGA NULL (parite) ─────────────────────────────
  // Fabrika/serbest alım yolu: sipariş bağı yoksa damga İDDİA EDİLEMEZ ve
  // ürün kodunda tek ek sorgu bile koşmamalıdır.
  {
    const r = await mkReceipt(null);
    const out = await addQtys(r, itemA, [70, 30]);
    check("§1a) Siparişsiz fişte iki satır da yazıldı", out.created.length === 2 && out.failed.length === 0, `created=${out.created.length} failed=${out.failed.length}`);
    const stamps = await stampsOf(out.created);
    check("§1b) ⭐ Siparişsiz fişte damga NULL", stamps.every((s) => s === null), `stamps=${JSON.stringify(stamps)}`);
  }

  // ── §2 TEK KALEMLİ SİPARİŞ → HER İKİ TOP DA O KALEMİ DAMGALAR ───────────
  {
    const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
    const r = await mkReceipt(po.id);
    const out = await addQtys(r, itemA, [60, 40]);
    check("§2a) İki top yazıldı", out.created.length === 2 && out.failed.length === 0, `created=${out.created.length}`);
    const [s1, s2] = await stampsOf(out.created);
    check("§2b) ⭐ 1. top kalemi damgaladı", s1 === po.lineIds[0], `stamp=${s1 === po.lineIds[0] ? "L1" : String(s1)}`);
    check("§2c) ⭐ 2. top AYNI kalemi damgaladı (kalan kapasite 40 > 0)", s2 === po.lineIds[0], `stamp=${s2 === po.lineIds[0] ? "L1" : String(s2)}`);
  }

  // ── §3 AYNI ÜRÜN İKİ KALEM (farklı termin) — ÖZELLİĞİN VAR OLMA SEBEBİ ──
  // L1: 50, L2: 100. Gelen: 30 + 30 + 30.
  //   • 1. top → L1 (kalan 50)
  //   • 2. top → L1 (kalan 20 > 0; KAPASİTEYİ AŞSA DA bölünmez)
  //   • 3. top → L2 (L1'in kalanı 0'a düştü)
  {
    const po = await mkOrder([
      { itemId: itemA, qty: 50 },
      { itemId: itemA, qty: 100 },
    ]);
    const r = await mkReceipt(po.id);
    const out = await addQtys(r, itemA, [30, 30, 30]);
    check("§3a) Üç top yazıldı", out.created.length === 3 && out.failed.length === 0, `created=${out.created.length}`);
    const [s1, s2, s3] = await stampsOf(out.created);
    const nameOf = (s: string | null): string =>
      s === po.lineIds[0] ? "L1" : s === po.lineIds[1] ? "L2" : String(s);
    check("§3b) ⭐ 1. top → L1", s1 === po.lineIds[0], `stamp=${nameOf(s1)}`);
    check("§3c) ⭐ 2. top → L1 (kalan 20 > 0 → kısmi bölünme YOK)", s2 === po.lineIds[0], `stamp=${nameOf(s2)}`);
    check("§3d) ⭐ 3. top → L2 (L1 doldu, sıradaki kaleme geçildi)", s3 === po.lineIds[1], `stamp=${nameOf(s3)}`);

    // İKİ DEFTERİN AYRIKLIĞI: damga (2 top L1 = 60 m) ile rollup (L1: 50)
    // BİLEREK farklıdır. Rollup kalemi bölebilir, damga bölemez. Bu kontrol,
    // birinin diğerinden türetilmeye kalkışılmasını yakalar.
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { lineNo: "asc" },
      select: { receivedQty: true },
    });
    check(
      "§3e) ⭐ Rollup FIFO ile BÖLER (L1=50, L2=40) — damgadan bağımsız tek kaynak",
      lines.length === 2 && lines[0]!.receivedQty.equals(50) && lines[1]!.receivedQty.equals(40),
      `receivedQty=[${lines.map((l) => l.receivedQty.toString()).join(", ")}]`,
    );
  }

  // ── §4 AŞIM: TÜM KALEMLER DOLDUYSA DAMGA İDDİA EDİLMEZ ──────────────────
  {
    const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
    const r = await mkReceipt(po.id);
    const out = await addQtys(r, itemA, [100, 50]);
    check("§4a) Fazla mal YAZILIR (bayrak kapalı — kayıt gerçeği yazar)", out.created.length === 2 && out.failed.length === 0, `created=${out.created.length} failed=${out.failed.length}`);
    const [s1, s2] = await stampsOf(out.created);
    check("§4b) 1. top kalemi damgaladı", s1 === po.lineIds[0], `stamp=${s1 === po.lineIds[0] ? "L1" : String(s1)}`);
    check("§4c) ⭐ AŞAN top NULL damgalı (hiçbir kalemin planını karşılamıyor)", s2 === null, `stamp=${String(s2)}`);
  }

  // ── §5 SİPARİŞTE OLMAYAN ÜRÜN → NULL, ama top YİNE YAZILIR ──────────────
  // Mal fiziksel olarak geldi; kayıt gerçeği yazmak zorunda. Yanlış olan
  // yalnız BAĞDIR ve `describeOverReceipt` onu ayrıca söyler.
  {
    const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
    const r = await mkReceipt(po.id);
    const out = (await goodsReceiptService.addLines(r, [
      { itemId: itemB, initialQty: 25 },
      { itemId: itemA, initialQty: 25 },
    ])) as unknown as LinesOut & { purchaseOrder: { unmatchedItemIds: string[] } | null };
    check("§5a) Siparişte olmayan ürün REDDEDİLMEDİ (bayrak kapalı)", out.created.length === 2 && out.failed.length === 0, `created=${out.created.length} failed=${out.failed.length}`);
    const [sB, sA] = await stampsOf(out.created);
    check("§5b) ⭐ Siparişte olmayan ürünün topu NULL damgalı", sB === null, `stamp=${String(sB)}`);
    check("§5c) Siparişteki ürünün topu AYNI fişte damgalandı", sA === po.lineIds[0], `stamp=${sA === po.lineIds[0] ? "L1" : String(sA)}`);
    check("§5d) Uyarı da söyleniyor (unmatchedItemIds)", out.purchaseOrder?.unmatchedItemIds.includes(itemB) === true, `unmatched=${out.purchaseOrder?.unmatchedItemIds.length ?? 0}`);
  }

  // ── §6 İPTAL DAMGAYA DOKUNMAZ (iz kalır — `batchId` emsali) ─────────────
  // "Hangi kalemin malı olarak yanlış girilmişti" sorusunun cevabı, tam da
  // iptal edilmiş kaydı incelerken en gereken bilgidir.
  {
    const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
    const r = await mkReceipt(po.id);
    const out = await addQtys(r, itemA, [40]);
    const rollId = out.created[0]!;
    const before = await stampOf(rollId);
    check("§6a) Top damgalı doğdu", before === po.lineIds[0], `stamp=${before === po.lineIds[0] ? "L1" : String(before)}`);
    await inventory.softDelete(rollId, undefined, { reason: `${TAG} iptal sondası` });
    const row = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, purchaseOrderLineId: true } });
    check("§6b) Top iptal edildi", row?.status === RollStatus.CANCELLED, `status=${row?.status}`);
    check("§6c) ⭐ İptal damgaya DOKUNMADI", row?.purchaseOrderLineId === po.lineIds[0], `stamp=${row?.purchaseOrderLineId === po.lineIds[0] ? "L1" : String(row?.purchaseOrderLineId)}`);
  }

  // ── §7 PO KALEMİ SİLİNİRSE: DAMGA DÜŞER, TOP YAŞAR (onDelete SET NULL) ──
  // Normal yolda ulaşılmaz (fiş varken `receivedQty > 0` guard'ı PO
  // düzenlemesini zaten bloklar) — burada FK sözleşmesinin KENDİSİ ölçülüyor:
  // RESTRICT olsaydı kalem silinemez, CASCADE olsaydı depodaki mal SİLİNİRDİ.
  {
    const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
    const r = await mkReceipt(po.id);
    const out = await addQtys(r, itemA, [15]);
    const rollId = out.created[0]!;
    check("§7a) Top damgalı doğdu", (await stampOf(rollId)) === po.lineIds[0], "L1");
    await prisma.purchaseOrderLine.delete({ where: { id: po.lineIds[0]! } });
    const row = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, purchaseOrderLineId: true } });
    check("§7b) ⭐ Top YAŞIYOR (kalem silindi diye mal silinmez)", row != null && row.status === RollStatus.WAREHOUSE, `status=${row?.status}`);
    check("§7c) ⭐ Damga SET NULL ile düştü", row?.purchaseOrderLineId === null, `stamp=${String(row?.purchaseOrderLineId)}`);
  }

  // ── §8 EŞZAMANLILIK: MİKTAR DEFTERİ DOĞRU KALIR, DAMGA YAKLAŞIKTIR ──────
  // Aynı siparişe bağlı İKİ fişe PARALEL satır girilir (iki depocu). Kapasite
  // defteri her `addLines` çağrısının BAŞINDA okunduğu için ikisi de bayat
  // defteri görür → damga tahsisi çakışabilir. Bu, ürün kodunda `claimStampLine`
  // başlığında AÇIKÇA yazılı ve KABUL EDİLMİŞ bir sapmadır (üç alternatifin de
  // neden daha pahalı olduğu orada; en ucuzu bile mal girişini serileştirirdi).
  //
  // ⚠️ BEKÇİ SAPMAYI DONDURMAZ: `[L1, L1]` beklemek, doğru düzeltmeyi yapan
  // birini KIRMIZI ile cezalandırırdı. Ölçülen şey, sapmanın YAYILMAMASI
  // gereken sınırlardır — MİKTAR defteri eşzamanlılıkta da doğru olmalı
  // (advisory kilidin işi) ve hiçbir top damgasız/çöp damgalı kalmamalı.
  // Gözlenen dağılım bilgi olarak BASILIR ki değiştiği gün fark edilsin.
  {
    const po = await mkOrder([
      { itemId: itemA, qty: 50 },
      { itemId: itemA, qty: 100 },
    ]);
    const r1 = await mkReceipt(po.id);
    const r2 = await mkReceipt(po.id);
    const [o1, o2] = (await Promise.all([
      goodsReceiptService.addLines(r1, [{ itemId: itemA, initialQty: 50 }]),
      goodsReceiptService.addLines(r2, [{ itemId: itemA, initialQty: 50 }]),
    ])) as unknown as LinesOut[];

    check(
      "§8a) Paralel iki fiş de satırını yazdı (kilit kimseyi düşürmedi)",
      o1.created.length === 1 && o2.created.length === 1 && o1.failed.length + o2.failed.length === 0,
      `created=${o1.created.length}+${o2.created.length} failed=${o1.failed.length + o2.failed.length}`,
    );

    const s = await stampsOf([...o1.created, ...o2.created]);
    const nameOf = (x: string | null): string =>
      x === po.lineIds[0] ? "L1" : x === po.lineIds[1] ? "L2" : String(x);
    console.log(`   ℹ️  eşzamanlı damga dağılımı (donmuş beklenti DEĞİL): [${s.map(nameOf).join(", ")}]`);

    const lines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { lineNo: "asc" },
      select: { receivedQty: true },
    });
    // ⚠️ BU KONTROL ADVİSORY KİLİDİN BEKÇİSİ DEĞİLDİR (ölçüldü — başlıktaki
    // sonda listesine bak): kilit sökülünce YEŞİL kalıyor, çünkü iki senkron
    // bu fixture'da kayıp-güncelleme penceresinde buluşmuyor. Ölçtüğü şey
    // SONUÇ durumudur — özellikle "karşılanmayı damgadan türetelim" refactor'ü
    // (purchase-order.service başlığındaki uyarı) burada [100, 0] verirdi.
    check(
      "§8b) ⭐ İki fişten sonra MİKTAR defteri doğru (damgadan türetilmiyor) — L1=50, L2=50",
      lines.length === 2 && lines[0]!.receivedQty.equals(50) && lines[1]!.receivedQty.equals(50),
      `receivedQty=[${lines.map((l) => l.receivedQty.toString()).join(", ")}]`,
    );
    check(
      "§8c) ⭐ Eşzamanlılık damgayı KAYBETTİRMEZ (toplam kapasite 150 ≥ gelen 100 → ikisi de dolu)",
      s.every((x) => x !== null),
      `damga=[${s.map(nameOf).join(", ")}]`,
    );
    check(
      "§8d) ⭐ Damgalar BU siparişin kalemleri (çapraz/çöp id sızmıyor)",
      s.every((x) => x === po.lineIds[0] || x === po.lineIds[1]),
      `damga=[${s.map(nameOf).join(", ")}]`,
    );
  }

  // ── §9 İDEMPOTENT REPLAY DEFTERİ İKİNCİ KEZ TÜKETMEZ ────────────────────
  // Ağ zaman aşımı: istemci aynı `clientToken`ı YENİ bir satırla birlikte
  // tekrar gönderir. Replay YENİ MAL GETİRMEZ — mevcut topu döndürür ve o top
  // çağrı başındaki kaynak okumasında ZATEN sayılmıştır. Sayılırsa aynı
  // fiziksel top iki kez düşer; ölçüt "satır başarılı mı" değil "yeni top
  // doğdu mu"dur (`InitialEntryResult.idempotent`).
  {
    const po = await mkOrder([
      { itemId: itemA, qty: 50 },
      { itemId: itemA, qty: 50 },
    ]);
    const r = await mkReceipt(po.id);
    const t1 = randomUUID();
    const c1 = (await goodsReceiptService.addLines(r, [
      { itemId: itemA, initialQty: 50, clientToken: t1 },
    ])) as unknown as LinesOut;
    const c2 = (await goodsReceiptService.addLines(r, [
      { itemId: itemA, initialQty: 50, clientToken: t1 },
      { itemId: itemA, initialQty: 50, clientToken: randomUUID() },
    ])) as unknown as LinesOut;

    const nameOf = (x: string | null): string =>
      x === po.lineIds[0] ? "L1" : x === po.lineIds[1] ? "L2" : String(x);
    check(
      "§9a) Replay MEVCUT topu döndürdü, yeni satır YENİ top doğurdu (toplam 2 top)",
      c1.created.length === 1 &&
        c2.created.length === 2 &&
        c2.created[0] === c1.created[0] &&
        new Set([...c1.created, ...c2.created]).size === 2,
      `benzersiz=${new Set([...c1.created, ...c2.created]).size} failed=${c2.failed.length}`,
    );
    const [sReplay, sNew] = await stampsOf(c2.created);
    check(
      "§9b) ⭐ Replay kapasiteyi TÜKETMEDİ → gerçekten yeni doğan top L2'yi damgaladı",
      sNew === po.lineIds[1],
      `yeni-top-damga=${nameOf(sNew)}`,
    );
    check(
      "§9c) Replay'in döndürdüğü topun damgası DEĞİŞMEDİ (iz doğduğu anın gerçeği)",
      sReplay === po.lineIds[0],
      `replay-damga=${nameOf(sReplay)}`,
    );
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { lineNo: "asc" },
      select: { receivedQty: true },
    });
    check(
      "§9d) Rollup replay'den etkilenmedi (fiziksel 100 m → L1=50, L2=50)",
      lines.length === 2 && lines[0]!.receivedQty.equals(50) && lines[1]!.receivedQty.equals(50),
      `receivedQty=[${lines.map((l) => l.receivedQty.toString()).join(", ")}]`,
    );
  }

  // ── §9e J1 AÇIK: REPLAY MEŞRU BİR SATIRI 400'LEMEZ ──────────────────────
  // Aynı kök nedenin ① tarafı. Sipariş 100; gelen fiziksel mal 50 + 50 = tam
  // 100, yani aşım YOK. Replay `pending`e sayılırsa guard 150 görür ve mal
  // kamyondayken MEŞRU satırı reddeder (ölçüldü: "…bu satırla 150 m olur").
  {
    await setFlag(OVER_KEY, true);
    // Etkin değer iki bayrağın ÇARPIMI — ikisi de açılmadan guard hiç koşmaz.
    await setFlag(TICARET_KEY, true);
    try {
      const po = await mkOrder([{ itemId: itemA, qty: 100 }]);
      const r = await mkReceipt(po.id);
      const t1 = randomUUID();
      await goodsReceiptService.addLines(r, [{ itemId: itemA, initialQty: 50, clientToken: t1 }]);
      const c2 = (await goodsReceiptService.addLines(r, [
        { itemId: itemA, initialQty: 50, clientToken: t1 },
        { itemId: itemA, initialQty: 50, clientToken: randomUUID() },
      ])) as unknown as LinesOut;
      check(
        "§9e) ⭐ J1 AÇIK: replay meşru satırı 400'lemedi (aşım yok — 50+50 = ısmarlanan 100)",
        c2.failed.length === 0 && c2.created.length === 2,
        `created=${c2.created.length} failed=${c2.failed.length}${c2.failed[0] ? ` sebep="${c2.failed[0].reason.slice(0, 70)}"` : ""}`,
      );
      // C8 fail-closed (2026-09-18): aşım artık ön-uçuşta yakalanır → 400 `RECEIPT_LINES_INVALID`
      // + `details.lines[].code = OVER_RECEIPT`; satır `failed[]`e düşmez, fişe HİÇ yazılmaz.
      const rollsBefore = await prisma.roll.count({ where: { goodsReceiptId: r } });
      let overErr: AppError | null = null;
      try {
        await goodsReceiptService.addLines(r, [{ itemId: itemA, initialQty: 10 }]);
      } catch (e) {
        overErr = e instanceof AppError ? e : null;
      }
      const overDetails = overErr?.details as { code?: string; lines?: Array<{ lineNo: number; code: string }> } | undefined;
      check(
        "§9f) J1 AÇIK: aşım guard'ı hâlâ ÇALIŞIYOR — 400 RECEIPT_LINES_INVALID / OVER_RECEIPT, fişe satır yazılmadı",
        overErr?.statusCode === 400 &&
          overDetails?.code === "RECEIPT_LINES_INVALID" &&
          overDetails.lines?.length === 1 &&
          overDetails.lines[0]!.code === "OVER_RECEIPT" &&
          (await prisma.roll.count({ where: { goodsReceiptId: r } })) === rollsBefore,
        overErr ? `${overErr.statusCode} ${overDetails?.code} ${overDetails?.lines?.map((l) => l.code).join(",")}` : "hata fırlamadı — 10 m fazla YAZILDI",
      );
    } finally {
      await setFlag(OVER_KEY, false);
      // Ticaret modülünü açık BIRAKMA — nihai geri yükleme `priorFlags`ta ama
      // bu bölümden sonraki kontroller de modülsüz ortamı görmeli.
      await setFlag(TICARET_KEY, false);
    }
  }

  // ── KÖRLÜK ZEMİNİ ───────────────────────────────────────────────────────
  // Fixture gerçekten kuruldu mu: kurulum sessizce boşa düşerse yukarıdaki
  // "NULL bekleyen" kontroller vakumen yeşil kalırdı.
  check(
    "§0) Körlük zemini: fixture kuruldu",
    itemIds.length === 2 && orderIds.length === 9 && receiptIds.length === 11,
    `kalem=${itemIds.length} sipariş=${orderIds.length} fiş=${receiptIds.length}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      const rolls = await prisma.roll.findMany({
        where: { OR: [{ goodsReceiptId: { in: receiptIds } }, { itemId: { in: itemIds } }] },
        select: { id: true },
      });
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
      // SIRA ZORUNLU: kalem → Item FK'sı RESTRICT, yani siparişler kalemlerden
      // ÖNCE düşmeli (kalem satırları PO silinince CASCADE ile gider).
      if (orderIds.length) await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
      for (const [key, prior] of priorFlags) {
        if (prior.existed)
          await prisma.systemSetting.update({ where: { key }, data: { value: prior.value ?? Prisma.JsonNull } });
        else await prisma.systemSetting.deleteMany({ where: { key } });
      }
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 200));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
