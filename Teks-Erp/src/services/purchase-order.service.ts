// =============================================================================
// ALIŞ SİPARİŞİ (PurchaseOrder) — "ne ısmarladım, ne geldi"
// =============================================================================
// NEDEN VAR: alım-satım kurulumunda mal kabul TEK BAŞINA yeterli değil. Fiş
// "ne geldi" der; "ne ısmarlamıştım, kalan ne" sorusunun cevabı hiçbir yerde
// yoktu ve satın almacı bunu Excel'de tutuyordu. Excel'de tutulan taahhüt,
// tedarikçi eksik gönderdiğinde SESSİZCE kaybolur.
//
// ⚠️ MEVCUT `Order` BÜKÜLMEDİ (şema notunun gerekçesi burada da geçerli): o
// model satış/üretim dünyasına bağlı (iş emri, sevkiyat, tahsis, refakat
// kartı). Alış siparişini oraya sokmak, üretim tarafındaki HER sorguya "ama bu
// alış siparişi değilse" şartı eklemek demekti — ve o şartı unutan ilk sorgu
// sessizce yanlış olurdu.
//
// -----------------------------------------------------------------------------
// KARŞILANMA (`receivedQty`) — BİR ROLLUP'TIR, SERBEST BİR SAYAÇ DEĞİL
// -----------------------------------------------------------------------------
// `PurchaseOrderLine.receivedQty` DENORMALİZE bir alandır ve tek yazarı bu
// dosyadır. Değeri KAYNAKTAN yeniden hesaplanır (`computeReceivedByItemTx`):
//
//     kaynak = bu siparişe bağlı AKTİF mal kabul fişlerinin
//              · iptal edilmemiş TOPLARI (Σ initialQty)          → kumaş
//              · İPLİK hareketleri (Σ IN − Σ OUT, kg)            → iplik
//
// ⚠️ NEDEN "increment" DEĞİL YENİDEN HESAP (bilinçli sapma, şema yorumundaki
// "increment" ifadesinden): `increment` KAÇIRILAN her olayı kalıcı hataya
// çevirir (topun tekil `softDelete`'i, elle veri düzeltmesi, yarım kalmış fiş
// iptali), yeniden hesap ise bir sonraki çağrıda KENDİNİ ONARIR.
// `YarnStock.balanceKg` ↔ `YarnMovement` ve `Order.shippedQty` ile aynı aile:
// rollup + mutabakat.
//
// ⚠️⚠️ `Roll.purchaseOrderLineId` BU HESABIN KAYNAĞI DEĞİLDİR (J2, 2026-08-15).
// Bu blok bir süre "öyle bir kolon zaten yok" diyordu; kolon ARTIK VAR ve
// gerekçe onunla ÇÜRÜMEZ, GÜÇLENİR: o kolon bir İZDİR, defter değil. Damgayı
// toplayıp `receivedQty` türetmek İKİ ölçülmüş sebeple yanlış olurdu —
//   ① damga miktarı BÖLEMEZ (top fiziksel bir bütündür), `distributeFifo`
//     böler: 50+100'lük kalemlere 30+30+30 gelince rollup "50 / 40" der,
//     damga "iki top L1, bir top L2";
//   ② damga tahsisi eşzamanlı fişlerde YAKLAŞIKTIR (gerekçe + ölçüm:
//     `goods-receipt.service.claimStampLine`), miktar defteri ise bu dosyanın
//     advisory kilidi sayesinde eşzamanlılıkta da DOĞRU kalır.
// Yani hızlandırma isteği doğduğunda çıkış yolu "artık bağ var, increment'e
// geçelim" DEĞİLDİR; kaynaktan yeniden hesap, kilit ve mutabakat aynen kalır.
//
// ⚠️ ATOMİKLİK BUNUNLA KAYBOLMAZ: yeniden hesap "oku → yaz" olduğu için
// kayıp-güncelleme (lost update) riski taşır; o yüzden HER senkron kendi
// transaction'ında ve İLK ifadesi `pg_advisory_xact_lock(8027, hashtext(poId))`
// olacak şekilde koşar. Kilit SORGUDAN ÖNCE alınmak zorunda — sonra alınırsa
// hiçbir şey kazanılmaz (KK1 mükerrer tuzağındaki TOCTOU dersinin aynısı).
//
// ⚠️ EŞLEME ÜRÜN BAZINDA + FIFO: sipariş kalemi ile gelen mal arasındaki tek
// ortak anahtar `itemId`. Aynı ürün bir siparişte BİRDEN FAZLA kalemde
// bulunabilir (farklı termin/fiyat) — o yüzden gelen miktar kalemlere `lineNo`
// sırasıyla FIFO dağıtılır ve ARTAN SON KALEME yazılır. Emsal:
// `distributeSacksToLines` (sevkiyat). Alternatif "aynı ürün iki kez olamaz"
// yasağı, meşru bir ticari kaydı (iki termin) imkânsız kılardı.
//
// ⚠️ FAZLA KABUL ENGELLENMEZ (DB'de CHECK yok, bilinçli): fiziksel olarak fazla
// mal GELEBİLİR ve kayıt gerçeği yazmak zorundadır. Servis İŞARETLER
// (`overReceiptLines`), reddetmez — aksi hâlde depocu gelen malı sisteme HİÇ
// giremez, mal kayıt dışı kalırdı.
//
// ⚠️ `status` TÜRETİLİR, kullanıcı elle işaretlemez: hiç kabul yok → OPEN,
// kısmen → PARTIAL, tüm kalemler karşılandı → CLOSED. `CANCELLED` bunun DIŞINDA
// ayrı bir yoldur ve senkron onu ASLA diriltmez (`where: status not CANCELLED`).
// İKİNCİ istisna SHORT-CLOSE (G2, 2026-08-14): `shortClosedAt` dolu ise durum
// CLOSED'dur ve senkron bunu EZMEZ — "kalanı gelmeyecek" kullanıcı kararıdır,
// türetme ona saygı duyar. Geri alma `reopenShortClose` ile (bayrak temizlenir,
// durum yeniden türetilir).
// =============================================================================
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
  RollStatus,
  YarnMovementKind,
  type Currency,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { yarnMovementSign } from "./helpers/yarn-sign.helper";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { isClientTokenP2002 } from "../utils/p2002";
import { buildTurkishSearch, isEnumMember, readIdCondition } from "../utils/query-parser";
import { PURCHASE_ORDER_STATUS_TR } from "../constants/status-labels";
// C4 — tedarikçi İKİ tabloda olabilir (müşteri-tipli cari XOR fason firma);
// XOR + varlık + aktiflik TEK kapıdan sorulur (mal kabul ile ORTAK).
import {
  hasSupplierPartyInput,
  resolveSupplierParty,
  type ResolvedSupplierParty,
} from "./helpers/supplier-party.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { receiptQtyByRollTx, receiptQtyWarning } from "./helpers/receipt-qty.helper";
import type { ApiResponse } from "../types/api.types";
import { uyari } from "../lib/logger";

/**
 * Alış siparişi senkronunun `pg_advisory_xact_lock` NAMESPACE'i (2 argümanlı form).
 *
 * Uzay envanteri TEK KAYNAK: `helpers/period-guard.helper.ts` başlığı — kopya
 * liste tutulmaz. Bu uzay **8027 alış siparişi karşılanma**dır. Yeni bir alt
 * sistem eklerken ENVANTERE BAK: aynı namespace + aynı hashtext çakışması iki
 * alakasız alt sistemi sessizce serileştirir (hata yok, yalnız yavaşlama).
 *
 * Açıkça `number` tiplenmiş: literal tip çıkarımı, ileride başka bir sabitle
 * karşılaştırma yazıldığında TS2367 ile derlemeyi kırardı (SHIPMENT_LOCK_NS emsali).
 */
