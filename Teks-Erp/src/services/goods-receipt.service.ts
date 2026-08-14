// =============================================================================
// MAL KABUL — satın alınan malın depoya girişi (üretimsiz stok girişi)
// =============================================================================
// Alım-satım kurulumunun ANA giriş kapısı: tedarikçiden gelen mal → depo → top
// satırları → barkod + etiket → WAREHOUSE. Üretici fabrikada bu akış kullanılmaz
// (mal KK1'den ham olarak girer ve rotaya sokulur).
//
// ⚠️ İKİNCİ BİR GİRİŞ MOTORU YAZILMAZ. Her satır `InventoryService.createInitialEntry`
// çağırır; mükerrer tuzağı (advisory lock), `clientToken` idempotency'si, barkod
// rezervasyonu, izinli renk/özellik doğrulaması ve etiket niyeti oradan BEDAVA
// gelir. Emsal: `tambur-manual.produceFinishedRoll` (o da iş emrisiz, hareketsiz,
// doğrudan depoya yazan bir sarmalayıcıdır).
//
// ⚠️ FİŞ BİR KAPTIR, ATOMİK BİR PAKET DEĞİL. `createInitialEntry` kendi
// transaction'ını açtığı için satırlar TEK tx'te toplanamaz; bu bilinçli olarak
// korunuyor çünkü tersi (tek dev tx) mükerrer tuzağının advisory kilidini fişin
// tamamı boyunca tutardı. Sonuç: bir satır düşerse diğerleri KALIR ve düşen satır
// somut sebebiyle döner (`failed[]`) — "10 top girildi" deyip 2'sini yutmak en
// kötü davranıştır (kurşun toplu dağıtım emsali).
// =============================================================================
import {
  GoodsReceiptStatus,
  InvoiceStatus,
  ItemType,
  PriceKind,
  PrintedDocType,
  Prisma,
  PurchaseOrderStatus,
  RollEntrySource,
  RollStatus,
  YarnMovementKind,
} from "@prisma/client";
import { registerPrintedDocBuilder } from "./printed-document.service";
import { renderGoodsReceiptHtml, type GoodsReceiptDoc } from "./document-render/warehouse-doc.html";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { InventoryService } from "./inventory.service";
import { resolveItemPricesFor } from "./item-price.service";
import { applyYarnMovementTx, reverseGoodsReceiptYarnTx, yarnMovementSign } from "./yarn.service";
// J1 — iki OPT-IN katılık bayrağı (ikisi de varsayılan KAPALI; kapalıyken tek
// maliyet ayar okumasıdır ve davranış bayt-bayt bugünküdür).
import {
  readGoodsReceiptRequirePriceEnabled,
  readPurchaseBlockOverReceiptEnabled,
} from "./system-setting.service";
// Paket D3 — fiş bir ALIŞ SİPARİŞİNİ karşılayabilir. Bağ OPSİYONELDİR: sipariş
// bir PLANDIR, kabulün ön koşulu değil (siparişsiz mal kabulü meşru kalır).
import {
  PURCHASE_ORDER_LOCK_NS,
  syncPurchaseOrderSafely,
  type PurchaseOrderSyncResult,
} from "./purchase-order.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { buildWhereClause } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";

const inventory = new InventoryService();

/** Fiş numarası ön eki — MK + GGAAYY + NNNN. */
const RECEIPT_PREFIX = "MK";

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  weightKg?: number | null;
  width?: number | null;
  qualityGrade?: string | null;
  foldType?: string | null;
  propertyIds?: string[];
  /** Satın alma BİRİM fiyatı (opsiyonel) — fişin para biriminde. Topa yazılır
   *  ve alış faturası satırının fiyatı ondan türer. Girilmezse fatura fiyatsız
   *  taslak doğar (onay zaten fiyatsızı reddediyor). */
  unitPrice?: number | null;
  /** Satır başına idempotency — ağ kopmasında yarım fiş mükerrer top doğurmaz. */
  clientToken?: string;
}

export interface GoodsReceiptCreateInput {
  warehouseId: string;
  supplierId?: string | null;
  deliveryNoteNo?: string | null;
  currency?: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes?: string | null;
  clientToken?: string;
  /** Bu fişin karşıladığı ALIŞ SİPARİŞİ (opsiyonel — D3). */
  purchaseOrderId?: string | null;
  lines?: GoodsReceiptLineInput[];
}

interface LineFailure {
  index: number;
  itemId: string;
  reason: string;
}

/**
 * Kabul satırının sonucu — TOP mu, İPLİK mi.
 *
 * ⚠️ İkisi TEK sayaçta toplanmaz: "12 top girildi" deyip 5'inin aslında kg
 * iplik olduğunu yutmak, operatörün fişi kâğıtla karşılaştırmasını imkânsız
 * yapardı. Sayaçlar ayrı, mesajlar ayrı.
 */
export interface AddLinesResult {
  /** Doğan `Roll` id'leri (kumaş/konfeksiyon satırları). */
  created: string[];
  /** Doğan `YarnMovement` id'leri (iplik satırları). */
  createdYarn: string[];
  failed: LineFailure[];
  /**
   * D3 — fiş bir alış siparişine bağlıysa satırlardan SONRA koşan karşılanma
   * senkronunun sonucu. Sipariş bağı yoksa `null`; alan OPSİYONEL çünkü mevcut
   * çağıranlar (üretici fabrika akışı) bunu hiç okumaz ve okumamalı.
   */
  purchaseOrder?: PurchaseOrderSyncResult | null;
}

// =============================================================================
// SINIF 5 (2026-08-14) — TEK KAYNAK SATIR ASSEMBLER
// =============================================================================
// Fişin satırları İKİ tabloda yaşar (`Roll` + `YarnMovement`) ve her tüketici
// yüzey hangisini okuyacağına KENDİ karar verdiğinde sınıf yeniden açılır
// (detay "0 top" derken belge iplik basmaz, liste yalnız `_count.rolls` sayar —
// 2026-08-14 denetiminin #17 bulgusu). Kural: İÇERİK okuyan her yüzey
// (`loadDetail`, donmuş belge builder'ı, `invoice.createDraftFromGoodsReceipt`,
// gelecekteki Excel/mobil/rapor) satırları BURADAN alır; tabloya doğrudan
// gitmez. `kind` ayracı, `CONSUMABLE` (boya/kimyasal) türü doğduğu gün üçüncü
// satır tipinin genişleme noktasıdır. Emsal: `_shipped.ts`, `producedOutputWhere`.
//
// ⚠️ Miktar alanları `Prisma.Decimal` taşır — JS float aritmetiği YASAK; Number
// çevirimi yalnız SUNUM kenarında (belge/ekran) yapılır.
// =============================================================================

const RECEIPT_ROLL_SELECT = {
  id: true,
  barcode: true,
  status: true,
  currentQty: true,
  initialQty: true,
  width: true,
  weightKg: true,
  purchasePrice: true,
  item: { select: { id: true, name: true, code: true, unit: true } },
  color: { select: { id: true, name: true } },
} as const;