export const PURCHASE_ORDER_LOCK_NS: number = 8027;

/** Belge numarası ön eki — AS + GGAAYY + NNNN. */
const PO_PREFIX = "AS";

const ZERO = new Prisma.Decimal(0);
const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

// -----------------------------------------------------------------------------
// Girdi tipleri
// -----------------------------------------------------------------------------

export interface PurchaseOrderLineInput {
  itemId: string;
  qty: Prisma.Decimal.Value;
  unitPrice?: Prisma.Decimal.Value | null;
  notes?: string | null;
}

export interface PurchaseOrderCreateInput {
  /**
   * Müşteri-tipli cari tedarikçi. C4'ten (2026-08-15) beri OPSİYONEL ama
   * `subcontractorId` ile XOR: TAM BİRİ dolu olmak ZORUNDA (sipariş bir
   * taahhüttür; kime verildiği belirsiz kalamaz). Kapı:
   * `helpers/supplier-party.helper`.
   */
  supplierId?: string | null;
  /** Fason firma tedarikçi (C4) — `supplierId` ile XOR. */
  subcontractorId?: string | null;
  currency?: Currency;
  orderDate?: Date;
  expectedDate?: Date | null;
  notes?: string | null;
  clientToken?: string;
  lines: PurchaseOrderLineInput[];
}

export interface PurchaseOrderUpdateInput {
  /**
   * ⚠️ TARAF DEĞİŞİMİ BÜTÜNDÜR: iki anahtardan biri gönderilirse tedarikçi
   * TOPTAN değiştirilir ve DİĞER bacak NULL'lanır (müşteri→fason geçişinde eski
   * kolonun dolu kalması "iki tedarikçili sipariş" demekti). İkisi de
   * gönderilmezse tedarikçiye DOKUNULMAZ.
   */
  supplierId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  orderDate?: Date;
  expectedDate?: Date | null;
  notes?: string | null;
  /** Verilirse kalemler TAMAMEN değiştirilir; verilmezse kalemlere DOKUNULMAZ. */
  lines?: PurchaseOrderLineInput[];
}

export interface PurchaseOrderSyncLine {
  id: string;
  lineNo: number;
  itemId: string;
  qty: Prisma.Decimal;
  receivedQty: Prisma.Decimal;
  /** Sipariş edilenden FAZLA geldi — engellenmez, işaretlenir. */
  over: boolean;
}

export interface PurchaseOrderSyncResult {
  id: string;
  orderNo: string;
  status: PurchaseOrderStatus;
  /** Senkron gerçekten bir şey değiştirdi mi (idempotent tekrarda `false`). */
  changed: boolean;
  /** Ufuk-öncesi fiş topu: kabul metrajı defterden değil yedekten okundu (hüküm §10.6). */
  warnings?: string[];
  lines: PurchaseOrderSyncLine[];
  /** Fazla kabul edilen kalemlerin `lineNo`'ları — çağıran bunu mesaja basar. */
  overReceiptLines: number[];
  /**
   * Fişte gelen ama SİPARİŞTE HİÇ OLMAYAN ürünler.
   *
   * ⚠️ Bunlar karşılanmaya yazılamaz (yazılacak kalem yok) ve sessizce
   * düşürülmeleri gerçek bir saha hatasını gizlerdi: depocu açılır listeden
   * YANLIŞ siparişi seçmiştir. Mal zaten depoya girmiştir (kayıt doğru), yanlış
   * olan yalnız BAĞDIR — o yüzden reddetmek değil SÖYLEMEK doğru cevaptır.
   */
  unmatchedItemIds: string[];
}

// -----------------------------------------------------------------------------
// Belge numarası
// -----------------------------------------------------------------------------

/**
 * `AS + GGAAYY + NNNN`. Sıra JS'te SAYISAL max ile çözülür (`orderBy` ile değil:
 * glibc collation lexicographic'tir ve 9→10 geçişinde bozulur — order.service'in
 * kanıtlı deseni). Yarış hâlâ mümkündür ve doğru cevap TEKRAR DENEMEKTİR:
 * çağıran `withBarcodeRetry` ile sarmalar, sıra okuması tx İÇİNDEDİR.
 */
async function nextPurchaseOrderNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const full = dailyCodePrefix(PO_PREFIX, date);
  const rows = await tx.purchaseOrder.findMany({
    where: { orderNo: { gte: full, startsWith: full } },
    select: { orderNo: true },
  });
  return buildDailyCode(PO_PREFIX, nextDailySeq(rows.map((r) => r.orderNo), full), date);
}

// -----------------------------------------------------------------------------
// KARŞILANMA — kaynaktan hesap
// -----------------------------------------------------------------------------

/**
 * Bu siparişe bağlı AKTİF fişlerden ürün başına gelen miktar.
 *
 * ⚠️ İKİ KAYNAK, TEK CEVAP: kumaş `Roll` satırlarından (metre), iplik
 * `YarnMovement` satırlarından (kg) gelir. Yalnız birine bakmak, ipliği de
 * satan bir kurulumda siparişin YARISINI sessizce "hiç gelmedi" gösterirdi.
 *
 * ⚠️ TOPTA KABUL-ANI METRAJI KULLANILIR (`receiptQtyByRollTx`, depo defteri
 * ENTRY satırı), `currentQty` DEĞİL: sipariş KABUL ANINI ölçer. Top sonradan
 * kesilir/sevk edilirse tedarikçiye ısmarladığımız miktar değişmez (alış
 * faturasıyla aynı kaynak, hüküm §10.6). Topun giriş metrajı kolonu da olmaz:
 * tambur geri alması onu aşımda yukarı çeker ve karşılama şişerdi.
 *
 * ⚠️ İPTAL FİŞ KAYNAKTAN DÜŞER (`status: ACTIVE` süzgeci) — iptal "bu mal hiç
 * gelmedi" demektir; saymak, gelmemiş malı gelmiş göstermek olurdu.
 *
 * ⚠️ İPLİKTE NET (IN − OUT) alınır: D1 tarafı bir fiş iptalinde ters kayıt
 * (OUT) yazarsa doğru sonuç kendiliğinden çıkar; yazmazsa fişin ACTIVE'likten
 * düşmesi zaten toplamı sıfırlar. İki savunma da aynı yöne bakar. Net negatife
 * düşerse 0'a kırpılır — "eksi gelmiş mal" anlamsızdır ve kalanı sipariş
 * miktarının ÜSTÜNE çıkarırdı.
 */
async function computeReceivedByItemTx(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<{ byItem: Map<string, Prisma.Decimal>; warning: string | null }> {
  const out = new Map<string, Prisma.Decimal>();

  const receipts = await tx.goodsReceipt.findMany({
    where: { purchaseOrderId, status: GoodsReceiptStatus.ACTIVE },
    select: { id: true },
  });
  const receiptIds = receipts.map((r) => r.id);
  if (receiptIds.length === 0) return { byItem: out, warning: null };

  const add = (itemId: string, delta: Prisma.Decimal): void => {
    out.set(itemId, (out.get(itemId) ?? ZERO).plus(delta));
  };

  const rolls = await tx.roll.findMany({
    where: { goodsReceiptId: { in: receiptIds }, status: { not: RollStatus.CANCELLED } },
    select: { id: true, itemId: true },
  });
  const receiptQty = await receiptQtyByRollTx(tx, rolls.map((r) => r.id));
  for (const r of rolls) add(r.itemId, receiptQty.get(r.id)?.qty ?? ZERO);

  const yarnRows = await tx.yarnMovement.groupBy({
    by: ["itemId", "kind"],
    where: { goodsReceiptId: { in: receiptIds } },
    _sum: { qtyKg: true },
  });
  for (const row of yarnRows) {
    const qty = row._sum.qtyKg ?? ZERO;
    // İşaret TEK KAYNAKTAN (`yarnMovementSign`) — elle ikili ayrım devere türlerinde kırılırdı (§4.9-2).
    const inbound = yarnMovementSign(row.kind) > 0;
    add(row.itemId, inbound ? qty : qty.negated());
  }

  for (const [itemId, value] of out) if (value.lt(0)) out.set(itemId, ZERO);
  // Ufuk-öncesi fiş topu: kabul metrajı yedekten okundu — beyan yukarı taşınır.
  return { byItem: out, warning: receiptQtyWarning(receiptQty) };
}

interface LineRow {
  id: string;
  lineNo: number;
  itemId: string;
  qty: Prisma.Decimal;
  receivedQty: Prisma.Decimal;
}

/**
 * Ürün bazındaki toplamı kalemlere FIFO dağıtır (kalemler `lineNo` sırasında).
 *
 * ⚠️ ARTAN SON KALEME YAZILIR: 100 ısmarlanıp 130 gelirse son kalem 30 fazla
 * görünür ve `over` işaretiyle söylenir. Fazlayı "kimseye yazmamak" onu
 * kaydın dışına atmak, ilk kaleme yazmak ise erken termini yanlış kapatmak
 * olurdu.
 */
function distributeFifo(lines: LineRow[], receivedByItem: Map<string, Prisma.Decimal>): Map<string, Prisma.Decimal> {
  const result = new Map<string, Prisma.Decimal>();
  const byItem = new Map<string, LineRow[]>();
  for (const line of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const bucket = byItem.get(line.itemId);
    if (bucket) bucket.push(line);
    else byItem.set(line.itemId, [line]);
  }

  for (const [itemId, bucket] of byItem) {
    let remaining = receivedByItem.get(itemId) ?? ZERO;
    bucket.forEach((line, idx) => {
      const isLast = idx === bucket.length - 1;
      const take = isLast ? remaining : remaining.lte(line.qty) ? remaining : line.qty;
      result.set(line.id, take);
      remaining = remaining.minus(take);
      if (remaining.lt(0)) remaining = ZERO;
    });
  }

  // Ürünü hiç gelmemiş kalemler de açıkça 0 yazar (eksik anahtar ≠ sıfır).
  for (const line of lines) if (!result.has(line.id)) result.set(line.id, ZERO);
  return result;
}

/** Kalem karşılanmalarından sipariş durumunu TÜRETİR. */
function deriveStatus(lines: Array<{ qty: Prisma.Decimal; receivedQty: Prisma.Decimal }>): PurchaseOrderStatus {
  const total = lines.reduce<Prisma.Decimal>((s, l) => s.plus(l.receivedQty), ZERO);
  if (total.lte(0)) return PurchaseOrderStatus.OPEN;
  return lines.every((l) => l.receivedQty.gte(l.qty)) ? PurchaseOrderStatus.CLOSED : PurchaseOrderStatus.PARTIAL;
}

/**
 * Karşılanmayı + durumu kaynaktan yeniden yazar. ÇAĞIRAN KENDİ KİLİDİNİ ALIR
 * (bkz. `syncPurchaseOrder`) — bu fonksiyon kilitsiz çağrılırsa iki eşzamanlı
 * mal kabulü birbirinin sonucunu ezebilir.
 */
export async function syncPurchaseOrderTx(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<PurchaseOrderSyncResult | null> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      shortClosedAt: true,
      lines: { select: { id: true, lineNo: true, itemId: true, qty: true, receivedQty: true } },
    },
  });
  if (!po) return null;

  const toResult = (
    lines: LineRow[],
    status: PurchaseOrderStatus,
    changed: boolean,
    extra: { unmatchedItemIds?: string[]; warning?: string | null } = {},
  ): PurchaseOrderSyncResult => {
    const mapped = lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({ ...l, over: l.receivedQty.gt(l.qty) }));
    return {
      id: po.id,
      orderNo: po.orderNo,
      status,
      changed,
      lines: mapped,
      overReceiptLines: mapped.filter((l) => l.over).map((l) => l.lineNo),
      unmatchedItemIds: extra.unmatchedItemIds ?? [],
      ...(extra.warning ? { warnings: [extra.warning] } : {}),
    };
  };

  // İptal edilmiş sipariş DİRİLTİLMEZ: senkron bir durum makinesi değil, bir
  // ROLLUP'tır; iptal ise ayrı bir karardır.
  if (po.status === PurchaseOrderStatus.CANCELLED) return toResult(po.lines, po.status, false);

  const received = await computeReceivedByItemTx(tx, purchaseOrderId);
  const receivedByItem = received.byItem;
  const orderedItemIds = new Set(po.lines.map((l) => l.itemId));
  const unmatchedItemIds = [...receivedByItem.keys()].filter((itemId) => !orderedItemIds.has(itemId));
  const distributed = distributeFifo(po.lines, receivedByItem);

  const nextLines: LineRow[] = po.lines.map((l) => ({ ...l, receivedQty: distributed.get(l.id) ?? ZERO }));
  // ⚠️ SHORT-CLOSE SENKRON TARAFINDAN EZİLMEZ — özelliğin asıl işi bu satır
  // (G2, 2026-08-14). `shortClosedAt` dolu = "kalanı gelmeyecek" KULLANICI
  // kararıdır; türetme onu her senkronda geri PARTIAL yapsaydı bayrak anlamsız
  // olurdu (short-close'un bugüne kadar YAZILAMAMASININ sebebi tam buydu).
  // Karşılanma (`receivedQty`) yine kaynaktan yazılır — rakam gerçeği söylemeye
  // devam eder, yalnız DURUM kararı kullanıcının kararına saygı duyar.
  // Bayrağı temizleyen tek yol `reopenShortClose`tur (durum orada yeniden
  // türetilir). Bekçi: test_purchase_order.ts §R (negatif sondalı).
  const nextStatus = po.shortClosedAt ? PurchaseOrderStatus.CLOSED : deriveStatus(nextLines);

  let changed = false;
  for (const line of nextLines) {
    const previous = po.lines.find((l) => l.id === line.id);
    if (previous && previous.receivedQty.equals(line.receivedQty)) continue;
    changed = true;
    // ⚠️ Sıralı — `tx` ile `Promise.all` YASAK (pg adapter tek bağlantı).
    await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty } });
  }

  if (nextStatus !== po.status) {
    // Atomik + fail-safe: iptal edilmiş siparişi hiçbir koşulda geri açmaz.
    const claimed = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, status: { not: PurchaseOrderStatus.CANCELLED } },
      data: { status: nextStatus },
    });
    if (claimed.count > 0) changed = true;
  }

  return toResult(nextLines, nextStatus, changed, { unmatchedItemIds, warning: received.warning });
}

/**
 * Senkronun DIŞARIYA açık hâli — kendi transaction'ını ve advisory kilidini alır.
 * Mal kabul yolları (`goods-receipt.service`) bunu çağırır.
 */
export async function syncPurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderSyncResult | null> {
  return prisma.$transaction(async (tx) => {
    // ⚠️ SIRA LOAD-BEARING: kilit HER SORGUDAN ÖNCE. Sonra alınırsa "oku → yaz"
    // penceresi açık kalır ve iki eşzamanlı mal kabulü aynı kalemi ezer.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${purchaseOrderId}))`;
    return syncPurchaseOrderTx(tx, purchaseOrderId);
  });
}