const RECEIPT_YARN_SELECT = {
  id: true,
  kind: true,
  qtyKg: true,
  unitPrice: true,
  reason: true,
  createdAt: true,
  item: { select: { id: true, name: true, code: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

export type ReceiptRollRow = Prisma.RollGetPayload<{ select: typeof RECEIPT_ROLL_SELECT }>;
export type ReceiptYarnRow = Prisma.YarnMovementGetPayload<{ select: typeof RECEIPT_YARN_SELECT }>;

/** Kumaş satırı — top başına bir satır. `status` ayracı tüketicinindir
 *  (belge/fatura CANCELLED'ı dışlar, detay "ne oldu"yu gösterir). */
export interface ReceiptFabricLine {
  kind: "FABRIC";
  id: string;
  barcode: string | null;
  status: RollStatus;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  /** `Item.unit` (ItemUnit enum kodu: MT/KG/ADET) — fatura satırının birimi. */
  itemUnit: string;
  colorName: string | null;
  width: Prisma.Decimal | null;
  weightKg: Prisma.Decimal | null;
  /** Topun ŞU ANKİ metrajı (liste kuralı: tek okunur değer). */
  qty: Prisma.Decimal;
  /** Kabul ANINDAKİ metraj — fatura bunu kullanır (borç kesimle değişmez). */
  initialQty: Prisma.Decimal;
  purchasePrice: Prisma.Decimal | null;
}

/** İplik satırı — kg defteri hareketi. Ters kayıtlar (fiş iptali) DAHİLDİR;
 *  `movementKind` ayracı tüketicinindir (belge/fatura yalnız `IN` basar). */
export interface ReceiptYarnLine {
  kind: "YARN";
  id: string;
  movementKind: YarnMovementKind;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  /** POZİTİF kg; yönü `movementKind` söyler (`yarnMovementSign`). */
  qtyKg: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  reason: string | null;
  createdAt: Date;
}

export type ReceiptLine = ReceiptFabricLine | ReceiptYarnLine;

export interface ReceiptTotals {
  /** İptal edilmemiş top adedi ("ne kaldı"). */
  rollCount: number;
  /** İptal edilmemiş topların GÜNCEL metraj toplamı (m). */
  totalQty: number;
  /** TÜM iplik hareketi satırı sayısı — ters kayıt DAHİL (defter "ne oldu"). */
  yarnLineCount: number;
  /** NET iplik kg'si (IN − ters kayıtlar). ⚠️ Metrajla TOPLANMAZ: m ↔ kg. */
  totalYarnKg: number;
}

export interface AssembledReceipt {
  /** Union satırlar: önce kumaş, sonra iplik (ikisi de `createdAt asc`). */
  lines: ReceiptLine[];
  totals: ReceiptTotals;
  /** Ham satırlar — `loadDetail` yanıt sözleşmesi (Electron bu şekli okur). */
  rolls: ReceiptRollRow[];
  yarnMovements: ReceiptYarnRow[];
}

async function nextReceiptNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = dailyCodePrefix(RECEIPT_PREFIX, now);
  const rows = await tx.goodsReceipt.findMany({
    where: { receiptNo: { gte: prefix, startsWith: prefix } },
    select: { receiptNo: true },
  });
  return buildDailyCode(RECEIPT_PREFIX, nextDailySeq(rows.map((r) => r.receiptNo), prefix), now);
}

/**
 * Kullanıcı mesajı için satır özeti.
 *
 * ⚠️ İplik yokken çıktı ESKİSİYLE BİREBİR ("N top") — kumaş fişinin mesajı bu
 * özellik yüzünden değişmemeli.
 */
function describeLineResult(r: AddLinesResult): string {
  const parts = [`${r.created.length} top`];
  if (r.createdYarn.length > 0) parts.push(`${r.createdYarn.length} iplik kalemi`);
  return parts.join(" + ");
}

/**
 * D3 — FAZLA KABUL UYARISI (mesaj kuyruğu).
 *
 * ⚠️ Fazla mal REDDEDİLMEZ (kayıt gerçeği yazar) ama YUTULMAZ da: sipariş
 * kalemi ısmarlanandan fazlasını aldıysa depocu bunu FİŞİ KAPATIRKEN görmeli,
 * ay sonunda faturayla karşılaştırırken değil. Sipariş bağı yoksa / fazla yoksa
 * BOŞ string döner → mevcut mesajlar bayt-bayt korunur.
 */
export function describeOverReceipt(sync: PurchaseOrderSyncResult | null | undefined): string {
  if (!sync) return "";
  const parts: string[] = [];
  if (sync.overReceiptLines.length > 0) {
    parts.push(`${sync.overReceiptLines.length} kalemde sipariş miktarı AŞILDI (kalem ${sync.overReceiptLines.join(", ")})`);
  }
  // ⚠️ Siparişte HİÇ olmayan ürün: mal depoya girdi ve kaydı doğru, ama hiçbir
  // sipariş kalemine yazılamadı — en olası sebep açılır listeden YANLIŞ
  // siparişin seçilmesidir. Sessizce düşürmek, karşılanma rakamını sebebi
  // söylenmeden eksik bırakırdı.
  if (sync.unmatchedItemIds.length > 0) {
    parts.push(`${sync.unmatchedItemIds.length} ürün bu siparişte YOK (yanlış sipariş seçilmiş olabilir)`);
  }
  return parts.length > 0 ? ` ⚠ ${sync.orderNo}: ${parts.join("; ")}.` : "";
}

// =============================================================================
// J1 — İKİ OPT-IN KATILIK BAYRAĞI (ikisi de VARSAYILAN KAPALI)
// =============================================================================
// ① `purchase.blockOverReceiptEnabled` — siparişten FAZLA kabulü reddet.
// ② `goodsReceipt.requirePriceEnabled` — birim fiyatı çözülemeyen satırı reddet.
//
// ⚠️ KAPALIYKEN BAYT-BAYT BUGÜNKÜ DAVRANIŞ. Kapalı rejimde tek maliyet ayar
// okumasıdır (①'inki yalnız fiş bir alış siparişine BAĞLIYSA hiç koşar) ve
// satır işleme yolu tek bayt değişmez — fazla kabul yine YAZILIR ve yalnız
// `describeOverReceipt` ile UYARILIR, fiyatsız satır yine kabul edilir.
// Gerekçe dosyanın en başındaki "fazla mal GELEBİLİR, kayıt gerçeği yazar"
// kuralıdır; bayrak onu değil, TOLERANSI SIFIR olan kurulumun tercihini
// temsil eder.
//
// ⚠️ İKİSİ DE SATIR BAZLI ve `addLines` DÖNGÜSÜNÜN İÇİNDE koşar → engellenen
// satır `failed[]`e SEBEBİYLE düşer, diğerleri işlenmeye devam eder. Fişin
// tamamını 400'lemek "fiş bir kaptır / 42 girdi, 8'ini yutma" kuralının
// ihlali olurdu: kamyondan inen 40 topun 39'u meşruyken hepsini geri
// çevirmek, malı sisteme HİÇ girilemez yapar.
//
// ⚠️ SIRA SÖZLEŞMESİ (2026-08-04 dersi): önce satırın KENDİ tutarlılığı
// (fiyat), sonra BAĞLAM çözümü (sipariş kapsaması). Ters sırada, fiyatı da
// eksik olan bir satır önce "sipariş aşıldı" der; kullanıcı siparişi düzeltir,
// tekrar dener ve asıl eksiğini İKİ TUR SONRA öğrenir.
//
// ⚠️ İPTAL / TERS YOL MUAF ve bu YAPISALDIR: `cancel` satır DOĞURMAZ (toplar
// `softDelete`, iplik `reverseGoodsReceiptYarnTx` ile geri sarılır) ve
// `addLines`ten hiç geçmez. Guard'ları buraya değil de "her mal kabul yoluna"
// koymak, yanlış girilmiş bir fişi geri alınamaz yapardı (eksi kasa guard'ının
// ters-yol muafiyetiyle aynı ilke).
// =============================================================================

const D0 = new Prisma.Decimal(0);

/** Mesajda basılan birim — SUNUM amaçlı (kolon/karar değil). */
const UNIT_LABEL: Record<string, string> = { MT: "m", KG: "kg", ADET: "adet" };

/** Kullanıcıya basılan miktar: decimal.js sondaki sıfırları zaten atar. */
const qtyText = (v: Prisma.Decimal, unit: string): string => `${v.toString()} ${unit}`;

interface OverReceiptContext {
  orderNo: string;
  /** Ürün başına ISMARLANAN toplam — aynı ürün birden çok kalemde olabilir (farklı termin/fiyat), toplanır. */
  ordered: Map<string, Prisma.Decimal>;
  /** Ürün başına GELMİŞ toplam — siparişin TAMAMI için, bu fiş için değil. */
  received: Map<string, Prisma.Decimal>;
  /** BU çağrıda başarıyla yazılan miktar (kaynak okuması çağrı BAŞINDA yapıldı). */
  pending: Map<string, Prisma.Decimal>;
}

/**
 * ① Guard'ın veri kaynağı: KARŞILANMA SENKRONUNUN KENDİSİ.
 *
 * ⚠️ İKİNCİ BİR "ne geldi" HESABI YAZILMAZ (Sınıf 5). `computeReceivedByItemTx`
 * + `distributeFifo` zinciri `purchase-order.service`te yaşıyor ve fazla kabul
 * kararının (`over`) tek kaynağı odur; buraya kopyalanan bir toplam, bir gün
 * o zincir değiştiğinde guard ile UYARIYI (`describeOverReceipt`) farklı
 * şeyler söyleyen iki rakama böler. `syncPurchaseOrderSafely` aynı zinciri
 * KAYNAKTAN koşar → guard ile döngü sonundaki uyarı tanım gereği aynı evrende.
 *
 * ⚠️ Saklanan `PurchaseOrderLine.receivedQty` DOĞRUDAN OKUNMAZ: rollup
 * drift'e açıktır (`getById` bunu `drift` bayrağıyla ekranda söylüyor) ve
 * bayat-YÜKSEK bir sayaç, gerçekte sipariş kapsamındaki meşru bir malı
 * reddederdi — mal kamyonda beklerken. Senkron aynı anda drift'i de onarır.
 *
 * ⚠️ FAIL-OPEN: senkron çözülemezse (sipariş silinmiş / senkron hatası)
 * guard KOŞMAZ. Bir rapor rakamı yüzünden fiziksel mal girişini durdurmak,
 * `syncPurchaseOrderSafely`nin hatayı yutma gerekçesinin aynısıyla yanlıştır;
 * fazla kabul zaten `describeOverReceipt` ile SÖYLENİR.
 */
async function loadOverReceiptContext(purchaseOrderId: string): Promise<OverReceiptContext | null> {
  const sync = await syncPurchaseOrderSafely(purchaseOrderId);
  if (!sync) return null;
  const ordered = new Map<string, Prisma.Decimal>();
  const received = new Map<string, Prisma.Decimal>();
  for (const line of sync.lines) {
    ordered.set(line.itemId, (ordered.get(line.itemId) ?? D0).plus(line.qty));
    received.set(line.itemId, (received.get(line.itemId) ?? D0).plus(line.receivedQty));
  }
  return { orderNo: sync.orderNo, ordered, received, pending: new Map() };
}

/**
 * ① Satır sipariş miktarını aşıyor mu?
 *
 * ⚠️ `pending` LOAD-BEARING: satırlar ayrı tx'lerde doğuyor ama kaynak okuması
 * çağrı BAŞINDA bir kez yapıldı. Onsuz, 100 ısmarlanmış bir kaleme aynı fişte
 * 60 + 60 girilir ve İKİSİ de "60 ≤ 100" diye geçerdi — guard tam da kendi
 * fişinde delinirdi.
 *
 * ⚠️ SİPARİŞTE HİÇ OLMAYAN ÜRÜN DE ENGELLENİR (ısmarlanan 0 → her miktar
 * aşımdır) ve mesajı AYRIDIR. Bilinçli: kalemde 1 metre fazlayı reddedip
 * siparişte hiç bulunmayan bir ürünü sessizce kabul etmek tutarsız olurdu —
 * üstelik o durumun en olası sebebi `unmatchedItemIds` uyarısının söylediği
 * gerçek saha hatasıdır (açılır listeden YANLIŞ sipariş seçilmiş).
 *
 * ⚠️ ÇIKIŞ YOLU MESAJDA: mal fiziksel olarak gelmiştir ve kaydı bir yere
 * yazılmak ZORUNDADIR → siparişsiz ayrı fiş (bu kuraldan muaf), siparişi
 * düzeltme, ya da ayarı kapatma. Çıkışsız bir 400, depocuyu kayıt dışı
 * bırakır.
 */
function assertNotOverReceipt(
  ctx: OverReceiptContext,
  itemId: string,
  itemName: string,
  qty: Prisma.Decimal,
  unit: string,
): void {
  const ordered = ctx.ordered.get(itemId) ?? D0;
  const already = (ctx.received.get(itemId) ?? D0).plus(ctx.pending.get(itemId) ?? D0);
  const after = already.plus(qty);
  if (after.lte(ordered)) return;

  const tail =
    `"Siparişten fazla mal kabulünü engelle" ayarı açık — fazlayı kaydetmek için siparişe bağlı OLMAYAN ` +
    `ayrı bir mal kabul fişi açın, siparişi düzeltin ya da Ayarlar > Depo & Satın Alma'dan ayarı kapatın.`;

  if (ordered.isZero()) {
    throw AppError.badRequest(
      `"${itemName}" ${ctx.orderNo} siparişinde YOK (ısmarlanan 0), bu satırla ${qtyText(qty, unit)} girilecek. ` +
        `Yanlış sipariş seçilmiş olabilir. ${tail}`,
    );
  }
  throw AppError.badRequest(
    `"${itemName}": ${ctx.orderNo} siparişinde ${qtyText(ordered, unit)} ısmarlandı, ${qtyText(already, unit)} gelmiş; ` +
      `bu satırla ${qtyText(after, unit)} olur (${qtyText(after.minus(ordered), unit)} fazla). ${tail}`,
  );
}

/**
 * ② Satırın birim fiyatı ÇÖZÜLEBİLDİ Mİ?
 *
 * ⚠️ ÖLÇÜLEN ŞEY MEVCUT ÖN-DOLUM ZİNCİRİNİN SONUCUDUR (`priceFor`): satırın
 * kendi fiyatı > kalem kartının (tedarikçi istisnası > varsayılan) alış
 * fiyatı > null. Guard kendi zincirini kurmaz; kurarsa "panel fiyatı buldu,
 * backend bulamadı" (ya da tersi) sınıfı bir ayrışma doğar. Siparişin ANLAŞILAN
 * fiyatı bu zincire panel tarafından `unitPrice` olarak ÖN-DOLDURULUR
 * (`fillLinesFromOrder`) — yani "siparişten miras" bu guard'a satır fiyatı
 * olarak gelir; backend'de ayrıca sipariş kalemine bakan bir dal YOKTUR.
 *
 * ⚠️ `0` MEŞRU BİR FİYATTIR (bedava numune) ve buradan GEÇER — "fiyat yok" ile
 * "bedava" aynı şey değildir (`priceFor`in kendi kuralının aynası). Sıfır
 * fiyatlı satırın kaderi FATURA tarafındaki ayrı bir bayrağın işidir.
 */
function assertLinePriceResolved(
  price: Prisma.Decimal.Value | null,
  itemName: string,
  currency: string,
): void {
  if (price != null) return;
  throw AppError.badRequest(
    `"${itemName}": birim fiyat çözülemedi — satırda fiyat yok ve kalem kartında ${currency} alış fiyatı tanımlı değil. ` +
      `"Mal kabul satırında birim fiyat zorunlu" ayarı açık — satıra fiyatı girin, kalemin ${currency} alış fiyatını ` +
      `Tanımlar > Kalem Fiyatları'ndan tanımlayın ya da Ayarlar > Depo & Satın Alma'dan ayarı kapatın.`,
  );
}

export class GoodsReceiptService {
  /**
   * Fiş açar; `lines` verilmişse satırları da işler.
   *
   * Depo ZORUNLU ve AÇIK verilir — mal kabulde "hangi depoya" sorusunun sessiz bir
   * varsayılanı olamaz (tek depolu kurulumda arayüz onu otomatik seçer, kullanıcıya
   * sormaz; sözleşme yine de açıktır).
   */
  async create(input: GoodsReceiptCreateInput, userId?: string): Promise<ApiResponse<unknown>> {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, name: true, isActive: true },
    });
    if (!warehouse) throw AppError.badRequest("Depo bulunamadı.");
    if (!warehouse.isActive) throw AppError.badRequest(`"${warehouse.name}" deposu pasif — mal bu depoya alınamaz.`);

    if (input.supplierId) {
      const sup = await prisma.customer.findUnique({
        where: { id: input.supplierId },
        select: { id: true, name: true, isActive: true },
      });
      if (!sup) throw AppError.badRequest("Tedarikçi bulunamadı.");
      if (!sup.isActive) throw AppError.badRequest(`"${sup.name}" pasif durumda.`);
    }

    // İdempotent tekrar: aynı fiş iki kez açılmaz (ağ kopması / çift tıklama).
    if (input.clientToken) {
      const dupe = await prisma.goodsReceipt.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, receiptNo: true },
      });
      if (dupe) {
        return {
          success: true,
          data: await this.loadDetail(dupe.id),
          message: `Bu fiş zaten açılmış (${dupe.receiptNo}).`,
        };
      }
    }

    const receipt = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ── D3: ALIŞ SİPARİŞİ BAĞI ────────────────────────────────────────
        // ⚠️ Doğrulama ve bağ yazımı AYNI TX'te ve ALIŞ SİPARİŞİNİN advisory
        // kilidi ALTINDA yapılır (`purchase-order.service.cancel` de aynı
        // kilidi alır). Aksi hâlde "kontrol ettim, iptal değildi" ile "fişi
        // bağladım" arasına bir iptal sızabilir ve fiş, iptal edilmiş bir
        // siparişi işaret ederek karşılanma raporundan sessizce düşerdi.
        // ⚠️ Kilit HER SORGUDAN ÖNCE alınır (TOCTOU dersi).
        let supplierId = input.supplierId ?? null;
        if (input.purchaseOrderId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${input.purchaseOrderId}))`;
          const po = await tx.purchaseOrder.findUnique({
            where: { id: input.purchaseOrderId },
            select: { id: true, orderNo: true, status: true, supplierId: true },
          });
          if (!po) throw AppError.badRequest("Alış siparişi bulunamadı.");
          if (po.status === PurchaseOrderStatus.CANCELLED) {
            throw AppError.conflict(`${po.orderNo} iptal edilmiş — bu siparişe mal kabul yapılamaz.`);
          }
          // Tedarikçi ÇELİŞKİSİ sessizce çözülmez: hangisinin doğru olduğunu
          // yalnız operatör bilir ve yanlış tarafa yazmak alış faturası
          // mutabakatını yanlış cariye bağlardı.
          if (supplierId && supplierId !== po.supplierId) {
            throw AppError.badRequest(
              `Fişteki tedarikçi ${po.orderNo} siparişinin tedarikçisiyle aynı değil — birini düzeltin.`,
            );
          }
          // Fişte tedarikçi seçilmemişse siparişten MİRAS ALINIR: alış faturası
          // tedarikçisiz fişten kesilemiyor ve bilgi zaten elimizde.
          supplierId = supplierId ?? po.supplierId;
        }

        const receiptNo = await nextReceiptNo(tx);
        return tx.goodsReceipt.create({
          data: {
            receiptNo,
            warehouseId: input.warehouseId,
            supplierId,
            deliveryNoteNo: input.deliveryNoteNo?.trim() || null,
            currency: input.currency ?? "TRY",
            notes: input.notes?.trim() || null,
            clientToken: input.clientToken ?? null,
            purchaseOrderId: input.purchaseOrderId ?? null,
            createdById: userId ?? null,
          },
          select: { id: true, receiptNo: true },
        });
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "GOODS_RECEIPT",
      recordId: receipt.id,
      newData: { receiptNo: receipt.receiptNo, warehouseId: input.warehouseId, supplierId: input.supplierId ?? null },
    });

    const lineResult: AddLinesResult = input.lines?.length
      ? await this.addLines(receipt.id, input.lines, userId)
      : { created: [], createdYarn: [], failed: [], purchaseOrder: null };

    return {
      success: true,
      // ⚠️ `purchaseOrder` BURADA loadDetail'in sipariş BAŞLIĞINI bilerek EZER:
      // CREATE yanıtındaki alan SENKRON SONUCUDUR (overReceiptLines/unmatched…),
      // GET yanıtındaki aynı adlı alan ise sipariş BAŞLIĞIDIR (orderNo/status).
      // İki şekil ayrıdır ve panel bunu iki ayrı tiple modeller
      // (GoodsReceiptCreateData ↔ GoodsReceiptDetail). Yeni bir tüketici
      // (mobil/rapor) yazarken hangi yanıtı okuduğuna DİKKAT — yanlış şekli
      // okumak hata üretmez, alan sessizce boş görünür (2026-08-14 G1 notu).
      data: { ...(await this.loadDetail(receipt.id)), failed: lineResult.failed, purchaseOrder: lineResult.purchaseOrder ?? null },
      message:
        (lineResult.failed.length > 0
          ? `${receipt.receiptNo}: ${describeLineResult(lineResult)} girildi, ${lineResult.failed.length} satır atlandı.`
          : `${receipt.receiptNo} oluşturuldu (${describeLineResult(lineResult)}).`) +
        describeOverReceipt(lineResult.purchaseOrder),
    };
  }

  /**
   * SINIF 4 (I1, 2026-08-14) — SATIR ‖ İPTAL YARIŞ KAPISI.
   *
   * `addLines` fiş statüsünü tx DIŞINDA okuyordu (check-then-act) ve satırlar
   * ayrı tx'lerde doğuyordu → `cancel` o pencereye sızarsa CANCELLED fişe
   * CANLI top/iplik yazılıyordu (hata yok, log yok). Kapama: satırı yazan HER
   * tx'in İLK işi fişi `status=ACTIVE` şartıyla claim'lemektir. `cancel`ın
   * claim'i AYNI satırı kilitler → iki taraftan yalnız biri kazanır:
   *   · iptal önce commit'lendiyse → count=0 → 409, satır tx'i geri sarılır
   *     (top/iplik/barkod hiçbir iz bırakmaz);
   *   · satır claim'i öndeyse → `cancel`ın claim'i satır commit'ini BEKLER ve
   *     iptalin tx-içi TAZE top okuması yeni satırı görür (aşağıdaki `cancel`).
   *
   * `updatedAt` bump'ı kilidin taşıyıcısıdır (sıradan UPDATE → FOR NO KEY
   * UPDATE) ve semantik olarak da doğrudur: fişe satır ekleniyor. Mesaj,
   * tx-dışı hızlı-yol kontrolüyle AYNI cümledir — operatör aynı durumu iki
   * farklı şekilde okumasın.
   */
  private async claimActiveReceiptTx(
    tx: Prisma.TransactionClient,
    receiptId: string,
    receiptNo: string,
  ): Promise<void> {
    const claim = await tx.goodsReceipt.updateMany({
      where: { id: receiptId, status: GoodsReceiptStatus.ACTIVE },
      data: { updatedAt: new Date() },
    });
    if (claim.count === 0) {
      throw AppError.conflict(`${receiptNo} iptal edilmiş — satır eklenemez.`);
    }
  }

  /**
   * Fişe top ekler. Her satır kendi transaction'ında doğar (yukarıdaki "fiş bir
   * kaptır" notu); düşen satır `failed[]` içinde SEBEBİYLE döner.
   *
   * ⚠️ Baştaki statü kontrolü HIZLI YOLDUR (UX) — asıl sed her satır tx'inin
   * içindeki `claimActiveReceiptTx`tir (Sınıf 4, I1).
   */
  async addLines(receiptId: string, lines: GoodsReceiptLineInput[], userId?: string): Promise<AddLinesResult> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id: receiptId },
      // ⚠️ `supplierId` + `currency` fiyat ÖN-DOLUMU (D2) için okunur: fiyat
      // (kalem × cari × yön × para birimi) DÖRT boyutludur; üçünü bilmeden
      // sorulan soru yanlış satırı bulur.
      select: {
        id: true,
        receiptNo: true,
        status: true,
        warehouseId: true,
        supplierId: true,
        currency: true,
        // D3 — satırlardan sonra alış siparişinin karşılanması tazelenir.
        purchaseOrderId: true,
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      throw AppError.conflict(`${receipt.receiptNo} iptal edilmiş — satır eklenemez.`);
    }

    // ── FİYAT ÖN-DOLUMU (D2) ────────────────────────────────────────────────
    // ⚠️ ASLA EZMEZ: yalnız `unitPrice` HİÇ GÖNDERİLMEMİŞ (`null`/`undefined`)
    // satırlar için çözülür. `unitPrice: 0` depocunun BİLİNÇLİ girdisidir
    // (bedava numune) ve üstüne yazmak, yazdığını sessizce değiştirmek olurdu.
    // ⚠️ Çözülemezse alan BOŞ KALIR, sıfıra DÜŞMEZ — "fiyat bilinmiyor" ile
    // "bedava" aynı şey değildir.
    // ⚠️ TEK sorgu: 500 satırlık fişte satır başına lookup perf kuralı 7/9
    // ihlali olurdu. HER satırda fiyat AÇIKÇA girilmişse sorgu hiç koşmaz; ama
    // olağan durum tersidir (depocu fiyat yazmaz) → fiş başına BİR ek sorgu
    // vardır. "Sıfır ek maliyet" DEĞİL, "satır sayısından bağımsız tek sorgu".
    // Fiyat satırı olmayan kurulumda sorgu boş küme döner ve ön-dolum yapılmaz.
    const priceNeeded = [...new Set(lines.filter((l) => l.unitPrice == null).map((l) => l.itemId))];
    const priceMap =
      priceNeeded.length > 0
        ? await resolveItemPricesFor({
            itemIds: priceNeeded,
            kind: PriceKind.PURCHASE,
            currency: receipt.currency,
            customerId: receipt.supplierId,
          })
        : null;
    const priceFor = (line: GoodsReceiptLineInput): Prisma.Decimal.Value | null =>
      line.unitPrice ?? priceMap?.get(line.itemId)?.price ?? null;

    // Kalem TÜRLERİ TEK sorguda okunur (N+1 yok — 500 satırlık fişte satır
    // başına lookup perf kuralı 7/9 ihlali olurdu). Bulunamayan kalem burada
    // ELENMEZ: hata üretmeyi `createInitialEntry`'ye bırakırız ki mevcut
    // `failed[]` mesajı bayt-bayt aynı kalsın.
    //
    // ⚠️ `isActive` DE OKUNUR ve iplik dalında ARANIR. Kumaş yolunda pasif
    // kalemi `createInitialEntry` zaten reddediyor ("Ürün bulunamadı veya
    // pasif"); iplik dalı onu atladığı için AYNI fişte pasif bir kalem
    // kumaşsa reddediliyor, iplikse SESSİZCE deftere yazılıyordu — üstelik
    // `POST /api/yarn/movements` aynı kalemi reddederken. Aynı verinin iki
    // kapısı farklı cevap veriyorsa hangisinin doğru olduğu sorulamaz.
    // ⚠️ `unit` de okunur: guard mesajları miktarı BİRİMİYLE basar (kumaş m,
    // iplik kg) — aynı sorgu, ek maliyet yok.
    const itemInfo = new Map<string, { itemType: ItemType; isActive: boolean; name: string; unit: string }>();
    const ids = [...new Set(lines.map((l) => l.itemId))];
    if (ids.length > 0) {
      const rows = await prisma.item.findMany({
        where: { id: { in: ids } },
        select: { id: true, itemType: true, isActive: true, name: true, unit: true },
      });
      for (const r of rows) itemInfo.set(r.id, { itemType: r.itemType, isActive: r.isActive, name: r.name, unit: r.unit });
    }

    // ── J1 BAYRAKLARI (ikisi de varsayılan KAPALI — blok yorumu yukarıda) ───
    // ⚠️ Okuma DÖNGÜ DIŞINDA ve satır sayısından bağımsız (perf kuralı 7/9);
    // ① yalnız fiş bir alış siparişine BAĞLIYSA sorulur, yani üretici fabrika
    // yolunda tek ek sorgu bile koşmaz. Enforcement reader kalıbı gereği ayar
    // okuması cache'sizdir: panelden kapatılan bayrak bir sonraki fişte anında
    // etkisizleşir (acil kapatma yolu).
    const requirePrice = await readGoodsReceiptRequirePriceEnabled();
    const blockOverReceipt = receipt.purchaseOrderId ? await readPurchaseBlockOverReceiptEnabled() : false;
    const overCtx =
      blockOverReceipt && receipt.purchaseOrderId ? await loadOverReceiptContext(receipt.purchaseOrderId) : null;

    const created: string[] = [];
    const createdYarn: string[] = [];
    const failed: LineFailure[] = [];

    /**
     * ① sayacı — YALNIZ BAŞARILI satır sayılır (`created`/`createdYarn`
     * push'undan sonra). Guard'ın kendi reddettiği ya da başka bir sebeple
     * düşen satır "gelmiş mal" değildir; onu saymak, sonraki meşru satırları
     * hayalet bir miktar yüzünden reddederdi. Bayrak kapalıyken `overCtx` null
     * → bu çağrılar no-op.
     */
    const notePending = (line: GoodsReceiptLineInput): void => {
      if (!overCtx) return;
      overCtx.pending.set(
        line.itemId,
        (overCtx.pending.get(line.itemId) ?? D0).plus(new Prisma.Decimal(line.initialQty)),
      );
    };

    for (const [index, line] of lines.entries()) {
      try {
        const info = itemInfo.get(line.itemId);

        // ── J1 GUARD'LARI (satır bazlı; kapalıyken tek bayt çalışmaz) ──────
        // ⚠️ SIRA: önce satırın KENDİ tutarlılığı (fiyat), sonra bağlam
        // (sipariş kapsaması) — gerekçe yukarıdaki blok yorumda.
        // ⚠️ Kalem adı çözülemezse (silinmiş/uydurma id) guard SESSİZ GEÇER:
        // o satır zaten `createInitialEntry`nin "Ürün bulunamadı" hatasına
        // düşecek ve mevcut `failed[]` mesajı bayt-bayt korunmalı — hatayı
        // burada farklı bir cümleyle önden yakalamak, aynı durumu iki farklı
        // şekilde okutur.
        if (info) {
          const unit = UNIT_LABEL[info.unit] ?? info.unit;
          if (requirePrice) assertLinePriceResolved(priceFor(line), info.name, receipt.currency);
          if (overCtx) {
            assertNotOverReceipt(overCtx, line.itemId, info.name, new Prisma.Decimal(line.initialQty), unit);
          }
        }

        // ── İPLİK DALI ────────────────────────────────────────────────────
        // İplik `Roll` DOĞURMAZ: top metreyle/barkodla tek tek izlenir, iplik
        // kg ile ve toplu izlenir. Aynı satırdan hem `Roll` hem `YarnMovement`
        // doğurmak aynı malı İKİ KEZ saydırırdı.
        if (info?.itemType === ItemType.YARN) {
          // Pasif kalem: kumaş yolundaki `createInitialEntry` guard'ının ikizi.
          // Mesaj bilerek o yolla AYNI cümleyi kurar — operatör aynı hatayı
          // fişin iki farklı satırında iki farklı şekilde okumasın.
          if (!info.isActive) throw AppError.notFound("Ürün bulunamadı veya pasif (silinmiş)");
          // Fiyat ÖN-DOLUMU kumaşla AYNI zincir (D2): satırın kendi fiyatı
          // kazanır; yoksa kalem kartının alış fiyatı; o da yoksa NULL.
          createdYarn.push(await this.addYarnLine(receipt, line, priceFor(line), userId));
          notePending(line);
          continue;
        }

        const res = await inventory.createInitialEntry(
          {
            itemId: line.itemId,
            colorId: line.colorId ?? null,
            initialQty: line.initialQty,
            weightKg: line.weightKg ?? undefined,
            width: line.width ?? undefined,
            qualityGrade: line.qualityGrade ?? undefined,
            propertyIds: line.propertyIds,
            clientToken: line.clientToken,
          },
          userId,
          null,
          false,
          {
            // Satın alınan mal ÜRETİME girmez → doğrudan satılabilir depoya.
            forcedStatus: RollStatus.WAREHOUSE,
            forcedEntrySource: RollEntrySource.PURCHASE_RECEIPT,
            warehouseId: receipt.warehouseId,
            goodsReceiptId: receipt.id,
            foldType: line.foldType ?? null,
            // Fiyat ÖN-DOLUMU: satırın kendi fiyatı KAZANIR; yoksa kalem
            // kartının alış fiyatı (tedarikçi istisnası > kart varsayılanı)
            // uygulanır; o da yoksa NULL kalır.
            purchasePrice: priceFor(line),
            // Mal kabulde istasyon YOK (üretim noktası değil) — kolon NULL kalır.
            entryStationId: null,
            // SINIF 4 (I1): topu yazan tx'in İLK işi fiş-claim — iptal ile
            // satır doğumu aynı satır kilidinde serileşir (helper başlığı).
            txGate: (tx) => this.claimActiveReceiptTx(tx, receipt.id, receipt.receiptNo),
          },
        );
        created.push((res.data as { id: string }).id);
        notePending(line);
      } catch (err) {
        failed.push({
          index,
          itemId: line.itemId,
          reason: err instanceof Error ? err.message : "Bilinmeyen hata",
        });
      }
    }

    // ── D3: ALIŞ SİPARİŞİ KARŞILANMASI ────────────────────────────────────
    // ⚠️ SATIRLARDAN SONRA, kaynaktan yeniden hesapla. Satır satır `increment`
    // ATILMAZ: satırlar ayrı tx'lerde doğuyor ("fiş bir kaptır") ve düşen bir
    // satır sayacı yarım bırakırdı. Kaynak-temelli senkron ne olursa olsun
    // doğru sonucu yazar ve tekrar çağrılması zararsızdır (idempotent).
    // ⚠️ Sipariş bağı yoksa TEK SORGU BİLE koşmaz — üretici fabrikada bu satır
    // görünmez (`syncPurchaseOrderSafely` null'da hemen döner).
    const purchaseOrder = await syncPurchaseOrderSafely(receipt.purchaseOrderId);

    return { created, createdYarn, failed, purchaseOrder };
  }

  /**
   * İPLİK KABUL SATIRI — kg defterine `IN` yazar (fiş bağıyla).
   *
   * ⚠️ `initialQty` İPLİKTE KG'DİR. Fiş formunda tek bir "miktar" alanı vardır
   * ve birimi KALEMİN TÜRÜ belirler (kumaş → metre, iplik → kg). İkinci bir
   * alan icat etmek panelin iki ayrı satır tipi taşımasını gerektirirdi.
   *
   * ⚠️ ÇELİŞEN GİRDİ SESSİZCE SEÇİLMEZ, REDDEDİLİR: `weightKg` de gönderilmiş
   * ve miktardan farklıysa hangisinin doğru olduğunu yalnız operatör bilir —
   * birini seçmek defteri sessizce yanlışlardı. Aynı gerekçeyle kumaşa özgü
   * alanlar (renk/en/kalite/kat/özellik) iplikte reddedilir: `YarnStock`
   * (kalem × depo) onları TAŞIYAMAZ ve sessizce düşürülmeleri, operatöre
   * "boyalı ipliğim ayrı izleniyor" yalanını söylerdi. (Lot/renk kırılımı
   * gerektiğinde çözüm `YarnLot`tur, sessiz kabul değil.)
   */
  private async addYarnLine(
    receipt: { id: string; receiptNo: string; warehouseId: string },
    line: GoodsReceiptLineInput,
    /** D2 zinciriyle ÇÖZÜLMÜŞ birim fiyat (satır > kart > null) — fişin para biriminde. */
    unitPrice: Prisma.Decimal.Value | null,
    userId?: string,
  ): Promise<string> {
    const qtyKg = new Prisma.Decimal(line.initialQty);
    if (line.weightKg != null && !new Prisma.Decimal(line.weightKg).equals(qtyKg)) {
      throw AppError.badRequest(
        `İplik satırında miktar (${qtyKg.toString()} kg) ile ağırlık (${line.weightKg} kg) çelişiyor. ` +
          `İplikte miktar zaten kg'dır — ağırlık alanını boş bırakın.`,
      );
    }

    const strays: string[] = [];
    if (line.colorId) strays.push("renk");
    if (line.width != null) strays.push("en");
    if (line.qualityGrade) strays.push("kalite");
    if (line.foldType) strays.push("kat");
    if (line.propertyIds?.length) strays.push("özellik");
    if (strays.length > 0) {
      throw AppError.badRequest(
        `İplik satırı ${strays.join(" / ")} taşıyamaz — iplik stoğu kalem × depo bazında kg olarak tutulur. ` +
          `Bu alanlar kumaş (top) satırlarına aittir.`,
      );
    }

    // FİYAT (`YarnMovement.unitPrice`, migration 20260814 — Sınıf 5): fişin
    // para biriminde, kabul ANINDA donar (`Roll.purchasePrice` simetriği) —
    // alış faturası taslağı önce bu değere bakar. TARİHÇE: kolon gelmeden önce
    // burada AÇIK yazılmış fiyat 400 ile reddediliyordu ("kolon yok — faturada
    // elle yazın"); o guard kolonla birlikte kalktı.
    //
    // ⚠️ Fiyat `applyYarnMovementTx` imzasına EKLENMEDİ, satıra AYNI tx içinde
    // yazılır: o kapı defterin MİKTAR sözleşmesidir ve ters kayıt yolları da
    // (`reverseGoodsReceiptYarnTx` → ADJUST_OUT) oradan geçer — imzaya fiyat
    // koymak, geri sarımın (ticari olay değildir) fiyat taşımasına kapı açardı.
    // Aynı tx şart: satır ile fiyatı ayrı commit'lere bölmek "fiyatlı girildi,
    // fiyatsız kaldı" yarım durumunu doğururdu. Satır tx dışına henüz görünür
    // olmadığı için bu, append-only defterde bir "düzeltme" DEĞİLDİR.
    const res = await prisma.$transaction(async (tx) => {
      // SINIF 4 (I1): İLK ifade — kumaş yolundaki `txGate`in ikizi. İptal bu
      // satır kilidinde bekler; iptal önce commit'lendiyse count=0 → 409 ve
      // CANCELLED fişe iplik satırı DOĞMAZ.
      await this.claimActiveReceiptTx(tx, receipt.id, receipt.receiptNo);
      const applied = await applyYarnMovementTx(tx, {
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        kind: YarnMovementKind.IN,
        qtyKg,
        goodsReceiptId: receipt.id,
        reason: `Mal kabul (${receipt.receiptNo})`,
        userId: userId ?? null,
      });
      if (unitPrice != null) {
        await tx.yarnMovement.update({
          where: { id: applied.movementId },
          data: { unitPrice: new Prisma.Decimal(unitPrice) },
        });
      }
      return applied;
    });

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "YARN_MOVEMENT",
      recordId: res.movementId,
      newData: {
        source: "GOODS_RECEIPT",
        receiptNo: receipt.receiptNo,
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        kind: YarnMovementKind.IN,
        qtyKg: qtyKg.toString(),
        unitPrice: unitPrice != null ? new Prisma.Decimal(unitPrice).toString() : null,
        balanceAfter: res.balanceKg.toString(),
      },
    });

    return res.movementId;
  }

  /**
   * Fişi iptal eder: toplar `softDelete` ile CANCELLED olur (mal HİÇ girmedi
   * semantiği — `qtyOut=0` storno), fiş CANCELLED işaretlenir.
   *
   * ⚠️ SEVK EDİLMİŞ ya da BAŞKA İŞLEM GÖRMÜŞ top varsa fiş iptal EDİLMEZ: mal
   * gerçekten kullanılmış, "hiç girmedi" demek defteri yalanlar. Operatör önce
   * o topları ayıklamalı.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      select: { id: true, receiptNo: true, status: true, purchaseOrderId: true },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      return { success: true, data: receipt, message: `${receipt.receiptNo} zaten iptal edilmiş.` };
    }

    // ⚠️ FATURALANMIŞ FİŞ İPTAL EDİLEMEZ (2026-08-14 denetim bulgusu, KRİTİK).
    // Guard eskiden YALNIZ topların statüsüne bakıyordu; faturaya hiç
    // bakmıyordu. Ölçülen saha senaryosu: depocu "yanlış fiş" deyip iptal eder
    // (toplar WAREHOUSE olduğu için guard geçer), muhasebeci ertesi gün bağlı
    // TASLAK faturayı onaylar — onay geçer ve tedarikçi carisine, hiç gelmemiş
    // mal için borç yazılır. Belge donar, hata çıkmaz, log çıkmaz. ONAYLI
    // faturada da aynısı ters yönde: fiş iptal edilse defter satırı yerinde
    // kalır. Emsal karar aynı repoda var: `shipping.service` faturalanmış
    // sevkiyatın geri alınmasını reddediyor.
    //
    // ⚠️ BURASI HIZLI YOLDUR (aynı gün akşam düzeltmesi — Sınıf 4): tx dışı bu
    // kontrol tek başına check-then-act'ti; kontrol ile aşağıdaki claim
    // arasında taslak doğup ONAYLANABİLİYORDU (fiş CANCELLED + fatura CONFIRMED
    // — ikisi birden). ASIL SED tx İÇİNDE, claim'den SONRA tekrarlanır (aşağı
    // bak); burası UX için kalır: iki engel birden varken kullanıcıya doğru
    // SIRAYI söyler (bu kontrol TOP kontrolünden ÖNCE — ikisi de engelliyorsa
    // kullanıcı önce faturayı iptal etmeli; topları ayıklamak fatura dururken
    // hiçbir işe yaramaz ve kullanıcıyı iki tur gezdirirdi).
    const invoiceBlockMessage = (docNo: string, status: InvoiceStatus): string =>
      `${receipt.receiptNo}: bu fişten ${docNo} numaralı alış faturası kesilmiş ` +
      `(${status === InvoiceStatus.CONFIRMED ? "onaylı" : "taslak"}) — fiş iptal edilemez. ` +
      `Önce faturayı iptal edin.`;
    const liveInvoice = await prisma.invoice.findFirst({
      where: { goodsReceiptId: id, status: { not: InvoiceStatus.CANCELLED } },
      select: { docNo: true, status: true },
    });
    if (liveInvoice) {
      throw AppError.conflict(invoiceBlockMessage(liveInvoice.docNo, liveInvoice.status));
    }

    const rollCancelSelect = {
      id: true,
      barcode: true,
      status: true,
      sackId: true,
      shipmentId: true,
    } as const;
    const rolls = await prisma.roll.findMany({
      where: { goodsReceiptId: id },
      select: rollCancelSelect,
    });

    // Guard: iptal yalnız "mal hiç kullanılmadı" iken meşru.
    //
    // ⚠️ STATÜ TEK BAŞINA YETMEZ (2026-08-14 denetim bulgusu). Çuvala konmuş ya
    // da PLANNED bir sevkiyata eklenmiş top `SHIPPED` DEĞİL, hâlâ `WAREHOUSE`
    // statüsündedir — yalnız `sackId`/`shipmentId` doludur. Eski süzgeç onları
    // "işlem görmemiş" sayıyordu: guard geçiyor, fiş CANCELLED olarak COMMIT
    // ediliyor, sonra `softDelete` o toplar için 409 verip `skipped[]`e
    // düşürüyordu. Sonuç YARIM bir iptal — fiş iptal, topların bir kısmı canlı
    // ve sevkiyatta, sipariş karşılanması sıfırlanmış, o fişten artık fatura da
    // kesilemiyor — ve fişi geri açacak HİÇBİR uç yok.
    //
    // ⚠️ Çuvaldaki top (sevkiyatsız) daha sinsiydi: guard'a hiç takılmıyor,
    // `softDelete` topu çuvaldan SESSİZCE çıkarıyor ama çuvalın denormalize
    // `weightKg`'si bayat kalıyordu (`resetSackWeightsTx` çağrılmıyor) — ve o
    // kg irsaliyeye gidiyordu.
    type CancelRollRow = {
      id: string;
      barcode: string | null;
      status: RollStatus;
      sackId: string | null;
      shipmentId: string | null;
    };
    const assertRollsUnused = (list: CancelRollRow[]): void => {
      const used = list.filter(
        (r) =>
          (r.status !== RollStatus.WAREHOUSE &&
            r.status !== RollStatus.A1_STOCK &&
            r.status !== RollStatus.CANCELLED) ||
          r.sackId !== null ||
          r.shipmentId !== null,
      );
      if (used.length === 0) return;
      const sample = used
        .slice(0, 5)
        .map((r) => {
          const nerede = r.shipmentId ? "sevkiyatta" : r.sackId ? "çuvalda" : r.status;
          return `${r.barcode ?? r.id.slice(0, 8)} (${nerede})`;
        })
        .join(", ");
      throw AppError.conflict(
        `${receipt.receiptNo}: ${used.length} top işlem görmüş (${sample}${used.length > 5 ? "…" : ""}) — fiş iptal edilemez. ` +
          `Önce o topları ayıklayın.`,
      );
    };
    // Hızlı yol (UX): iki engel birden varken sıra mesajı korunur (önce fatura,
    // sonra top). ASIL kopya tx İÇİNDE, claim'den sonra TAZE kümeyle koşar.
    assertRollsUnused(rolls);

    // ⚠️ CLAIM ile İPLİK STORNOSU AYNI TX'TE.
    // Claim atomiktir (iki paralel iptalden yalnız biri geçer) ve ters kayıt
    // ONA BAĞLI: ayrı tx'lerde koşsalardı fiş CANCELLED olur, aradaki bir
    // çökmede iplik depoda kalırdı — bakiye sessizce şişer. Toplar hâlâ dışarıda
    // iptal edilir (`softDelete` kendi tx'ini açıyor, değiştirilmedi).
    //
    // ⚠️ KUMAŞ-ONLY FİŞTE DAVRANIŞ AYNI: ters kayıt fonksiyonu indeksli
    // `goodsReceiptId` üzerinden 0 satır okur ve HİÇBİR ŞEY yazmaz.
    const { yarnReversal, freshRolls } = await prisma.$transaction(async (tx) => {
      const claim = await tx.goodsReceipt.updateMany({
        where: { id, status: GoodsReceiptStatus.ACTIVE },
        data: {
          status: GoodsReceiptStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Fiş bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");
      }
      // ⚠️ ÇAPRAZ YARIŞ SEDDİ — fatura kontrolünün ASIL kopyası (Sınıf 4,
      // 2026-08-14 akşam). Yukarıdaki hızlı-yol kontrolü tx DIŞINDA; onunla
      // claim arasında bir taslak doğup onaylanabilir. Serileşme `goods_receipts`
      // SATIRI üzerinden: yukarıdaki claim bu satırı kilitledi; `invoice.confirm`
      // aynı satırı `SELECT … FOR UPDATE` ile kilitleyip durumunu okuyor. Onay
      // önce commit'lediyse buradaki taze okuma canlı faturayı görür ve iptal
      // (claim DAHİL) geri sarılır; biz önce commit'lersek onayın kilitli okuması
      // fişi CANCELLED görür ve 409 verir — iki uçtan YALNIZ biri kazanır.
      // (Kilit sırası: biz GR satırı → fatura OKUMASI (kilitsiz); confirm fatura
      // satırı → GR satırı. Ortak kilitli kaynak tek (GR) olduğu için ABBA yok.)
      const liveInvoiceTx = await tx.invoice.findFirst({
        where: { goodsReceiptId: id, status: { not: InvoiceStatus.CANCELLED } },
        select: { docNo: true, status: true },
      });
      if (liveInvoiceTx) {
        throw AppError.conflict(invoiceBlockMessage(liveInvoiceTx.docNo, liveInvoiceTx.status));
      }
      // ⚠️ TAZE TOP KÜMESİ CLAIM'DEN SONRA OKUNUR (Sınıf 4, I1). Tx-dışı
      // `rolls` snapshot'ı BAYATTIR: claim'imizi bekleten uçuştaki bir satır
      // tx'i (fiş-claim'i bizden önce almış `addLines`) commit'lenince topu
      // o snapshot GÖRMEZ — iptal loop'u onu atlar ve CANCELLED fişte canlı
      // top kalırdı (yarışın ters yönü). Claim commit'lendikten sonra yeni
      // satır DOĞAMAZ (satır claim'leri 409 alır) → bu okuma tam ve kararlıdır.
      // Guard da TAZE kümeyle TEKRARLANIR: ihlalde tx geri sarılır, fiş ACTIVE
      // kalır (yarım iptal yok).
      const freshRolls = await tx.roll.findMany({
        where: { goodsReceiptId: id },
        select: rollCancelSelect,
      });
      assertRollsUnused(freshRolls);
      const yarnReversal = await reverseGoodsReceiptYarnTx(
        tx,
        id,
        reason?.trim() || `Mal kabul fişi iptali (${receipt.receiptNo})`,
        userId ?? null,
      );
      return { yarnReversal, freshRolls };
    });

    // Eksi bakiye ENGEL DEĞİL: iplik fişten sonra sarf edilmiş olabilir ve
    // iptali reddetmek defteri değil yalnız ekranı düzeltirdi. Ama SÖYLENİR.
    const yarnNegative = yarnReversal.filter((y) => y.balanceKg.lt(0));

    // Toplar tek tek iptal edilir (`softDelete` kendi tx'ini açar + kendi
    // guard'larını koşar — ölü etiket onayı dahil). Küme TAZE okumadan gelir
    // (`freshRolls`) — bayat tx-dışı snapshot uçuştaki satırı kaçırırdı.
    const cancelled: string[] = [];
    const skipped: LineFailure[] = [];
    for (const [index, r] of freshRolls.entries()) {
      if (r.status === RollStatus.CANCELLED) continue;
      try {
        await inventory.softDelete(r.id, userId, {
          confirmActive: true,
          confirmLabelPrinted: true,
          reason: reason?.trim() || `Mal kabul fişi iptali (${receipt.receiptNo})`,
        });
        cancelled.push(r.id);
      } catch (err) {
        skipped.push({ index, itemId: r.id, reason: err instanceof Error ? err.message : "Bilinmeyen hata" });
      }
    }

    // ── D3: ALIŞ SİPARİŞİ KARŞILANMASI GERİ DÜŞER ─────────────────────────
    // ⚠️ TOPLAR İPTAL EDİLDİKTEN SONRA çalışır, önce değil: senkron kaynağı
    // (iptal edilmemiş toplar) okur; erken koşarsa henüz iptal edilmemiş
    // topları hâlâ "gelmiş" sayardı. Fişin kendisi zaten CANCELLED olduğu için
    // toplam sıfırlanır, sipariş OPEN'a döner ve yeniden kabule açılır.
    // ⚠️ `syncPurchaseOrderSafely` hatayı YUTAR — mal kabul iptali fiziksel bir
    // gerçeği kaydeder ve bir rapor rakamı yüzünden geri alınmamalıdır; rollup
    // bir sonraki senkronda kendini onarır.
    const poSync = await syncPurchaseOrderSafely(receipt.purchaseOrderId);

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "GOODS_RECEIPT",
      recordId: id,
      newData: {
        kind: "CANCEL",
        receiptNo: receipt.receiptNo,
        cancelledRolls: cancelled.length,
        skipped: skipped.length,
        reason: reason ?? null,
        yarnReversed: yarnReversal.map((y) => ({ itemId: y.itemId, warehouseId: y.warehouseId, qtyKg: y.qtyKg.toString() })),
        purchaseOrderId: receipt.purchaseOrderId ?? null,
        purchaseOrderStatus: poSync?.status ?? null,
      },
    });

    const yarnNote =
      yarnReversal.length > 0
        ? ` ${yarnReversal.length} iplik kalemi ters kayıtla düşüldü.${
            yarnNegative.length > 0 ? ` ⚠️ ${yarnNegative.length} kalemde bakiye eksiye düştü (mal fişten sonra sarf edilmiş olabilir).` : ""
          }`
        : "";

    return {
      success: true,
      data: {
        id,
        receiptNo: receipt.receiptNo,
        cancelledRolls: cancelled.length,
        skipped,
        yarnReversed: yarnReversal.map((y) => ({
          itemId: y.itemId,
          warehouseId: y.warehouseId,
          qtyKg: y.qtyKg.toString(),
          balanceKg: y.balanceKg.toString(),
        })),
      },
      message:
        (skipped.length > 0
          ? `${receipt.receiptNo} iptal edildi; ${cancelled.length} top düşürüldü, ${skipped.length} top atlandı.`
          : `${receipt.receiptNo} iptal edildi (${cancelled.length} top).`) + yarnNote,
    };
  }

  /**
   * Fiş listesi (sayfalı). Sorgu SERVİSTE — route/controller katmanında prisma
   * import'u yasak (CLAUDE.md katman kuralı; ESLint bunu mekanik olarak kapatıyor).
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
  }): Promise<{ rows: unknown[]; total: number }> {
    const where = buildWhereClause(params.filters, ["receiptNo", "deliveryNoteNo", "notes"], params.search);
    const [rows, total] = await Promise.all([
      prisma.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          receiptNo: true,
          status: true,
          deliveryNoteNo: true,
          createdAt: true,
          cancelledAt: true,
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          // ⚠️ LİSTE SAYACI BİLİNÇLİ OLARAK `_count` — assembler DEĞİL.
          // Assembler İÇERİK yüzeylerinin tek kaynağıdır; listeye satır başına
          // assembler koşturmak N+1'dir (perf kuralı 7/9). `_count` aynı
          // sorguda gelir ve semantiği HAM satır sayısıdır (iptal edilmiş top /
          // ters iplik kaydı DAHİL) — liste "fişte kaç kayıt var" sayacıdır,
          // "ne kaldı" sorusunun cevabı detaydaki `totals`tadır. İki sayacın
          // ayrıştığı tek durum iptalli fiştir ve o satır zaten CANCELLED
          // rozetiyle çizilir. `yarnMovements` sayacı Sınıf 5 ile eklendi:
          // yalnız `rolls` saymak, 500 kg iplik alınmış fişi listede "0 satır"
          // gösteriyordu (2026-08-14 denetim bulgusu #17'nin liste yüzü).
          _count: { select: { rolls: true, yarnMovements: true } },
        },
      }),
      prisma.goodsReceipt.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * TEK KAYNAK SATIR ASSEMBLER (Sınıf 5) — fişin İKİ çocuk tablosunu tek
   * union'da + türetilmiş toplamlarla verir. İçerik okuyan her yüzey buradan
   * beslenir (dosya başındaki blok yorum).
   *
   * `db` parametresi donmuş belge builder'ı için: `fresh` bir tx İÇİNDEN de
   * çağrılabilir (`freezeForSource`). ⚠️ İki sorgu SIRALI koşar — tx client'ta
   * `Promise.all` YASAK (perf kuralı 11).
   */
  async assembleReceiptLines(
    receiptId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<AssembledReceipt> {
    const rolls = await db.roll.findMany({
      where: { goodsReceiptId: receiptId },
      orderBy: { createdAt: "asc" },
      select: RECEIPT_ROLL_SELECT,
    });
    // Ters kayıtlar (iptal) DAHİL — defter görünümü "ne oldu"yu anlatır,
    // "ne kaldı"yı değil. "Ne kaldı" sorusunun cevabı `totals`tadır.
    const yarnMovements = await db.yarnMovement.findMany({
      where: { goodsReceiptId: receiptId },
      orderBy: { createdAt: "asc" },
      select: RECEIPT_YARN_SELECT,
    });

    // Union sırası: önce kumaş, sonra iplik (fiş ekranı ve belge topları önce
    // basar; iplik ikinci tablodur). Her küme kendi içinde `createdAt asc`.
    const lines: ReceiptLine[] = [
      ...rolls.map(
        (r): ReceiptFabricLine => ({
          kind: "FABRIC",
          id: r.id,
          barcode: r.barcode,
          status: r.status,
          itemId: r.item.id,
          itemName: r.item.name,
          itemCode: r.item.code,
          itemUnit: r.item.unit,
          colorName: r.color?.name ?? null,
          width: r.width,
          weightKg: r.weightKg,
          qty: r.currentQty,
          initialQty: r.initialQty,
          purchasePrice: r.purchasePrice,
        }),
      ),
      ...yarnMovements.map(
        (m): ReceiptYarnLine => ({
          kind: "YARN",
          id: m.id,
          movementKind: m.kind,
          itemId: m.item.id,
          itemName: m.item.name,
          itemCode: m.item.code,
          qtyKg: m.qtyKg,
          unitPrice: m.unitPrice,
          reason: m.reason,
          createdAt: m.createdAt,
        }),
      ),
    ];

    const liveRolls = rolls.filter((r) => r.status !== RollStatus.CANCELLED);
    const totalQty = liveRolls.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));
    // İplik NET kg — ters kayıtlar düşülür. ⚠️ Metrajla TOPLANMAZ: 100 metre
    // kumaş ile 100 kg iplik farklı birimlerdir ve tek sayıya indirmek
    // anlamsız bir "toplam" üretirdi.
    const totalYarnKg = yarnMovements.reduce(
      (s, m) => s.plus(new Prisma.Decimal(m.qtyKg).mul(yarnMovementSign(m.kind))),
      new Prisma.Decimal(0),
    );

    return {
      lines,
      totals: {
        rollCount: liveRolls.length,
        totalQty: Number(totalQty),
        yarnLineCount: yarnMovements.length,
        totalYarnKg: Number(totalYarnKg),
      },
      rolls,
      yarnMovements,
    };
  }

  /**
   * Fiş detayı — başlık + toplar + iplik satırları.
   *
   * ⚠️ İPLİK SATIRLARI BURADA GÖRÜNMEK ZORUNDA: iplik `Roll` doğurmadığı için,
   * yalnız `rolls` dönseydi 500 kg iplik alınan fiş ekranda BOŞ görünürdü ve
   * depocu "kaydedilmemiş" sanıp ikinci kez girerdi.
   *
   * Satırlar + toplamlar `assembleReceiptLines`ten gelir (Sınıf 5 — 2026-08-14):
   * mevcut yanıt anahtarları (`rolls`, `yarnMovements`, `totals`) AYNI şekilde
   * döner; `lines` union'ı ve satırlardaki fiyat alanları EK'tir (Electron'un
   * okuduğu hiçbir alan değişmedi). Bir yerine üç sorgu bilinçli bedel: detay
   * tekil ekrandır ve içerik tek kaynaktan sapamaz.
   */
  async loadDetail(id: string): Promise<Record<string, unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        // D3 — bağlı alış siparişinin başlığı (fişten siparişe tıkla-git).
        purchaseOrder: { select: { id: true, orderNo: true, status: true, currency: true, expectedDate: true } },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");

    const asm = await this.assembleReceiptLines(id);
    return {
      ...receipt,
      rolls: asm.rolls,
      yarnMovements: asm.yarnMovements,
      lines: asm.lines,
      totals: asm.totals,
    };
  }
}