/**
 * Mal kabul yolundan çağrılan güvenli sarmalayıcı: sipariş bağı yoksa hiçbir şey
 * yapmaz, senkron hatası mal kabulü DÜŞÜRMEZ.
 *
 * ⚠️ Neden yutuluyor: mal fiziksel olarak depoya girdi ve topları yazıldı.
 * Karşılanma rakamını güncelleyememek, girişin tamamını geri almaktan çok daha
 * hafif bir arızadır — üstelik rollup olduğu için bir sonraki senkron kendini
 * onarır. Aynı gerekçe `AuditService.log`'un best-effort olmasının da gerekçesi.
 */
export async function syncPurchaseOrderSafely(
  purchaseOrderId: string | null | undefined,
): Promise<PurchaseOrderSyncResult | null> {
  if (!purchaseOrderId) return null;
  try {
    return await syncPurchaseOrder(purchaseOrderId);
  } catch (e) {
    uyari("purchase-order", `senkron başarısız (${purchaseOrderId}):`, (e as Error).message);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Servis
// -----------------------------------------------------------------------------

const LIST_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  currency: true,
  orderDate: true,
  expectedDate: true,
  notes: true,
  cancelledAt: true,
  // Liste rozetinin tek kaynağı: CLOSED + shortClosedAt = "kalanı gelmeyecek
  // olarak kapatıldı" ≠ "tüm kalemler karşılandı". Alan taşınmazsa liste,
  // short-close'u "Tamamlandı" diye YANLIŞ anlatır.
  shortClosedAt: true,
  createdAt: true,
  supplier: { select: { id: true, code: true, name: true } },
  // C4 — fason tedarikçi bacağı; `supplier` ile AYNI şekil. Panel tek
  // "tedarikçi" kolonunda dolu olanı basar (mal kabul listesiyle simetrik).
  subcontractorSupplier: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true, goodsReceipts: true } },
} as const;

/**
 * AYNI TOKEN, FARKLI GÖVDE → 409 (2026-09-01). Gerekçe:
 * `cash-transaction.service.ts` → `assertCashTxnReplay` başlığı.
 * ⚠️ `currency`/`orderDate` varsayılan alır → kıyaslamaya GİRMEZ.
 */
const PO_REPLAY_SELECT = {
  id: true,
  orderNo: true,
  supplierId: true,
  subcontractorId: true,
  lines: { select: { itemId: true, qty: true, unitPrice: true }, orderBy: { lineNo: "asc" } },
} as const;

/** Satır izi — Decimal/sayı/metin karışımı TEK biçime indirgenir. */
function poSatirIzi(
  satirlar: ReadonlyArray<{ itemId: string; qty: Prisma.Decimal.Value; unitPrice?: Prisma.Decimal.Value | null }>,
): string {
  return satirlar
    .map(
      (l) =>
        `${l.itemId}|${new Prisma.Decimal(l.qty).toFixed(4)}|${l.unitPrice == null ? "-" : new Prisma.Decimal(l.unitPrice).toFixed(4)}`,
    )
    .join("¬");
}

function assertPoReplay(
  existing: {
    id: string;
    supplierId: string | null;
    subcontractorId: string | null;
    lines: Array<{ itemId: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal | null }>;
  },
  input: PurchaseOrderCreateInput,
): void {
  assertReplayPayloadMatches(
    [
      { ad: "supplierId", mevcut: existing.supplierId, gelen: input.supplierId },
      { ad: "subcontractorId", mevcut: existing.subcontractorId, gelen: input.subcontractorId },
      { ad: "satırlar", mevcut: poSatirIzi(existing.lines), gelen: poSatirIzi(input.lines) },
    ],
    "Bu istemci anahtarı FARKLI bir alış siparişi için kullanılmış. Ekranı yenileyip tekrar deneyin.",
    { purchaseOrderId: existing.id },
  );
}

/** Liste ucunun okuduğu süzgeç adları — çıplak (`?status=`) gelirse 400 (`assertNoBareFilterParams`); okuyucu + kapı aynı liste. */
export const PURCHASE_ORDER_FILTER_NAMES = ["status", "supplierId", "subcontractorId"] as const;

export class PurchaseOrderService {
  // ---------------------------------------------------------------------------
  // Doğrulamalar
  // ---------------------------------------------------------------------------

  /**
   * Tedarikçi tarafı: XOR + kart var + aktif mi.
   *
   * ⚠️ C4'ten (2026-08-15) beri İKİ BACAK var (müşteri-tipli cari XOR fason
   * firma) ve kural mal kabulle ORTAK bir kapıda yaşıyor — iki servis aynı
   * soruya farklı cümlelerle cevap veremesin (`supplier-party.helper`).
   *
   * ⚠️ `CompanyType` KONTROL EDİLMEZ ve bu bilinçli: şemanın kendi notu tipin
   * "bir ETİKET, duvar DEĞİL" olduğunu söylüyor ve kardeş akış `GoodsReceipt`
   * de tipe bakmıyor. Burada zorlamak, siparişi reddedip aynı firmadan mal
   * kabulünü kabul eden tutarsız bir çift üretirdi — yani guard yanlış yerde
   * dururdu.
   */
  private async assertSupplierParty(
    input: { supplierId?: string | null; subcontractorId?: string | null },
  ): Promise<ResolvedSupplierParty> {
    // `required: true` — sipariş bir TAAHHÜTTÜR; tedarikçisiz açılamaz. (Mal
    // kabulde aynı kapı `required: false` ile çağrılır: mal önce girer.)
    return resolveSupplierParty(input, { required: true });
  }

  /** Kalem ürünleri var + aktif mi; miktar pozitif mi. Tek sorguda toplu kontrol. */
  private async assertLines(lines: PurchaseOrderLineInput[]): Promise<void> {
    if (lines.length === 0) throw AppError.badRequest("Alış siparişi en az bir kalem içermeli.");

    for (const [idx, line] of lines.entries()) {
      if (D(line.qty).lte(0)) throw AppError.badRequest(`${idx + 1}. kalem: miktar sıfırdan büyük olmalı.`);
      if (line.unitPrice != null && D(line.unitPrice).lt(0)) {
        throw AppError.badRequest(`${idx + 1}. kalem: birim fiyat negatif olamaz.`);
      }
    }

    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) throw AppError.badRequest("Sipariş kalemindeki ürün bulunamadı.");
      if (!item.isActive) throw AppError.badRequest(`"${item.name}" pasif durumda — siparişe eklenemez.`);
    }
  }

  // ---------------------------------------------------------------------------
  // AÇ
  // ---------------------------------------------------------------------------

  /**
   * Alış siparişi açar.
   *
   * ⚠️ `clientToken` İDEMPOTENCY: aynı token ile ikinci POST MEVCUT siparişi
   * döner, ikincisini AÇMAZ. Zaman aşımı "yazılmadı" demek DEĞİLDİR — tekrar
   * denemenin ikinci bir belge numarası sarf etmesi, satın almacıya aynı malı
   * iki kez ısmarladığını düşündürürdü.
   *
   * ⚠️ ÖN KONTROL TEK BAŞINA YETMEZ (check-then-act): iki tekrar AYNI ANDA
   * gelirse ikisi de "token yok" görür, ikisi de INSERT eder ve biri `clientToken`
   * unique'ine çarpar. Bu P2002 **RETRY EDİLMEZ** — `withBarcodeRetry` her
   * denemede AYNI token'ı yazacağı için beş tur boşa döner ve kullanıcı
   * *"Barkod üretimi 5 denemede başarısız oldu"* diye, gerçek sebebi hiçbir
   * yerde yazmayan bir 409 alırdı (kuralın kaynağı: `utils/p2002.ts`). Doğru
   * cevap, çarpan tarafın ilk siparişi cached yanıt olarak dönmesidir.
   */
  async create(input: PurchaseOrderCreateInput, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const party = await this.assertSupplierParty(input);
    await this.assertLines(input.lines);

    if (input.clientToken) {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { clientToken: input.clientToken },
        select: PO_REPLAY_SELECT,
      });
      if (existing) {
        assertPoReplay(existing, input);
        return {
          success: true,
          data: await this.getById(existing.id),
          message: `Bu sipariş zaten açılmış (${existing.orderNo}).`,
        };
      }
    }

    const orderDate = input.orderDate ?? new Date();

    let created: { id: string; orderNo: string };
    try {
      created = await withBarcodeRetry(
        () =>
          prisma.$transaction(async (tx) => {
            const orderNo = await nextPurchaseOrderNo(tx, orderDate);
            return tx.purchaseOrder.create({
              data: {
                orderNo,
                supplierId: party.supplierId,
                subcontractorId: party.subcontractorId,
                currency: input.currency ?? "TRY",
                status: PurchaseOrderStatus.OPEN,
                orderDate,
                expectedDate: input.expectedDate ?? null,
                notes: input.notes?.trim() || null,
                clientToken: input.clientToken ?? null,
                createdById: userId ?? null,
                lines: {
                  create: input.lines.map((l, i) => ({
                    lineNo: i + 1,
                    itemId: l.itemId,
                    qty: D(l.qty),
                    unitPrice: l.unitPrice != null ? D(l.unitPrice) : null,
                    notes: l.notes?.trim() || null,
                  })),
                },
              },
              select: { id: true, orderNo: true },
            });
          }),
        undefined,
        // Belge numarası yarışı (P2002 `orderNo`) RETRY EDİLİR — bir sonraki tur
        // taze sırayı okur. `clientToken` P2002'si retry EDİLMEZ ve aşağıdaki
        // catch onu cached yanıta çevirir.
        (err) => !isClientTokenP2002(err),
      );
    } catch (err) {
      // Catch tx DIŞINDA — PG'nin "aborted transaction" tuzağına girilmez
      // (`inventory.service` açık-kumaş emsali).
      if (input.clientToken && isClientTokenP2002(err)) {
        const existing = await prisma.purchaseOrder.findUnique({
          where: { clientToken: input.clientToken },
          select: PO_REPLAY_SELECT,
        });
        if (existing) {
          // Ön kontrolle AYNI kapı: yarışı kaybeden istek de farklı gövdeyse 409 alır.
          assertPoReplay(existing, input);
          return {
            success: true,
            data: await this.getById(existing.id),
            message: `Bu sipariş zaten açılmış (${existing.orderNo}).`,
          };
        }
      }
      throw err;
    }

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PURCHASE_ORDER",
      recordId: created.id,
      newData: {
        orderNo: created.orderNo,
        supplierId: party.supplierId,
        subcontractorId: party.subcontractorId,
        lineCount: input.lines.length,
      },
    });

    return {
      success: true,
      data: await this.getById(created.id),
      message: `${created.orderNo} oluşturuldu (${input.lines.length} kalem).`,
    };
  }

  // ---------------------------------------------------------------------------
  // DÜZENLE
  // ---------------------------------------------------------------------------

  /**
   * Yalnız `OPEN` sipariş düzenlenir.
   *
   * ⚠️ NEDEN SADECE OPEN: kabul başladıktan sonra kalem eklemek/çıkarmak,
   * karşılanmanın FIFO dağıtımını geriye dönük değiştirir — dün "tamamlandı"
   * yazan kalem bugün "eksik" olur ve kimse sebebini söyleyemez. Sektör pratiği
   * de aynı: mal görmüş sipariş revize edilmez, yenisi açılır.
   *
   * ⚠️ ATOMİK CLAIM: `updateMany WHERE {id, status: OPEN}` + `count === 0` → 409.
   * `findUnique → if → update` deseninde eşzamanlı bir mal kabulü siparişi
   * PARTIAL yaparken düzenleme sessizce geçerdi.
   *
   * ⚠️ ADVISORY KİLİT — senkron ile AYNI kilit, tx'in İLK ifadesi. Kalem
   * REPLACE'i (`deleteMany` + `create`) ile karşılanma senkronu aynı satırlara
   * dokunuyor: kilitsiz koşarlarsa senkron sildiğimiz kalem id'sini okuyup
   * güncellemeye çalışır (P2025), `syncPurchaseOrderSafely` onu YUTAR ve
   * karşılanma hiç yazılmaz — hata yok, log yok, yalnız eksik rakam. Sıra her
   * yazma yolunda AYNI (önce advisory, sonra satır kilitleri) → deadlock yok.
   *
   * ⚠️ DÜZENLEMEDEN SONRA SENKRON KOŞAR (yalnız kalemler değiştiyse): eşleme
   * ÜRÜN bazında yapıldığı için kalem kümesini değiştirmek karşılanmanın
   * kaynağını da değiştirir. Tipik saha vakası ölçüldü: fiş siparişte OLMAYAN
   * bir ürün taşıyordu (`unmatchedItemIds` uyarısı verdi), satın almacı eksik
   * kalemi ekledi — senkron koşmadığı için mal FİZİKSEL OLARAK DEPODAYKEN
   * kalem "hiç gelmedi" (0) kaldı ve sipariş OPEN'da dondu. Rakam ancak bir
   * sonraki kabul olayında kendini onarıyordu.
   */
  async update(id: string, input: PurchaseOrderUpdateInput, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    // ⚠️ C4 — TARAF GÖNDERİLDİYSE BÜTÜN OLARAK ÇÖZÜLÜR. Eski kod yalnız
    // `input.supplierId` doluysa yazıyordu; iki bacaklı dünyada bu, müşteri→
    // fason geçişinde ESKİ kolonu dolu bırakır ve şemada XOR'u koruyan tek
    // mekanizmayı (servis kapısı) sessizce delerdi. Anahtarlardan hiçbiri
    // gönderilmezse tedarikçiye dokunulmaz (`hasSupplierPartyInput`).
    const partyTouched = hasSupplierPartyInput(input);
    const party = partyTouched ? await this.assertSupplierParty(input) : null;
    if (input.lines) await this.assertLines(input.lines);

    const before = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, orderNo: true, status: true, lines: { select: { receivedQty: true } } },
    });
    if (!before) throw AppError.notFound("Alış siparişi bulunamadı.");
    if (before.status !== PurchaseOrderStatus.OPEN) {
      throw AppError.conflict(
        `${before.orderNo} artık düzenlenemez (durum: ${PURCHASE_ORDER_STATUS_TR[before.status]}). Mal görmüş sipariş revize edilmez; yeni sipariş açın.`,
      );
    }
    // İkinci hat: durum OPEN görünüp karşılanma taşıyorsa (drift) yine reddet.
    if (before.lines.some((l) => l.receivedQty.gt(0))) {
      throw AppError.conflict(`${before.orderNo} üzerine mal kabul edilmiş — düzenlenemez.`);
    }

    await prisma.$transaction(async (tx) => {
      // ⚠️ SIRA LOAD-BEARING: kilit HER SORGUDAN ÖNCE (senkron/iptal ile aynı).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${id}))`;

      // Kilit altında TAZE kontrol: dış okuma kilitten önce yapıldığı için
      // yalnız mesajı üretir; kararı bu satır verir.
      // ⚠️ BU SATIRA BEKÇİ ERİŞEMEZ — tek iş parçacıklı testte dıştaki kontrol
      // her zaman önce reddeder (körleştirilse bile paket yeşil kalır). Burası
      // derinlik savunmasıdır; silmeden önce yerine ne koyduğunu bil
      // (`completeUnassignedFromTambur` tx-içi tazelemesiyle aynı sınıf).
      const fresh = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id, receivedQty: { gt: 0 } } });
      if (fresh > 0) throw AppError.conflict(`${before.orderNo} üzerine mal kabul edilmiş — düzenlenemez.`);

      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: PurchaseOrderStatus.OPEN },
        data: {
          // İki kolon BİRLİKTE yazılır (biri mutlaka NULL) — yarım taraf yok.
          ...(party ? { supplierId: party.supplierId, subcontractorId: party.subcontractorId } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.orderDate ? { orderDate: input.orderDate } : {}),
          ...(input.expectedDate !== undefined ? { expectedDate: input.expectedDate } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        },
      });
      if (claimed.count === 0) {
        throw AppError.conflict("Sipariş bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");
      }

      if (input.lines) {
        // Kalemler REPLACE edilir: `lineNo` yeniden numaralanır ki FIFO dağıtımı
        // ile ekrandaki sıra aynı şeyi söylesin.
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        for (const [i, l] of input.lines.entries()) {
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: id,
              lineNo: i + 1,
              itemId: l.itemId,
              qty: D(l.qty),
              unitPrice: l.unitPrice != null ? D(l.unitPrice) : null,
              notes: l.notes?.trim() || null,
            },
          });
        }
      }
    });

    // Kalem kümesi değiştiyse karşılanmayı kaynaktan yeniden çöz (yukarıdaki
    // gerekçe). Kalemler değişmediyse TEK SORGU BİLE koşmaz.
    if (input.lines) await syncPurchaseOrderSafely(id);

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PURCHASE_ORDER",
      recordId: id,
      newData: { orderNo: before.orderNo, lineCount: input.lines?.length ?? null },
    });

    return { success: true, data: await this.getById(id), message: `${before.orderNo} güncellendi.` };
  }

  // ---------------------------------------------------------------------------
  // İPTAL
  // ---------------------------------------------------------------------------

  /**
   * Siparişi iptal eder.
   *
   * ⚠️ KABUL GÖRMÜŞ SİPARİŞ İPTAL EDİLEMEZ (kullanıcı kararı gerekçesi):
   * siparişe bağlı AKTİF bir mal kabul fişi varsa iptal reddedilir. Sebep,
   * "mal gelmişti" bilgisinin sessizce kaybolmasıdır — fiş `purchaseOrderId`
   * ile iptal edilmiş bir siparişi işaret eder, "ne ısmarladım ne geldi"
   * raporu o miktarı hiçbir yerde göstermez ve alış faturası mutabakatı
   * dayanaksız kalır. Doğru sıra: önce fişi iptal et, sonra siparişi.
   *
   * ⚠️ "Kalanı gelmeyecek, kapat" (short-close) BU YOL DEĞİLDİR — o iş
   * `shortClose()`tadır (G2, 2026-08-14). AYRIM SEKTÖREL: iptal "bu sipariş
   * hiç olmadı" der ve kabul görmüş siparişte REDDEDİLİR; short-close "olan
   * KALIR, kalanı gelmeyecek" der — gelen malın kaydı ve karşılanması durur,
   * yalnız beklenti kapanır.
   *
   * ⚠️ Advisory kilit, mal kabul tarafındaki bağlama ile bu iptali serileştirir
   * (`goods-receipt.service` fişi bağlarken aynı kilidi alır) — aksi hâlde
   * "kontrol ettim, boştu" ile "iptal ettim" arasına bir fiş sızabilirdi.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${id})) `;

      const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, orderNo: true, status: true } });
      if (!po) throw AppError.notFound("Alış siparişi bulunamadı.");
      if (po.status === PurchaseOrderStatus.CANCELLED) {
        return { id, orderNo: po.orderNo, alreadyCancelled: true };
      }

      const receipts = await tx.goodsReceipt.findMany({
        where: { purchaseOrderId: id, status: GoodsReceiptStatus.ACTIVE },
        select: { receiptNo: true },
        take: 6,
      });
      if (receipts.length > 0) {
        const sample = receipts.slice(0, 5).map((r) => r.receiptNo).join(", ");
        throw AppError.conflict(
          `${po.orderNo} üzerine mal kabul edilmiş (${sample}${receipts.length > 5 ? "…" : ""}) — sipariş iptal edilemez. ` +
            `Önce ilgili mal kabul fişlerini iptal edin.`,
        );
      }

      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: { not: PurchaseOrderStatus.CANCELLED } },
        data: {
          status: PurchaseOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claimed.count === 0) throw AppError.conflict("Sipariş bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");

      return { id, orderNo: po.orderNo, alreadyCancelled: false };
    });

    if (!result.alreadyCancelled) {
      void AuditService.log({
        userId,
        action: "DELETE",
        tableName: "PURCHASE_ORDER",
        recordId: id,
        newData: { kind: "CANCEL", orderNo: result.orderNo, reason: reason ?? null },
      });
    }

    return {
      success: true,
      data: await this.getById(id),
      message: result.alreadyCancelled ? `${result.orderNo} zaten iptal edilmiş.` : `${result.orderNo} iptal edildi.`,
    };
  }

  // ---------------------------------------------------------------------------
  // SHORT-CLOSE — "kalanı gelmeyecek, olan KALIR" (G2, 2026-08-14)
  // ---------------------------------------------------------------------------

  /**
   * Siparişi short-close eder: kalan miktarlar GELMEYECEK olarak işaretlenir,
   * durum `CLOSED`a çekilir ve senkron bunu bir daha EZMEZ (`shortClosedAt`
   * bayrağına `syncPurchaseOrderTx` saygı duyar).
   *
   * ⚠️ İPTALDEN FARKI: iptal "bu sipariş HİÇ OLMADI" der ve kabul görmüş
   * siparişte reddedilir; short-close "olan KALIR, kalanı gelmeyecek" der —
   * gelen malın kaydı, karşılanma rakamı ve fiş bağları aynen durur. SAP
   * karşılığı teslimat kaleminin "delivery completed" işareti; sevk tarafındaki
   * storno ↔ iade ayrımının alış ikizi.
   *
   * ⚠️ SEBEP ZORUNLU (iptalde opsiyonel, burada değil): "kalan neden
   * gelmeyecek" sorusunun cevabı tedarikçi performans değerlendirmesinin ta
   * kendisidir ve kaydın KENDİ satırına yazılır (`SystemLog` 6 ayda arşivlenir
   * — `Roll.entryReason` dersi). 3 karakterden kısa doldurma reddedilir.
   *
   * ⚠️ ATOMİK CLAIM + advisory kilit: claim `status IN (OPEN, PARTIAL)` +
   * `shortClosedAt: null` arar; kilit senkronla AYNI (8027) ve tx'in İLK
   * ifadesi — eşzamanlı bir mal kabulünün senkronu ile bu karar serileşir
   * (Sınıf 4'ün iki yazarı: senkron bayrağı OKUR, burası durumu koşullu YAZAR).
   *
   * ⚠️ count=0 TANISI TX İÇİNDE TAZE OKUMAYLA (Sınıf 4 eki ①): kaybeden tarafa
   * "tavan/durum" YALANI değil gerçek sebep söylenir. Zaten short-closed →
   * idempotent başarı (zaman aşımı tekrarı 409 yememeli); CLOSED (tam
   * karşılanmış) → 409 "kapatılacak kalan yok"; CANCELLED → 409.
   */
  async shortClose(id: string, reason: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) {
      throw AppError.badRequest("Kapatma sebebi zorunlu (en az 3 karakter) — kalan neden gelmeyecek?");
    }

    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ SIRA LOAD-BEARING: kilit HER SORGUDAN ÖNCE (senkron/iptal ile aynı).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${id}))`;

      const claimed = await tx.purchaseOrder.updateMany({
        where: {
          id,
          status: { in: [PurchaseOrderStatus.OPEN, PurchaseOrderStatus.PARTIAL] },
          shortClosedAt: null,
        },
        data: {
          status: PurchaseOrderStatus.CLOSED,
          shortClosedAt: new Date(),
          shortClosedById: userId ?? null,
          shortCloseReason: trimmed,
        },
      });

      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        select: {
          orderNo: true,
          status: true,
          shortClosedAt: true,
          lines: { select: { lineNo: true, qty: true, receivedQty: true } },
        },
      });
      if (!po) throw AppError.notFound("Alış siparişi bulunamadı.");

      if (claimed.count === 0) {
        if (po.shortClosedAt) return { orderNo: po.orderNo, already: true, openLineCount: 0 };
        if (po.status === PurchaseOrderStatus.CANCELLED) {
          throw AppError.conflict(`${po.orderNo} iptal edilmiş — kapatılacak bir taahhüt yok.`);
        }
        // CLOSED (tam karşılanmış): kalan yok, işaret anlamsız olurdu.
        throw AppError.conflict(`${po.orderNo} zaten tüm kalemleriyle karşılanmış — kapatılacak kalan yok.`);
      }

      const openLines = po.lines.filter((l) => l.receivedQty.lt(l.qty));
      return { orderNo: po.orderNo, already: false, openLineCount: openLines.length };
    });

    if (!result.already) {
      void AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "PURCHASE_ORDER",
        recordId: id,
        newData: { kind: "SHORT_CLOSE", orderNo: result.orderNo, reason: trimmed, openLineCount: result.openLineCount },
      });
    }

    return {
      success: true,
      data: await this.getById(id),
      message: result.already
        ? `${result.orderNo} zaten kapatılmış (kalanı gelmeyecek).`
        : `${result.orderNo} kapatıldı — ${result.openLineCount} açık kalem "gelmeyecek" olarak işaretlendi. Gelen malın kaydı DURUYOR.`,
    };
  }

  /**
   * Short-close'u geri alır: bayrak temizlenir ve durum AYNI TX İÇİNDE
   * kaynaktan yeniden türetilir (`syncPurchaseOrderTx` — advisory kilit zaten
   * elimizde, fonksiyonun "çağıran kendi kilidini alır" sözleşmesi sağlanıyor).
   * Bayrağı temizleyip senkronu sonraya bırakmak, arada kalan pencerede
   * "bayraksız ama CLOSED" yarım durum sergilerdi.
   */
  async reopenShortClose(id: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${id}))`;

      const claimed = await tx.purchaseOrder.updateMany({
        // CANCELLED dışlanır: iptal ayrı bir yoldur, buradan diriltilmez.
        where: { id, shortClosedAt: { not: null }, status: { not: PurchaseOrderStatus.CANCELLED } },
        data: { shortClosedAt: null, shortClosedById: null, shortCloseReason: null },
      });

      if (claimed.count === 0) {
        const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { orderNo: true, status: true, shortClosedAt: true } });
        if (!po) throw AppError.notFound("Alış siparişi bulunamadı.");
        if (po.status === PurchaseOrderStatus.CANCELLED) {
          throw AppError.conflict(`${po.orderNo} iptal edilmiş — geri açılamaz.`);
        }
        throw AppError.conflict(`${po.orderNo} kapatılmış değil — geri alınacak bir şey yok.`);
      }

      // Durum kaynaktan yeniden türetilir: tam karşılanmışsa CLOSED kalır,
      // değilse OPEN/PARTIAL'a döner ve kalemler open-lines listesine geri gelir.
      const sync = await syncPurchaseOrderTx(tx, id);
      return { orderNo: sync?.orderNo ?? "", status: sync?.status };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PURCHASE_ORDER",
      recordId: id,
      newData: { kind: "REOPEN_SHORT_CLOSE", orderNo: result.orderNo, status: result.status ?? null },
    });

    return {
      success: true,
      data: await this.getById(id),
      message: `${result.orderNo} yeniden açıldı — kalan miktarlar tekrar bekleniyor.`,
    };
  }

  /**
   * Karşılanmayı kaynaktan İSTEĞE BAĞLI yeniden hesaplar (drift bandındaki
   * "Tazele"). Rollup'ı tazeleyen olaylar (fiş açılışı/iptali, düzenleme,
   * tekil top iptali) senkronu zaten çağırır; bu uç, herhangi bir yol
   * kaçırıldığında ya da elle veri düzeltmesinden sonra operatörün beklemeden
   * kendini onarabilmesi içindir. İdempotent — değişiklik yoksa `changed:false`.
   *
   * GET DEĞİL POST: senkron YAZAR (rollup + durum) — okuma ucunun yan etkisi
   * olmaz kuralının tersi yönü de geçerli, yazan uç GET olamaz.
   */
  async resync(id: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    // Advisory kilidi `syncPurchaseOrder` kendi tx'inin İLK ifadesi olarak alır.
    const sync = await syncPurchaseOrder(id);
    if (!sync) throw AppError.notFound("Alış siparişi bulunamadı.");

    if (sync.changed) {
      void AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "PURCHASE_ORDER",
        recordId: id,
        newData: { kind: "RESYNC", orderNo: sync.orderNo, status: sync.status },
      });
    }

    return {
      success: true,
      data: await this.getById(id),
      ...(sync.warnings ? { warnings: sync.warnings } : {}),
      message: sync.changed
        ? `${sync.orderNo} kaynaktan yeniden hesaplandı — rakamlar güncellendi.`
        : `${sync.orderNo} zaten günceldi — değişiklik yok.`,
    };
  }

  // ---------------------------------------------------------------------------
  // OKUMA
  // ---------------------------------------------------------------------------

  /**
   * Sipariş listesi. Offset VE cursor modu — cursor `createdAt desc, id desc`
   * çiftiyle çalışır (tie-breaker olmadan aynı milisaniyedeki iki sipariş sayfa
   * sınırında kaybolur/tekrarlar).
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
    cursor?: string;
    cursorMode?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<{ rows: unknown[]; total: number | null; nextCursor: string | null }> {
    const where: Prisma.PurchaseOrderWhereInput = {};

    // ⚠️ İKİ BACAK AYRI FİLTRELERDİR, tek "tedarikçi" anahtarına katlanmaz:
    // panel iki farklı tablodan seçim yaptırıyor ve id uzayları ayrı; tek
    // anahtar altında birleştirmek, bir müşteri id'sinin fason kolonunda
    // aranmasına (sessiz 0 satır) kapı açardı.
    // ⚠️ `readIdCondition` — CSV çoklu seçim tuzağı (CLAUDE.md 2026-08-06):
    // ham string geçirilirse uuid kolonunda P2007 → 400.
    const supplier = readIdCondition(params.filters.supplierId);
    if (supplier) where.supplierId = supplier;
    const subcontractor = readIdCondition(params.filters.subcontractorId);
    if (subcontractor) where.subcontractorId = subcontractor;

    const statusRaw = params.filters.status;
    const statusList = (Array.isArray(statusRaw) ? statusRaw : statusRaw ? statusRaw.split(",") : [])
      .map((s) => s.trim().toUpperCase())
      // ⚠️ `s in PurchaseOrderStatus` YAZMA: `in` prototip zincirini tarar.
      // Burada üstteki `.toUpperCase()` bugün KAZAYLA koruyor (prototip
      // anahtarlarının hepsi küçük/camelCase), yani güvence koda değil bir yan
      // etkiye dayanıyordu — o satır kaldırılırsa `?filter[status]=toString`
      // süzgeci geçip Prisma'ya giderdi.
      .filter((s): s is PurchaseOrderStatus => isEnumMember(PurchaseOrderStatus, s));
    if (statusList.length === 1) where.status = statusList[0];
    else if (statusList.length > 1) where.status = { in: statusList };

    if (params.dateFrom || params.dateTo) {
      where.orderDate = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }

    const q = params.search?.trim();
    if (q) {
      // ⚠️ TÜRKÇE-DUYARLI (kural + gerekçe: `utils/query-parser`): ILIKE
      // noktalı/noktasız i'yi katlamaz; ayrıca TEDARİKÇİ ADI normalize EDİLMEZ
      // (başlık düzeninde saklanabilir) → düz `contains + insensitive` ne
      // "şahin"i ne "iş bankası"nı bulur.
      // C4 — fason bacağı aramaya da girer; yoksa "boyahane" yazan kullanıcı
      // kendi verdiği siparişi bulamaz ve liste "kayıt yok" der.
      where.OR = buildTurkishSearch(q, [
        "orderNo",
        "notes",
        "supplier.name",
        "subcontractorSupplier.name",
      ]);
    }

    if (params.cursorMode) {
      const cursor = decodeCursor(params.cursor);
      const rows = await prisma.purchaseOrder.findMany({
        where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.pageSize + 1,
        select: LIST_SELECT,
      });
      const hasMore = rows.length > params.pageSize;
      const data = hasMore ? rows.slice(0, params.pageSize) : rows;
      return { rows: data, total: null, nextCursor: hasMore ? buildNextCursor(data[data.length - 1]) : null };
    }

    const rows = await prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: LIST_SELECT,
    });
    const total = await prisma.purchaseOrder.count({ where });
    return { rows, total, nextCursor: null };
  }

  /**
   * Sipariş detayı — kalemler + karşılanma + bağlı fişler.
   *
   * ⚠️ `liveReceivedQty` + `drift`: kalemin SAKLANAN karşılanması ile o anda
   * kaynaktan hesaplanan değer birlikte döner. Fark varsa ekran bunu söyler.
   * Rollup'ı tazeleyen olayların HEPSİ senkronu çağırır (fiş açılışı/iptali,
   * düzenleme ve 2026-08-14'ten beri topun TEKİL iptali de —
   * `InventoryService.softDelete` sonundaki tetik); drift yine de mümkündür
   * (senkron best-effort'tur, çökme penceresi + elle veri düzeltmesi) ve
   * görünür kalır — çıkış yolu `resync` ("Tazele").
   *
   * ⚠️ OKUMA YAZMAZ: burada senkron KOŞULMAZ. GET'in yan etkisi olmamalı
   * (refakat kartı `?/html` dersinin aynısı).
   */
  async getById(id: string): Promise<Record<string, unknown>> {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        // C4 — fason tedarikçi bacağı (liste ile AYNI şekil).
        subcontractorSupplier: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        cancelledBy: { select: { id: true, fullName: true, username: true } },
        shortClosedBy: { select: { id: true, fullName: true, username: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: { item: { select: { id: true, code: true, name: true, unit: true, itemType: true } } },
        },
        goodsReceipts: {
          orderBy: { createdAt: "desc" },
          select: { id: true, receiptNo: true, status: true, deliveryNoteNo: true, createdAt: true },
        },
      },
    });
    if (!po) throw AppError.notFound("Alış siparişi bulunamadı.");

    const receivedByItem = (await computeReceivedByItemTx(prisma, id)).byItem;
    const live = distributeFifo(
      po.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, qty: l.qty, receivedQty: l.receivedQty })),
      receivedByItem,
    );

    const lines = po.lines.map((l) => {
      const liveQty = live.get(l.id) ?? ZERO;
      const remaining = l.qty.minus(l.receivedQty);
      return {
        ...l,
        remainingQty: remaining.lt(0) ? ZERO : remaining,
        over: l.receivedQty.gt(l.qty),
        liveReceivedQty: liveQty,
        drift: !liveQty.equals(l.receivedQty),
      };
    });

    const totalQty = po.lines.reduce<Prisma.Decimal>((s, l) => s.plus(l.qty), ZERO);
    const totalReceived = po.lines.reduce<Prisma.Decimal>((s, l) => s.plus(l.receivedQty), ZERO);

    // Siparişte HİÇ olmayan ama fişlerinde gelen ürünler — yanlış sipariş
    // seçilmiş olabilir; hiçbir kaleme yazılamadıkları için sessiz kalırlardı.
    const orderedItemIds = new Set(po.lines.map((l) => l.itemId));
    const unmatchedItemIds = [...receivedByItem.keys()].filter((itemId) => !orderedItemIds.has(itemId));

    return {
      ...po,
      lines,
      unmatchedItemIds,
      totals: {
        lineCount: po.lines.length,
        totalQty,
        totalReceived,
        openLineCount: lines.filter((l) => l.remainingQty.gt(0)).length,
        overReceiptLineCount: lines.filter((l) => l.over).length,
        driftLineCount: lines.filter((l) => l.drift).length,
        unmatchedItemCount: unmatchedItemIds.length,
      },
    };
  }

  /**
   * "Ne ısmarladım, ne geldi" — henüz karşılanmamış kalemler.
   *
   * ⚠️ KARŞILAŞTIRMA SUNUCUDA (`receivedQty < qty`, Prisma alan referansı):
   * istemcide süzmek yalnız O ANKİ SAYFAYI süzer ve satın almacı "açık kalem
   * yok" sanır — oysa kalem bir sonraki sayfadadır (top listesi filtresi
   * dersinin aynısı).
   *
   * ⚠️ İPTAL VE KAPALI SİPARİŞLER KAPSAM DIŞI: yalnız `OPEN`/`PARTIAL`.
   */
  async openLines(params: {
    supplierId?: string;
    /** C4 — fason tedarikçi bacağı (müşteri bacağıyla AYRI anahtar). */
    subcontractorId?: string;
    itemId?: string;
    overdueOnly?: boolean;
    limit?: number;
  }): Promise<{ rows: unknown[]; total: number }> {
    const limit = Math.min(500, Math.max(1, params.limit ?? 200));
    const where: Prisma.PurchaseOrderLineWhereInput = {
      receivedQty: { lt: prisma.purchaseOrderLine.fields.qty },
      purchaseOrder: {
        status: { in: [PurchaseOrderStatus.OPEN, PurchaseOrderStatus.PARTIAL] },
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.subcontractorId ? { subcontractorId: params.subcontractorId } : {}),
        // "Gecikmiş" = beklenen tarih GEÇMİŞ. Tarihi olmayan kalem gecikmiş
        // SAYILMAZ — bilgi yokluğunu suçlamaya çevirmek yanlış rapor üretir.
        ...(params.overdueOnly ? { expectedDate: { lt: new Date() } } : {}),
      },
      ...(params.itemId ? { itemId: params.itemId } : {}),
    };

    const rows = await prisma.purchaseOrderLine.findMany({
      where,
      orderBy: [{ purchaseOrder: { expectedDate: { sort: "asc", nulls: "last" } } }, { purchaseOrder: { orderDate: "asc" } }, { lineNo: "asc" }],
      take: limit,
      select: {
        id: true,
        lineNo: true,
        qty: true,
        receivedQty: true,
        unitPrice: true,
        notes: true,
        item: { select: { id: true, code: true, name: true, unit: true, itemType: true } },
        purchaseOrder: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            currency: true,
            orderDate: true,
            expectedDate: true,
            supplier: { select: { id: true, code: true, name: true } },
            subcontractorSupplier: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    const total = await prisma.purchaseOrderLine.count({ where });

    const now = new Date();
    return {
      rows: rows.map((r) => ({
        ...r,
        remainingQty: r.qty.minus(r.receivedQty),
        overdue: r.purchaseOrder.expectedDate != null && r.purchaseOrder.expectedDate < now,
      })),
      total,
    };
  }
}

export const purchaseOrderService = new PurchaseOrderService();
export default purchaseOrderService;