export const goodsReceiptService = new GoodsReceiptService();
export default goodsReceiptService;

// =============================================================================
// DONMUŞ BELGE — Mal Kabul Fişi
// =============================================================================
// ⚠️ TRANSFERDEN FARKLI OLARAK BELGE İLK BASKIDA (lazy-init) DONAR, fiş açılışında
// DEĞİL. Sebep: fiş bir KAPTIR — mal parça parça gelir ve satırlar sonradan
// eklenir (`POST /:id/lines`). Açılışta dondurmak, içi BOŞ bir resmi belge
// üretirdi. `getCurrent`in lazy-init yolu ilk baskıda o anki içeriği dondurur.
//
// İptal edilmiş fişin belgesi İPTAL filigranıyla basılır (`voidInfo`) — kâğıt
// sahada dolaşmış olabilir, kaydı yok sayılmaz.
/** Belgeye basılan iplik satırı — şekil renderer'daki `GoodsReceiptDoc.yarnLines?`
 *  sözleşmesinin AYNISI (dikiş 2026-08-14'te tamamlandı: renderer koşullu
 *  "KABUL EDİLEN İPLİK (kg)" tablosunu basıyor; alan yoksa tek bayt basılmaz). */
interface GoodsReceiptYarnDocLine {
  itemName: string;
  qtyKg: number;
}
type GoodsReceiptDocWithYarn = GoodsReceiptDoc & { yarnLines?: GoodsReceiptYarnDocLine[] };

registerPrintedDocBuilder(PrintedDocType.GOODS_RECEIPT, {
  fresh: async (db, sourceId) => {
    const r = await db.goodsReceipt.findUnique({
      where: { id: sourceId },
      select: {
        receiptNo: true, createdAt: true, notes: true, deliveryNoteNo: true,
        status: true, cancelledAt: true, cancelReason: true,
        warehouse: { select: { name: true, code: true } },
        supplier: { select: { name: true, code: true } },
        createdBy: { select: { fullName: true, username: true } },
      },
    });
    if (!r) return null;

    // SATIRLAR TEK KAYNAKTAN (Sınıf 5): builder eskiden `rolls`u KENDİ okuyordu
    // ve resmi fiş belgesi — depocu-tedarikçi mutabakatının ana kâğıdı — 500 kg
    // ipliği HİÇ basmıyordu. Tabloya giden dördüncü kopya olmak yerine assembler
    // tüketilir; `db` geçilir ki freeze bir tx içindeyken de aynı anı okusun.
    const asm = await goodsReceiptService.assembleReceiptLines(sourceId, db);
    // İPTAL EDİLMİŞ top belgede GÖRÜNMEZ: fiş "bu mal girdi" der; iptal edilen
    // satır girmemiş sayılır (softDelete = qtyOut 0 stornosu ile aynı semantik).
    const fabric = asm.lines.filter(
      (l): l is ReceiptFabricLine => l.kind === "FABRIC" && l.status !== RollStatus.CANCELLED,
    );
    // İplikte belgeye YALNIZ `IN` girer: ters kayıt (ADJUST_OUT) fiş iptalinin
    // defter iziidir, "kabul edilen mal" değildir (iptalli fiş zaten İPTAL
    // filigranıyla basılır).
    const yarnIn = asm.lines.filter(
      (l): l is ReceiptYarnLine => l.kind === "YARN" && l.movementKind === YarnMovementKind.IN,
    );

    const doc: GoodsReceiptDocWithYarn = {
      header: {
        documentNo: r.receiptNo,
        date: r.createdAt.toISOString(),
        warehouseName: r.warehouse.name,
        warehouseCode: r.warehouse.code,
        supplierName: r.supplier?.name ?? null,
        supplierCode: r.supplier?.code ?? null,
        deliveryNoteNo: r.deliveryNoteNo,
        createdBy: r.createdBy?.fullName ?? r.createdBy?.username ?? null,
      },
      lines: fabric.map((x) => ({
        barcode: x.barcode,
        itemName: x.itemName,
        colorName: x.colorName,
        width: x.width != null ? Number(x.width) : null,
        qty: Number(x.qty),
      })),
      notes: r.notes,
      // ⚠️ `yarnLines` YALNIZ DOLUYSA yazılır — kumaş-only fişin snapshot'ı ve
      // ESKİ snapshot'ların render'ı BAYT-BAYT aynı kalır (opsiyonel-alan
      // konvansiyonu: `sackNote`/`batchNumber` emsali — alan yoksa TEK BAYT
      // basılmaz). Boş dizi bile yazmak, eski belgelerin parmak izini bozardı.
      ...(yarnIn.length > 0
        ? { yarnLines: yarnIn.map((y): GoodsReceiptYarnDocLine => ({ itemName: y.itemName, qtyKg: Number(y.qtyKg) })) }
        : {}),
    };

    return {
      documentNo: r.receiptNo,
      doc: doc as unknown as Record<string, unknown>,
      // Fiş iptal edilmişken ilk kez basılıyorsa belge doğrudan VOIDED doğar.
      voidInfo:
        r.status === GoodsReceiptStatus.CANCELLED
          ? { reason: r.cancelReason, at: r.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderGoodsReceiptHtml,
});
