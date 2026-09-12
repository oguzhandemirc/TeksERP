// =============================================================================
// TAM STOK SAYIMI SERVİSİ (2026-08-15, J2 #19)
// =============================================================================
// "Depoyu baştan sona say, defterle karşılaştır, farkı KAYDA GEÇİR."
//
// Sektörel karşılık: SAP MM fiziksel envanter (MI01 sayım belgesi → MI04 sayım
// girişi → MI07 fark POSTALAMA). Üç adımın da karşılığı burada var ve ADIMLARIN
// AYRI OLMASI ÖZELLİĞİN KENDİSİDİR:
//   • `create`     → FOTOĞRAF (defterin o andaki hâli satır satır donar)
//   • `markLine`   → SAYIM GİRİŞİ (çalışma kâğıdı; hiçbir deftere yazmaz)
//   • `complete`   → FARK FİŞİ (top iptali + iplik düzeltmesi + donmuş belge)
//
// ⚠️ İKİ DEFTERE YAZAR ve ikisinin semantiği FARKLIDIR:
//   • TOP tarafı → `inventory.softDelete`in STORNO semantiği: `qtyOut = 0`
//     ("mal bu istasyondan HİÇ geçmedi") + `RollVariance.RECORD_CORRECTION`
//     ("bu metraj fiziksel olarak yoktu"). FİRE DEĞİLDİR — fire "mal vardı,
//     çöpe gitti" der ve sayım kaybını fire kovasına atmak fire oranını
//     sistematik olarak şişirirdi.
//   • İPLİK tarafı → `applyYarnMovementTx` ADJUST_IN/ADJUST_OUT (tek yazar
//     kapısı; kendi `update`ini yazan bir yol bakiyeyi sessizce yalanlar).
//
// ⚠️ HAREKET KAPANIŞI KOPYALANMAZ: `helpers/roll-disposition.closeOpenMovementsTx`
// çağrılır. Kopyalansaydı bu yol bir gün `qtyOut`u `currentQty` ile kapatır ve
// HİÇ VAR OLMAMIŞ metraj istasyon iş hacmine yazılırdı.
//
// ⚠️ `inventory.softDelete` DOĞRUDAN ÇAĞRILMAZ ve bu bilinçli: o fonksiyon KENDİ
// `prisma.$transaction`ını açar (ve sonunda tx-dışı bir alış siparişi senkronu
// koşar). Tamamlama tx'inin İÇİNDEN çağırmak, havuzdan İKİNCİ bir bağlantı alıp
// ayrı bir tx açmak demektir: dışarıdaki `DRAFT → COMPLETED` claim'i o tx'e
// GÖRÜNMEZ ve dış tx geri sarılırsa "iptal edilmiş top + sayım kaydı yok"
// durumu kalıcı olur. Bu yüzden softDelete'in semantiği PARÇA PARÇA yeniden
// KULLANILIR (aynı helper'lar: `closeOpenMovementsTx` · `postStockMoves`
// · `recordVariancesTx` — çoğul kardeşler; semantik tekil ile birebir aynıdır),
// yeniden YAZILMAZ.
//
// ⚠️ SAYIM METRAJA DOKUNMAZ. `countedQty` ROLL satırında BİLGİ NOTUDUR: metraj
// düzeltmesi G4'ün işidir (`inventory.adjustRollQty` — kendi sapma kaydı, kendi
// izni, kendi CAS'ı). Sayımın kararı ikilidir: top VAR mı, YOK mu.
// =============================================================================
import {
  GoodsReceiptStatus,
  Prisma,
  PrintedDocType,
  RollStatus,
  StockCountLineKind,
  StockCountStatus,
  WarehouseEventType,
  YarnMovementKind,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { closeOpenMovementsTx } from "./helpers/roll-disposition.helper";
import { postStockMoves } from "./helpers/warehouse-ledger.helper";
import { recordVariancesTx } from "./helpers/roll-variance.helper";
import { applyYarnMovementTx } from "./yarn.service";
import { syncPurchaseOrderSafely } from "./purchase-order.service";
import { RollVarianceKind } from "@prisma/client";
import { STOCK_COUNT_REASON_CODE, VARIANCE_SOURCES } from "../constants/variance-reasons";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import { ROLL_STATUS_TR } from "../constants/status-labels";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import {
  renderStockCountHtml,
  type StockCountDoc,
  type StockCountDocRollLine,
  type StockCountDocYarnLine,
} from "./document-render/warehouse-doc.html";
import type { PrintedDocDb } from "./printed-document.service";
import type { ApiResponse } from "../types/api.types";
import { uyari } from "../lib/logger";

type Tx = Prisma.TransactionClient;

/** Sayım belgesi ön eki — SAY + GGAAYY + NNNN. */
const DOC_PREFIX = "SAY";

/**
 * SAYILABİLİR STATÜLER — "mal FİZİKSEL olarak bu deponun rafında duruyor".
 *
 * `inventory.adjustRollQty`in `FREE_STOCK` kümesiyle BİREBİR aynıdır ve bu
 * bilinçlidir: sayım ile metraj düzeltmesi aynı fiziksel gerçeği (raftaki top)
 * konu alır; iki kümenin ayrışması, bir ekranda düzeltilebilen topun diğerinde
 * "yok" sayılması demekti.
 *
 * DIŞARIDA BIRAKILANLAR ve gerekçeleri:
 *   • `IN_PRODUCTION`             → mal istasyonda, depoda DEĞİL.
 *   • `AT_SUBCONTRACTOR`/`AT_KARTELA` → mal dışarıda.
 *   • `RETURNED_FROM_SUBCONTRACTOR` → fason dönüşü topun metrajı/kalitesi KABUL
 *     ADIMINDA belirlenir; kaydı bilinçli olarak geçiş hâlindedir. Sayımda
 *     "eksik" verdikte, henüz karar verilmemiş bir malı kayıttan düşerdik.
 *     (`adjustRollQty` aynı gerekçeyle reddediyor.)
 *   • `SHIPPED`                   → mal müşteride; çıkış kaydına dokunulmaz.
 *   • `CANCELLED`/`SCRAP`/`*_CONSUMED` → K18 ölü küme, zaten yok.
 */
export const COUNTABLE_ROLL_STATUSES: RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
];

/**
 * Tek fark fişinde kayıttan düşülebilecek EN FAZLA top.
 *
 * UX/perf capı (`DISPOSITION_MAX_ROLLS` emsali): 200 topun "kaybolduğu" bir
 * sayım tek tuşla kapatılacak bir olay değil, ARAŞTIRILACAK bir olaydır —
 * ayrıca tek tx'te yüzlerce satır kapatmak perf kuralı 10 ihlalidir.
 */
export const STOCK_COUNT_MAX_MISSING = 200;

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * Günlük sıralı belge numarası — `orderBy` ile DEĞİL, JS'te sayısal max ile
 * (`nextInvoiceNoTx`/`nextLetterNo` kanıtlı deseni: glibc collation 9→10
 * geçişinde sözlüksel sıralamayı bozar). Çağıran `withBarcodeRetry` ile
 * sarmalar — yarışta P2002 hâlâ mümkündür ve doğru cevap tekrar denemektir.
 */
async function nextCountNo(tx: Tx, date: Date): Promise<string> {
  const full = dailyCodePrefix(DOC_PREFIX, date);
  const rows = await tx.stockCount.findMany({
    where: { countNo: { gte: full, startsWith: full } },
    select: { countNo: true },
  });
  return buildDailyCode(DOC_PREFIX, nextDailySeq(rows.map((r) => r.countNo), full), date);
}

export interface CreateStockCountInput {
  warehouseId: string;
  notes?: string | null;
}

export interface MarkStockCountLineInput {
  stockCountId: string;
  lineId: string;
  /** ROLL satırında üç durumlu (`null` = "işareti kaldır" = henüz sayılmadı). */
  found?: boolean | null;
  /** YARN'da farkın kaynağı; ROLL'da bilgi notu. `null` = temizle. */
  countedQty?: number | string | null;
  notes?: string | null;
}

/** Tamamlamanın tek satırlık sonucu — audit + yanıt için. */
interface AppliedMissingRoll {
  rollId: string;
  barcode: string | null;
  qty: Prisma.Decimal;
  /** İptal ÖNCESİ statü — defter satırının çıkış ucu bundan kurulur (stornonun
   *  yönü ileri satırın `fromStatus`undan aynalanır, yani boş bırakılamaz). */
  status: RollStatus;
}

export class StockCountService {
  // ---------------------------------------------------------------------------
  // OLUŞTURMA — fotoğraf AYNI tx'te çekilir
  // ---------------------------------------------------------------------------
  /**
   * Depo için DRAFT sayım açar ve satır fotoğrafını aynı tx'te yazar.
   *
   * ⚠️ FOTOĞRAF ile SAYIM ARASINDA STOK HAREKET EDEBİLİR — bu bir hata değil,
   * fiziksel gerçektir. Tamamlama her satırda TX-İÇİ TAZE CLAIM yapar ve kayan
   * satırı "kapsam dışı" olarak işaretler.
   *
   * ⚠️ SIFIR BAKİYELİ iplik satırı ATLANIR (sayılacak bir şey yok), NEGATİF
   * bakiye ATLANMAZ: eksi bakiye sayımın DÜZELTMEK İÇİN VAR OLDUĞU şeydir;
   * gizlemek, kaydı yanlış olan tek kalemi listeden çıkarmak olurdu.
   */
  async create(
    input: CreateStockCountInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; countNo: string; rollLines: number; yarnLines: number }>> {
    const issuedAt = new Date();

    const result = await withBarcodeRetry(async () =>
      prisma.$transaction(async (tx) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { id: input.warehouseId },
          select: { id: true, name: true, isActive: true },
        });
        if (!warehouse) throw AppError.badRequest("Depo bulunamadı.");
        if (!warehouse.isActive) {
          throw AppError.badRequest(
            `"${warehouse.name}" deposu pasif — sayım yalnız aktif depoda açılır.`,
          );
        }

        // ⚠️ TEK AÇIK SAYIM: iki DRAFT sayım aynı malı iki kez sayar ve iki fark
        // fişi doğurur — ikincisi birincinin düzelttiği farkı BİR KEZ DAHA
        // yazardı (aynı topu iki kez iptal etmeye çalışmak "kapsam dışı"
        // üretirdi, ama iplik tarafında fark İKİ KEZ uygulanırdı).
        const openCount = await tx.stockCount.findFirst({
          where: { warehouseId: warehouse.id, status: StockCountStatus.DRAFT },
          select: { countNo: true },
        });
        if (openCount) {
          throw AppError.conflict(
            `"${warehouse.name}" deposunda zaten açık bir sayım var (${openCount.countNo}) — önce onu tamamlayın ya da iptal edin.`,
          );
        }

        const countNo = await nextCountNo(tx, issuedAt);
        const count = await tx.stockCount.create({
          data: {
            countNo,
            warehouseId: warehouse.id,
            notes: input.notes?.trim() || null,
            createdById: userId ?? null,
          },
          select: { id: true, countNo: true },
        });

        // ── FOTOĞRAF: toplar ────────────────────────────────────────────────
        // ⚠️ `shipmentId: null` — sevkiyata atanmış top yola çıkmak üzeredir ve
        // sayımın konusu değildir (üstelik iptal edilemez, yani "eksik"
        // işaretlenirse kapsam dışı olurdu). Çuval üyesi toplar LİSTEYE GİRER:
        // fiziksel olarak raftadırlar ve sayan kişi onları görür.
        const rolls = await tx.roll.findMany({
          where: {
            warehouseId: warehouse.id,
            status: { in: COUNTABLE_ROLL_STATUSES },
            shipmentId: null,
          },
          select: { id: true, currentQty: true },
          orderBy: { createdAt: "asc" },
        });
        if (rolls.length > 0) {
          // createMany — perf kuralı 9 (tek-tek create 10-50x yavaş).
          await tx.stockCountLine.createMany({
            data: rolls.map((r) => ({
              stockCountId: count.id,
              kind: StockCountLineKind.ROLL,
              rollId: r.id,
              expectedQty: r.currentQty,
            })),
          });
        }

        // ── FOTOĞRAF: iplik ─────────────────────────────────────────────────
        const stocks = await tx.yarnStock.findMany({
          where: { warehouseId: warehouse.id, NOT: { balanceKg: 0 } },
          select: { itemId: true, balanceKg: true },
        });
        if (stocks.length > 0) {
          await tx.stockCountLine.createMany({
            data: stocks.map((s) => ({
              stockCountId: count.id,
              kind: StockCountLineKind.YARN,
              itemId: s.itemId,
              expectedQty: s.balanceKg,
            })),
          });
        }

        return { ...count, rollLines: rolls.length, yarnLines: stocks.length };
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "STOCK_COUNT",
      recordId: result.id,
      newData: {
        countNo: result.countNo,
        warehouseId: input.warehouseId,
        rollLines: result.rollLines,
        yarnLines: result.yarnLines,
      },
    });
    return {
      success: true,
      data: result,
      message: `${result.countNo} açıldı — ${result.rollLines} top, ${result.yarnLines} iplik kalemi sayılacak.`,
    };
  }

  // ---------------------------------------------------------------------------
  // SAYIM GİRİŞİ — yalnız DRAFT'ta
  // ---------------------------------------------------------------------------
  /**
   * Tek satırı işaretler.
   *
   * ⚠️ KİLİT SAYIM SATIRINDA, tx'in İLK ifadesi (`SELECT … FOR UPDATE`).
   *
   * İlk yazımda DRAFT koşulu yalnız `updateMany`in WHERE'inde bir İLİŞKİ
   * FİLTRESİ olarak duruyordu ve o KİLİTLEMEZ — çapraz incelemede iki bağlantıyla
   * ölçüldü: A `BEGIN; UPDATE stock_counts SET status='COMPLETED' … status='DRAFT'`
   * (henüz COMMIT etmemiş) iken B'nin `UPDATE stock_count_lines … WHERE
   * "stockCountId" IN (SELECT id FROM stock_counts WHERE status='DRAFT')` sorgusu
   * **3 ms'de 1 satır güncelledi**. Sebep yapısal: ilişki filtresi `stock_counts`
   * üzerinde KİLİTSİZ bir alt sorgudur (READ COMMITTED'da A'nın commit etmemiş
   * değişikliği görünmez), güncellenen satır ise `stock_count_lines`tedir ve FK
   * kolonu değişmediği için ebeveynde FOR KEY SHARE bile alınmaz.
   *
   * İki zararlı sıralama vardı, ikisi de sessiz:
   *   • B, `complete`in satır okumasından SONRA commit ederse → donmuş tutanak
   *     satırı "SAYILMADI" basar, DB'de `found=false` kalır, top canlıdır; ekran
   *     COMPLETED sayımda "eksik — kayıttan düşüldü" der. Kâğıt da ekran da yalan.
   *   • B, okumadan ÖNCE commit ederse → `complete` ONAY DİYALOĞUNDA HİÇ
   *     LİSTELENMEMİŞ bir topu iptal eder (yıkıcı-işlem onay kuralı delinir).
   *
   * Satır kilidiyle iki yön de kapanır: `complete`in İLK yazımı da aynı
   * `stock_counts` satırını kilitlediği için ya markLine önce girer (complete
   * bekler, sonra TAZE satırları okur) ya complete önce girer (markLine bekler ve
   * ardından 409 alır). Kilit sırası ikisinde de AYNI (önce sayım, sonra satır) →
   * deadlock yok.
   */
  async markLine(
    input: MarkStockCountLineInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const data: Prisma.StockCountLineUpdateManyMutationInput = {};
    if (input.found !== undefined) data.found = input.found;
    if (input.countedQty !== undefined) {
      data.countedQty = input.countedQty === null ? null : toQty(input.countedQty);
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (Object.keys(data).length === 0) {
      throw AppError.badRequest("Değiştirilecek alan yok (found / countedQty / notes).");
    }

    const claim = await prisma.$transaction(async (tx) => {
      await lockDraftCountTx(tx, input.stockCountId);
      // İlişki filtresi KALDIRILMADI (derinlik savunması): kilit alındıktan sonra
      // koşul zaten tutar, ama kilit bir gün yanlışlıkla düşerse WHERE hâlâ
      // tamamlanmış sayımın satırını yazmaz.
      return tx.stockCountLine.updateMany({
        where: {
          id: input.lineId,
          stockCountId: input.stockCountId,
          stockCount: { status: StockCountStatus.DRAFT },
        },
        data,
      });
    });
    if (claim.count === 0) {
      // Tanı TAZE okumayla — reddedilen kişiye jenerik "olmadı" değil, o an
      // geçerli engel anlatılır (`adjustRollQty` count-0 tanısı emsali).
      const line = await prisma.stockCountLine.findUnique({
        where: { id: input.lineId },
        select: { stockCountId: true, stockCount: { select: { countNo: true, status: true } } },
      });
      if (!line || line.stockCountId !== input.stockCountId) {
        throw AppError.notFound("Sayım satırı bulunamadı.");
      }
      throw AppError.conflict(
        `${line.stockCount.countNo} artık ${statusLabel(line.stockCount.status)} — satır değiştirilemez.`,
      );
    }

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STOCK_COUNT_LINE",
      recordId: input.lineId,
      newData: { ...input },
    });
    return { success: true, data: { id: input.lineId }, message: "Satır güncellendi." };
  }

  /**
   * TOPLU İŞARETLEME — "sayılmayan tüm top satırlarını BULUNDU yap".
   *
   * ⚠️ YALNIZ `found: true` YÖNÜNDE çalışır ve bu bir tasarım kararıdır: toplu
   * "hepsi EKSİK" tek tuşla deponun tamamını kayıttan düşürürdü. Eksik işareti
   * satır satır, insan kararıyla konur.
   *
   * ⚠️ ZATEN İŞARETLİ satıra DOKUNMAZ (`found: null` süzgeci): sayan kişinin
   * tek tek koyduğu "eksik" işaretlerini toplu tuş silemez.
   */
  async markAllFound(
    stockCountId: string,
    userId?: string,
  ): Promise<ApiResponse<{ updated: number }>> {
    // ⚠️ KİLİT — `markLine` ile AYNI gerekçe (oradaki uzun nota bak): eski hâli
    // `findUnique → if → updateMany` idi, yani ders kitabı check-then-act.
    const res = await prisma.$transaction(async (tx) => {
      await lockDraftCountTx(tx, stockCountId);
      return tx.stockCountLine.updateMany({
        where: {
          stockCountId,
          kind: StockCountLineKind.ROLL,
          found: null,
          stockCount: { status: StockCountStatus.DRAFT },
        },
        data: { found: true },
      });
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STOCK_COUNT",
      recordId: stockCountId,
      newData: { event: "STOCK_COUNT_MARK_ALL_FOUND", updated: res.count },
    });
    return {
      success: true,
      data: { updated: res.count },
      message: `${res.count} satır "bulundu" olarak işaretlendi.`,
    };
  }

  // ---------------------------------------------------------------------------
  // TAMAMLAMA — fark fişi + donmuş belge, TEK tx
  // ---------------------------------------------------------------------------
  /**
   * Sayımı tamamlar: eksik topları kayıttan düşer, iplik farkını deftere yazar
   * ve belgeyi AYNI tx'te dondurur.
   *
   * ⚠️ ATOMİK CLAIM `DRAFT → COMPLETED` tx'in İLK yazımıdır: iki eşzamanlı
   * tamamlamadan yalnız biri geçer, yani fark fişi TEK KEZ yazılır.
   *
   * ⚠️ SATIR BAZINDA TAZE CLAIM: fotoğraf ile bu an arasında top sevk edilmiş /
   * taşınmış / çuvala girmiş olabilir. Claim kaybeden satır İPTAL EDİLMEZ,
   * "kapsam dışı" olarak somut sebebiyle işaretlenir ve belgede öyle basılır.
   * Alternatifi (eski fotoğrafa göre körlemesine iptal) SEVK EDİLMİŞ MALI
   * kayıttan düşmek olurdu — sessiz, kalıcı ve geri alınması pahalı.
   *
   * ⚠️ `cancel` yalnız DRAFT'ta çalışır; tamamlanmış sayımın fark fişi TEK
   * BELGEDE stornolanır (`stock-count-reversal.service`). Storno ileri satırları
   * bulmak için bu fonksiyonun yazdığı bağlara yaslanır: sapma `sourceRefId`,
   * depo satırı `stockCountId`, top iptal metni `stockCountCancelReason`.
   */
  async complete(
    stockCountId: string,
    userId?: string,
  ): Promise<
    ApiResponse<{
      id: string;
      countNo: string;
      cancelledRolls: number;
      cancelledMeters: number;
      yarnAdjustments: number;
      outOfScope: number;
    }>
  > {
    const outcome = await prisma.$transaction(async (tx) => {
      // ── 1) BELGE CLAIM'İ ────────────────────────────────────────────────
      const claim = await tx.stockCount.updateMany({
        where: { id: stockCountId, status: StockCountStatus.DRAFT },
        data: {
          status: StockCountStatus.COMPLETED,
          completedAt: new Date(),
          completedById: userId ?? null,
        },
      });
      if (claim.count === 0) {
        const cur = await tx.stockCount.findUnique({
          where: { id: stockCountId },
          select: { countNo: true, status: true },
        });
        if (!cur) throw AppError.notFound("Sayım bulunamadı.");
        throw AppError.conflict(`${cur.countNo} zaten ${statusLabel(cur.status)}.`);
      }

      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: stockCountId },
        select: { id: true, countNo: true, warehouseId: true },
      });

      const lines = await tx.stockCountLine.findMany({
        where: { stockCountId },
        select: {
          id: true,
          kind: true,
          rollId: true,
          itemId: true,
          expectedQty: true,
          countedQty: true,
          found: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // ── 2) EKSİK TOPLAR ─────────────────────────────────────────────────
      // ⚠️ YALNIZ AÇIKÇA `found === false` işaretlenen satır işlem görür.
      // `null` (sayılmadı) EKSİK SAYILMAZ: yarım bırakılmış bir sayımın
      // tamamlanması, sayılmamış her topu sessizce kayıttan düşerdi — bu
      // özelliğin yapabileceği en yıkıcı hata. İşaretsiz satır belgede ayrı
      // bir sayaç olarak GÖRÜNÜR (gizlenmez).
      const missing = lines.filter(
        (l) => l.kind === StockCountLineKind.ROLL && l.found === false && l.rollId,
      );
      if (missing.length > STOCK_COUNT_MAX_MISSING) {
        throw AppError.badRequest(
          `Bu sayımda ${missing.length} top eksik işaretlenmiş (sınır ${STOCK_COUNT_MAX_MISSING}). ` +
            "Bu kadar büyük bir fark tek fişle kapatılmaz — önce nedenini araştırın ya da sayımı bölün.",
        );
      }

      const applied: AppliedMissingRoll[] = [];
      const outOfScope: Array<{ lineId: string; reason: string }> = [];
      /** Kayıttan düşülen topların mal kabul fişleri — tx SONRASI PO senkronu için. */
      const receiptIds = new Set<string>();

      for (const line of missing) {
        const rollId = line.rollId as string;
        // Tx İÇİNDE TAZE okuma — fotoğraftaki değerlere GÜVENİLMEZ.
        const roll = await tx.roll.findUnique({
          where: { id: rollId },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            warehouseId: true,
            sackId: true,
            shipmentId: true,
            currentStepId: true,
            // Alış siparişi rollup'ı için (tx SONRASI senkron) — aşağıdaki nota bak.
            goodsReceiptId: true,
          },
        });
        if (!roll) {
          outOfScope.push({ lineId: line.id, reason: "Top kaydı bulunamadı" });
          continue;
        }

        // ⚠️ KAPSAM KONTROLÜ CAS'TAN AYRIDIR ve İKİSİ DE GEREKLİDİR — bu ayrım
        // bekçi tarafından bulundu ve pahalıya patlayabilirdi:
        //   • KAPSAM (buradaki `if`): "bu top HÂLÂ sayılabilir bir raf malı mı".
        //     Yalnız CAS yazılsaydı (`status: roll.status`) koşul TANIM GEREĞİ
        //     tutardı — taze okuma neyi görüyorsa onu iddia eder — ve fotoğraftan
        //     sonra SEVK EDİLMİŞ bir top sessizce iptal edilirdi (ölçüldü).
        //   • CAS (aşağıdaki WHERE): "bu satır ben okuduktan SONRA değişmedi".
        //     READ COMMITTED'da okuma ile yazma arasında başka bir tx commit
        //     edebilir; kaybeden 0 satır günceller ve kapsam dışına düşer.
        const block = blockReason(roll, count.warehouseId);
        if (block !== null) {
          outOfScope.push({ lineId: line.id, reason: block });
          continue;
        }

        // ATOMİK CLAIM (check-then-act YASAK): gözlenen statü + depo + serbestlik
        // tek WHERE'de. Kaybeden satır HATA FIRLATMAZ — sayımın geri kalanı
        // geçerlidir ve bu satır sebebiyle birlikte belgeye yazılır.
        const rollClaim = await tx.roll.updateMany({
          where: {
            id: rollId,
            status: roll.status,
            warehouseId: count.warehouseId,
            sackId: null,
            shipmentId: null,
            currentStepId: null,
          },
          data: {
            status: RollStatus.CANCELLED,
            // Geri almanın döneceği raf — `preShipStatus` emsali; körlemesine
            // STOCK yazmak A1_STOCK/WAREHOUSE topunu yanlış rafa döndürürdü.
            preCancelStatus: roll.status,
            cancelledAt: new Date(),
            cancelledById: userId ?? null,
            cancelReason: stockCountCancelReason(count.countNo),
            // ⚠️ `warehouseId` BİLEREK temizlenmez ("en son hangi depodaydı"
            // izi + iptal geri alınırsa rafına döner — softDelete ile aynı).
          },
        });
        if (rollClaim.count === 0) {
          // Yarışın kaybedeni — sebep TAZE okumayla söylenir (jenerik "olmadı"
          // değil, o an geçerli engel).
          const fresh = await tx.roll.findUnique({
            where: { id: rollId },
            select: {
              status: true,
              warehouseId: true,
              sackId: true,
              shipmentId: true,
              currentStepId: true,
            },
          });
          outOfScope.push({
            lineId: line.id,
            reason:
              (fresh && blockReason(fresh, count.warehouseId)) ??
              "Bu sırada başka bir işleme girdi",
          });
          continue;
        }

        // ⚠️ METRAJ CLAIM'DEN SONRA, TAZE OKUNUR — okumadaki `roll.currentQty`
        // KULLANILMAZ. Claim `currentQty`yi WHERE'e ALMAZ (bilinçli: metrajı bu
        // arada düzeltilmiş bir topu "kapsam dışı" bırakmak, malı gerçekten
        // olmayan topu envanterde tutmak demekti) — ama o zaman iki okuma arası
        // pencerede `POST /api/rolls/:id/adjust-qty` (G4) commit ederse üç
        // yüzeye BAYAT metraj yazılırdı: depo defteri, sapma defteri ve DONMUŞ
        // tutanak. `softDelete`in deseni birebir budur (`inventory.service`:
        // claim → `findUniqueOrThrow` → `qty: r.currentQty`).
        //
        // Okuma neden GÜVENLİ: `updateMany` başarılı olduğu an satır kilidi
        // BİZDEDİR ve commit'e kadar başkası yazamaz. Yani bu değer, aynı tx
        // içinde donan belgenin okuyacağı değerle ZORUNLU olarak aynıdır
        // ("kâğıt, kendisini doğuran işlemin yazdığı rakamı söyler").
        const pinned = await tx.roll.findUniqueOrThrow({
          where: { id: rollId },
          select: { currentQty: true },
        });
        applied.push({ rollId, barcode: roll.barcode, qty: pinned.currentQty, status: roll.status });
        if (roll.goodsReceiptId) receiptIds.add(roll.goodsReceiptId);
      }

      if (applied.length > 0) {
        const rollIds = applied.map((a) => a.rollId);
        // Açık hareketler STORNO ile kapanır (`qtyOut = 0`). Set-bazlı tek
        // sorgu — helper `rollIds` dizisi alır.
        await closeOpenMovementsTx(tx, {
          rollIds,
          action: "CANCELLED",
          origin: "STOCK_COUNT",
          reason: `${count.countNo} sayım farkı`,
        });

        // İKİ DEFTER, İKİ TOPLU YAZIM (perf kuralı 9). Döngü 1'in per-top CAS'ı
        // SEMANTİKTİR (kaybedeni taze okumayla ayırt eder) ve orada kalır; buradaki
        // yazımlar ise koşulsuzdur — `applied` kümesi zaten kazananların listesi.
        // Tavanda (200 eksik top) 400 insert yerine 2 sorgu.
        // DEPO DEFTERİ — mal STOKTAN DÜŞTÜ. Çıkış ucu topun İPTAL ÖNCESİ statüsüdür:
        // stornonun yönü bu satırdan aynalanıyor, `fromStatus` boş kalırsa ters kayıt
        // kurulamaz. Toplu kapı id DÖNMEZ ama gerekmiyor — storno ileri satırı
        // `(stockCountId, eventType, rollId, reversesMovementId IS NULL)` ile bulur.
        const ledgerWritten = await postStockMoves(
          tx,
          applied.map((a) => ({
            rollId: a.rollId,
            eventType: WarehouseEventType.CANCEL,
            qty: a.qty,
            from: { warehouseId: count.warehouseId, status: a.status },
            reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
            stockCountId: count.id,
            userId: userId ?? null,
            notes: `${count.countNo} sayım farkı`,
          })),
        );
        if (ledgerWritten !== applied.length) {
          throw AppError.internal(
            `Depo defterine ${ledgerWritten}/${applied.length} sayım satırı yazıldı — geri sarıldı.`,
          );
        }

        // SAPMA DEFTERİ — "bu metraj fiziksel olarak yoktu" (fire DEĞİL).
        await recordVariancesTx(
          tx,
          applied.map((a) => ({
            rollId: a.rollId,
            kind: RollVarianceKind.RECORD_CORRECTION,
            qty: a.qty,
            source: VARIANCE_SOURCES.STOCK_COUNT,
            reasonCode: STOCK_COUNT_REASON_CODE,
            reasonText: stockCountCancelReason(count.countNo),
            sourceRefId: count.id,
            userId: userId ?? null,
          })),
        );
      }

      // ── 3) İPLİK FARKLARI ───────────────────────────────────────────────
      // ⚠️ `countedQty` VERİLMEMİŞ satıra DOKUNULMAZ: "saymadım" ile "sıfır
      // saydım" farklı şeylerdir ve ikincisi açıkça 0 yazılarak söylenir.
      let yarnAdjustments = 0;
      for (const line of lines) {
        if (line.kind !== StockCountLineKind.YARN || !line.itemId) continue;
        if (line.countedQty == null) continue;

        // ⚠️ CAS: defter bakiyesi FOTOĞRAFTAN sonra değiştiyse fark UYGULANMAZ.
        // Aksi halde sayım penceresinde giren 500 kg'lık bir mal kabulü, eski
        // fotoğrafa göre hesaplanan farkla SESSİZCE silinirdi. Top tarafındaki
        // claim'in birebir ikizi — iki defter aynı disiplinle korunur.
        const stock = await tx.yarnStock.findUnique({
          where: { itemId_warehouseId: { itemId: line.itemId, warehouseId: count.warehouseId } },
          select: { balanceKg: true },
        });
        const live = D(stock?.balanceKg ?? 0);
        if (!live.equals(D(line.expectedQty))) {
          outOfScope.push({
            lineId: line.id,
            reason: `Bakiye sayımdan sonra değişti (defter ${live.toString()} kg)`,
          });
          continue;
        }

        const diff = D(line.countedQty).minus(D(line.expectedQty));
        if (diff.isZero()) continue;

        await applyYarnMovementTx(tx, {
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          kind: diff.greaterThan(0) ? YarnMovementKind.ADJUST_IN : YarnMovementKind.ADJUST_OUT,
          qtyKg: diff.abs(),
          stockCountId: count.id,
          reason: `${count.countNo} sayım farkı`,
          userId: userId ?? null,
        });
        yarnAdjustments++;
      }

      // ── 4) KAPSAM DIŞI İŞARETLERİ ───────────────────────────────────────
      // Sessiz atlama yok: her atlanan satır SEBEBİYLE kaydedilir ve donmuş
      // belgede basılır.
      // Satırlar SEBEBE göre gruplanır: `blockReason` KAPALI bir küme döner, yani
      // tavanda (200 satır) 200 UPDATE yerine bir avuç `updateMany`.
      // ⚠️ Sessiz atlama YOK — yazılan satır sayısı beklenenle karşılaştırılır.
      // Tekil `update` eksik satırda P2025 fırlatıyordu; kural aynı kalır, yalnız
      // mesaj okunur olur (`outOfScope` içinde aynı satır iki kez GEÇMEZ: ROLL ve
      // YARN dalları ayrık kümeler üstünde koşar).
      const byReason = new Map<string, string[]>();
      for (const o of outOfScope) {
        const reason = o.reason.slice(0, 200);
        const bucket = byReason.get(reason);
        if (bucket) bucket.push(o.lineId);
        else byReason.set(reason, [o.lineId]);
      }
      let markedOutOfScope = 0;
      for (const [reason, lineIds] of byReason) {
        const res = await tx.stockCountLine.updateMany({
          where: { id: { in: lineIds } },
          data: { outOfScopeReason: reason },
        });
        markedOutOfScope += res.count;
      }
      if (markedOutOfScope !== outOfScope.length) {
        throw AppError.conflict(
          `Kapsam dışı satırlar işaretlenemedi (${markedOutOfScope}/${outOfScope.length}) — ` +
            "sayım satırları bu sırada değişti, tekrar deneyin.",
        );
      }

      // ── 5) BELGE DONAR (tx İÇİNDE) ──────────────────────────────────────
      // Kayıt ile resmi kâğıt ya birlikte doğar ya hiç (makbuz emsali).
      // Builder tx client'ıyla çalışır, yani yukarıdaki tüm yazımları görür.
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.STOCK_COUNT,
        count.id,
        userId,
      );

      const cancelledMeters = applied.reduce(
        (acc, a) => acc.plus(a.qty),
        new Prisma.Decimal(0),
      );
      return {
        id: count.id,
        countNo: count.countNo,
        cancelledRolls: applied.length,
        cancelledMeters: Number(cancelledMeters),
        yarnAdjustments,
        outOfScope: outOfScope.length,
        appliedBarcodes: applied.map((a) => a.barcode),
        receiptIds: [...receiptIds],
      };
    });

    // ── ALIŞ SİPARİŞİ ROLLUP SENKRONU (tx DIŞI) ─────────────────────────────
    // Sayımda düşülen top bir mal kabul fişinden doğduysa KARŞILANMA DEĞİŞTİ:
    // `computeReceivedByItemTx` kaynağı `status: { not: CANCELLED }` ile süzüyor
    // (`purchase-order.service`), yani iptal edilen top karşılanmadan gerçekten
    // düşer. Bu bacak ilk yazımda ATLANMIŞTI ve sonucu sessizdi: 10 topluk bir
    // kabulün 3 topu sayımda bulunamayınca sipariş "tamamı geldi" (CLOSED,
    // receivedQty 1000) görünmeye DEVAM ediyor, kimse eksik 300 m için
    // tedarikçiyi aramıyordu. `inventory.softDelete` tam bu yüzden 2026-08-14'te
    // aynı senkronu eklemişti — servis başlığındaki "softDelete'i çağırmıyoruz"
    // kararı, onun tx-DIŞI bacağını da düşürmüştü.
    //
    // ⚠️ TX DIŞI ve YUTULUR (softDelete emsali): `syncPurchaseOrder` KENDİ
    // tx'ini ve 8027 advisory kilidini alır; tamamlama tx'inin içine gömmek
    // kilidi top satır kilitlerinden SONRAYA düşürürdü (kilit sırası kuralı).
    // Rapor rakamı güncellenemezse fark fişi geri ALINMAZ — rollup bir sonraki
    // senkronda kendini onarır ve panel drift bandı + "Tazele" ile görünür kılar.
    //
    // ⚠️ Yalnız ACTIVE fiş: iptal fiş zaten kaynak dışıdır → senkron no-op olurdu.
    if (outcome.receiptIds.length > 0) {
      try {
        const receipts = await prisma.goodsReceipt.findMany({
          where: { id: { in: outcome.receiptIds }, status: GoodsReceiptStatus.ACTIVE },
          select: { purchaseOrderId: true },
        });
        const poIds = [...new Set(receipts.map((r) => r.purchaseOrderId).filter(Boolean))] as string[];
        for (const poId of poIds) await syncPurchaseOrderSafely(poId);
      } catch (e) {
        uyari("stock-count", `${outcome.countNo} PO senkronu başarısız:`,
          (e as Error).message,
        );
      }
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STOCK_COUNT",
      recordId: stockCountId,
      newData: {
        event: "STOCK_COUNT_COMPLETED",
        countNo: outcome.countNo,
        cancelledRolls: outcome.cancelledRolls,
        cancelledMeters: outcome.cancelledMeters,
        yarnAdjustments: outcome.yarnAdjustments,
        outOfScope: outcome.outOfScope,
        barcodes: outcome.appliedBarcodes,
      },
    });

    const { appliedBarcodes: _drop, receiptIds: _drop2, ...data } = outcome;
    return {
      success: true,
      data,
      message:
        `${outcome.countNo} tamamlandı — ${outcome.cancelledRolls} top kayıttan düşüldü ` +
        `(${outcome.cancelledMeters} m), ${outcome.yarnAdjustments} iplik düzeltmesi` +
        (outcome.outOfScope > 0 ? `, ${outcome.outOfScope} satır kapsam dışı kaldı.` : "."),
    };
  }

  // ---------------------------------------------------------------------------
  // İPTAL — yalnız DRAFT
  // ---------------------------------------------------------------------------
  /**
   * Taslak sayımı iptal eder. Satırlar SİLİNMEZ (ne sayıldığı sorusunun cevabı
   * iptalden sonra da gerekir) ve belge DOĞMAMIŞTIR — donmuş kâğıt yalnız
   * tamamlanmış sayımda vardır.
   *
   * ⚠️ TAMAMLANMIŞ sayım iptal EDİLMEZ, STORNOLANIR: fark fişi iki deftere
   * yazdı ve geri alma ters kayıttır (`stock-count-reversal.service`).
   */
  async cancel(
    stockCountId: string,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; countNo: string }>> {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.stockCount.updateMany({
        where: { id: stockCountId, status: StockCountStatus.DRAFT },
        data: {
          status: StockCountStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.stockCount.findUnique({
          where: { id: stockCountId },
          select: { countNo: true, status: true },
        });
        if (!cur) throw AppError.notFound("Sayım bulunamadı.");
        if (cur.status === StockCountStatus.COMPLETED) {
          throw AppError.conflict(
            `${cur.countNo} tamamlanmış — fark fişi deftere işledi ve iptal edilemez. ` +
              "Farkı geri almak için sayımı stornolayın.",
          );
        }
        throw AppError.conflict(`${cur.countNo} zaten iptal edilmiş.`);
      }
      return tx.stockCount.findUniqueOrThrow({
        where: { id: stockCountId },
        select: { id: true, countNo: true },
      });
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STOCK_COUNT",
      recordId: stockCountId,
      newData: { event: "STOCK_COUNT_CANCELLED", countNo: result.countNo, reason },
    });
    return { success: true, data: result, message: `${result.countNo} iptal edildi.` };
  }

  // ---------------------------------------------------------------------------
  // OKUMA
  // ---------------------------------------------------------------------------
  /**
   * Liste — OFFSET sayfalama (cursor DEĞİL, bilinçli): sayım düşük hacimli bir
   * belgedir (depo başına yılda birkaç). Yüz binlerce satır için yazılmış bir
   * aracı buraya taşımak, hiç ihtiyaç duyulmayan bir karmaşıklıktı.
   */
  async list(params: {
    page?: number;
    pageSize?: number;
    warehouseId?: string;
    status?: StockCountStatus;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.StockCountWhereInput = {};
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }
    if (params.search?.trim()) {
      where.countNo = { contains: params.search.trim(), mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      prisma.stockCount.findMany({
        where,
        select: {
          id: true,
          countNo: true,
          status: true,
          notes: true,
          createdAt: true,
          completedAt: true,
          cancelledAt: true,
          reversedAt: true,
          warehouse: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.stockCount.count({ where }),
    ]);
    return {
      data,
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Detay — satırlarıyla birlikte (sayım ekranının veri kaynağı). */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const row = await prisma.stockCount.findUnique({
      where: { id },
      select: {
        id: true,
        countNo: true,
        status: true,
        notes: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelReason: true,
        reversedAt: true,
        reverseReason: true,
        warehouse: { select: { id: true, code: true, name: true } },
        lines: {
          select: {
            id: true,
            kind: true,
            expectedQty: true,
            countedQty: true,
            found: true,
            notes: true,
            outOfScopeReason: true,
            roll: {
              select: {
                id: true,
                barcode: true,
                status: true,
                width: true,
                item: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
            item: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!row) throw AppError.notFound("Sayım bulunamadı.");
    return { success: true, data: row };
  }
}

export const stockCountService = new StockCountService();

// ---------------------------------------------------------------------------
// YARDIMCILAR
// ---------------------------------------------------------------------------

/**
 * Sayım satırlarını değiştirmeden ÖNCE sayımın kendi satırını kilitler ve
 * DRAFT olduğunu doğrular. TEK KAYNAK: `markLine` ve `markAllFound` bunu çağırır.
 *
 * ⚠️ TX'İN İLK İFADESİ OLMAK ZORUNDA (KK1 mükerrer tuzağı dersi): sonra
 * alınırsa "oku → yaz" penceresi açık kalır ve kilitten hiçbir şey kazanılmaz.
 *
 * ⚠️ `FOR UPDATE`, `complete`in ilk yazımıyla AYNI satırı hedefler — koruma tam
 * olarak bu eşleşmeden doğar. Prisma'nın ilişki filtresi (`stockCount: { status:
 * DRAFT }`) bunu SAĞLAMAZ: o kilitsiz bir alt sorgudur (gerekçe `markLine`
 * JSDoc'unda, canlı ölçümüyle birlikte).
 */
async function lockDraftCountTx(tx: Tx, stockCountId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ countNo: string; status: StockCountStatus }>>`
    SELECT "countNo", "status" FROM "stock_counts" WHERE "id" = ${stockCountId}::uuid FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw AppError.notFound("Sayım bulunamadı.");
  if (row.status !== StockCountStatus.DRAFT) {
    throw AppError.conflict(
      `${row.countNo} artık ${statusLabel(row.status)} — satırları değiştirilemez.`,
    );
  }
}

/**
 * Serbest metin miktarı Decimal'e çevirir — çeviremezse 400 (500 DEĞİL).
 *
 * ⚠️ NEGATİF REDDEDİLİR ve kural BACKEND'DE YAŞAR. Panel (`stockCountRules
 * .parseAmount`) zaten reddediyordu ama kural YALNIZ orada olduğu için doğrudan
 * API çağrısı / eski istemci / ileride yazılacak mobil sayım ekranı onu atlardı.
 * Somut sonuç ölçüldü: bakiyesi 10 kg olan kaleme `countedQty: -5` gönderilirse
 * fark `−15` çıkar, `ADJUST_OUT` yazılır ve `assertYarnBalanceCoversTx` İLK
 * satırında `ADJUST_OUT`u MUAF tuttuğu için (`yarn-balance-guard.helper.ts`)
 * `yarn.blockNegativeBalanceEnabled` AÇIK olsa bile durmaz → defter **−5 kg**'a
 * iner ve donmuş tutanak "SAYILAN −5 · FARK −15 · FARK UYGULANDI" basar.
 *
 * ⚠️ SIFIR MEŞRUDUR ("saydım, hiç kalmamış" sayımın en sık cevabıdır) — alt
 * sınır `> 0` değil `>= 0`.
 */
function toQty(raw: number | string): Prisma.Decimal {
  let dec: Prisma.Decimal;
  try {
    dec = new Prisma.Decimal(typeof raw === "string" ? raw.trim() : raw);
    if (!dec.isFinite()) throw new Error("nan");
  } catch {
    throw AppError.badRequest(
      `Miktar sayı olarak okunamadı ("${String(raw).slice(0, 32)}"). Ondalık ayırıcı NOKTA'dır — "12,5" değil "12.5" yazın.`,
    );
  }
  if (dec.isNegative()) {
    throw AppError.badRequest(
      `Sayılan miktar eksi olamaz ("${dec.toString()}"). Eksi bakiye DEFTERİN durumudur, sayımın sonucu değil — ` +
        "raftakini yazın; hiç kalmamışsa 0.",
    );
  }
  return dec;
}

/**
 * Sayımın düşürdüğü topun iptal metni — TEK KAYNAK. Storno "bu topu hâlâ BU sayım
 * mı iptal etti" sorusunu bu metinle cevaplar (topta tipli sayım bağı yok).
 */
export function stockCountCancelReason(countNo: string): string {
  return `${countNo} sayımında bulunamadı`;
}

/** Stornolanan sayım tutanağının VOID gerekçesi — storno ve lazy-init aynı metni basar. */
export function stockCountVoidReason(reverseReason: string | null): string {
  return `Storno: ${reverseReason ?? ""}`.trim().slice(0, 300);
}

function statusLabel(s: StockCountStatus): string {
  switch (s) {
    case StockCountStatus.DRAFT:
      return "taslak";
    case StockCountStatus.COMPLETED:
      return "tamamlanmış";
    case StockCountStatus.CANCELLED:
      return "iptal edilmiş";
  }
}

/**
 * Topun kayıttan DÜŞÜLEBİLİR olup olmadığı — engel varsa SOMUT sebebi, yoksa
 * `null`. TEK KAYNAK: hem tamamlama öncesi kapsam kontrolü hem yarış kaybedeninin
 * tanısı bunu çağırır. Kopyalansaydı iki yol aynı topa iki farklı cevap verirdi.
 *
 * ⚠️ "İşlenemedi" demek YETMEZ — kâğıda bakan kişi nedenini görmeli (yıkıcı
 * işlem kuralının okuma yönü); sessiz atlama fark fişini eksik yazar ve kimse
 * nedenini bilmez.
 */
function blockReason(
  roll: {
    status: RollStatus;
    warehouseId: string | null;
    sackId: string | null;
    shipmentId: string | null;
    currentStepId: string | null;
  },
  countWarehouseId: string,
): string | null {
  if (roll.status === RollStatus.SHIPPED) return "Bu sırada sevk edildi";
  if (roll.status === RollStatus.CANCELLED || roll.status === RollStatus.SCRAP) {
    return "Zaten kayıttan düşülmüş";
  }
  if (!COUNTABLE_ROLL_STATUSES.includes(roll.status)) {
    // ⚠️ TÜRKÇE ZORUNLU — bu metin `outOfScopeReason` kolonuna YAZILIR ve
    // sayım tutanağı DONDURULUR (`warehouse-doc.html`): ham enum bir kez
    // kâğıda basıldığında geriye dönük düzeltilemez. Diğer altı dal zaten
    // Türkçe; tek sırıtan bu satırdı.
    return `Statüsü değişti (${ROLL_STATUS_TR[roll.status]})`;
  }
  if (roll.warehouseId !== countWarehouseId) return "Bu sırada başka depoya taşındı";
  if (roll.shipmentId) return "Bu sırada bir sevkiyata atandı";
  if (roll.sackId) return "Çuvalın içinde — önce çuvaldan çıkarılmalı";
  if (roll.currentStepId) return "Bu sırada bir iş emrine bağlandı";
  return null;
}

// ---------------------------------------------------------------------------
// BELGE BUILDER — stok sayım tutanağı
// ---------------------------------------------------------------------------
// ⚠️ Kayıt IMPORT YAN ETKİSİYLE oluşur (routes → bu servis). Bekçilerde import
// satırı yoksa registry boş kalır ve testler vakumen yeşile döner.
//
// ⚠️ DONMUŞ BELGE YALNIZ `COMPLETED` SAYIMDA DOĞAR — `fresh` diğer iki statüde
// `null` döner. Bu kural TEK bir `!==` gibi görünüyor ama ilk yazımda `DRAFT`
// eleniyordu ve delik CANLI DB'DE ÖLÇÜLDÜ: `getCurrent` donmuş kayıt yoksa
// `fresh`i çağırıp sonucu KALICI yazıyor (`printed-document.service` lazy-init;
// `getHtml` de aynı yoldan geçer) → İPTAL EDİLMİŞ bir sayımın tutanağı
// **v1/ACTIVE/reconstructed** olarak doğuyor, üstelik `voidInfo: null` olduğu
// için İPTAL filigranı da basılmıyordu. Somut zarar: hiçbir deftere yazmamış,
// envanterde CANLI duran toplar için "EKSİK — KAYITTAN DÜŞÜLDÜ" diyen resmi bir
// kâğıt. Panelde de erişilebilirdi ("Tutanağı Görüntüle" düğmesi her statüde
// çizilir ve diyalog açılışta `getCurrent` çağırır).
//
// ⚠️ ÖNİZLEME (`buildPreview`) HER STATÜDE ÇALIŞIR ve bu bilinçli: sayım
// listesi bir ÇALIŞMA KÂĞIDIDIR, sayan kişi onu tamamlamadan eline alabilmeli;
// iptal edilmiş sayımda da "ne sayılmıştı" sorusunun cevabı gerekir. Önizleme
// hiçbir yere YAZILMAZ ve TASLAK filigranı taşır. Yalanı önleyen şey `header
// .finalized`: fark UYGULANMADIKÇA satır "kayıttan düşüldü" diye basılmaz.

registerPrintedDocBuilder(PrintedDocType.STOCK_COUNT, {
  fresh: async (db, sourceId) => buildStockCountDoc(db, sourceId, false),
  // Taslak önizleme: aynı içerik, "TASLAK" filigranıyla. Sayan kişi kâğıdı
  // tamamlamadan ELİNE ALABİLMELİ (sayım listesi zaten bir çalışma kâğıdıdır).
  buildPreview: async (db, sourceId) => buildStockCountDoc(db, sourceId, true),
  renderHtml: renderStockCountHtml,
});

async function buildStockCountDoc(
  db: PrintedDocDb,
  sourceId: string,
  allowDraft: boolean,
): Promise<{ documentNo: string; doc: Record<string, unknown>; voidInfo: { reason: string | null; at: Date } | null } | null> {
  const count = await db.stockCount.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      countNo: true,
      status: true,
      notes: true,
      createdAt: true,
      completedAt: true,
      reversedAt: true,
      reverseReason: true,
      createdById: true,
      completedById: true,
      warehouse: { select: { code: true, name: true } },
      lines: {
        select: {
          id: true,
          kind: true,
          expectedQty: true,
          countedQty: true,
          found: true,
          notes: true,
          outOfScopeReason: true,
          roll: {
            select: {
              barcode: true,
              width: true,
              // Fark fişinin GERÇEKTEN yazdığı metraj — `expectedQty` (fotoğraf)
              // ile ayrışabilir; gerekçe aşağıda `appliedQty` hesabında.
              currentQty: true,
              item: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
          item: { select: { name: true } },
        },
        orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!count) return null;
  // ⚠️ `!== COMPLETED`, `=== DRAFT` DEĞİL — gerekçe yukarıdaki blokta (iptal
  // edilmiş sayım lazy-init ile ACTIVE resmi belge doğuruyordu).
  if (!allowDraft && count.status !== StockCountStatus.COMPLETED) return null;
  /** Fark fişi UYGULANDI mı — belgedeki her "düşüldü" ifadesinin ön koşulu. */
  const finalized = count.status === StockCountStatus.COMPLETED;

  const userIds = [count.createdById, count.completedById].filter(Boolean) as string[];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, username: true },
      })
    : [];
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u?.fullName ?? u?.username ?? null;
  };

  const rollLines: StockCountDocRollLine[] = [];
  const yarnLines: StockCountDocYarnLine[] = [];
  let expectedMeters = 0;
  let missingMeters = 0;
  let rollFound = 0;
  let rollMissing = 0;
  let rollUncounted = 0;
  let rollOutOfScope = 0;
  let yarnApplied = 0;
  let yarnUncounted = 0;
  let yarnOutOfScope = 0;
  let yarnDiffKg = new Prisma.Decimal(0);

  for (const l of count.lines) {
    if (l.kind === StockCountLineKind.ROLL) {
      const expected = Number(l.expectedQty);
      expectedMeters += expected;
      // ⚠️ DURUM SIRASI: "kapsam dışı" EN ÖNCE sorulur — o satır `found=false`
      // taşır (eksik işaretlendi) ama İŞLENMEDİ. Sıra ters olsaydı belge onu
      // "kayıttan düşüldü" diye basar ve kâğıt YALAN söylerdi.
      const state: StockCountDocRollLine["state"] = l.outOfScopeReason
        ? "OUT_OF_SCOPE"
        : l.found === false
          ? "MISSING"
          : l.found === true
            ? "FOUND"
            : "UNCOUNTED";
      // ⚠️ KAYITTAN DÜŞÜLEN METRAJ FOTOĞRAFTAN OKUNMAZ — topun KENDİ metrajından
      // okunur. `expectedQty` sayımın AÇILDIĞI andaki defter değeridir; fark
      // fişi ise tamamlama anındaki (tx içinde pinlenmiş) `currentQty`yi iki
      // deftere yazar. İkisi meşru yollarla ayrışır: `inventory.adjustRollQty`
      // (G4 depo metraj düzeltmesi) TAM AYNI statü kümesinde çalışır ve sayım
      // sırasında kullanılması BEKLENEN araçtır; depo topu kesilirse
      // `cutWarehouseRoll` de metrajı düşürüp topu WAREHOUSE'ta bırakır. Fotoğraf
      // toplanırsa resmi kâğıt, kendisini doğuran işlemin sapma defterine
      // yazdığı rakamdan FARKLI bir rakam söyler (700 ↔ 600) — donmuş belge
      // disiplininin tam tersi. Uygulanmamış (taslak/iptal) sayımda düşülen bir
      // metraj YOKTUR → `null`, beklenene düşülür.
      const appliedQty =
        finalized && state === "MISSING" && l.roll?.currentQty != null
          ? Number(l.roll.currentQty)
          : null;
      if (state === "OUT_OF_SCOPE") rollOutOfScope++;
      else if (state === "MISSING") {
        rollMissing++;
        missingMeters += appliedQty ?? expected;
      } else if (state === "FOUND") rollFound++;
      else rollUncounted++;

      rollLines.push({
        barcode: l.roll?.barcode ?? null,
        itemName: l.roll?.item?.name ?? "—",
        colorName: l.roll?.color?.name ?? null,
        width: l.roll?.width != null ? Number(l.roll.width) : null,
        expectedQty: expected,
        countedQty: l.countedQty != null ? Number(l.countedQty) : null,
        appliedQty,
        state,
        outOfScopeReason: l.outOfScopeReason,
        notes: l.notes,
      });
      continue;
    }

    const expectedKg = new Prisma.Decimal(l.expectedQty);
    const countedKg = l.countedQty != null ? new Prisma.Decimal(l.countedQty) : null;
    const diff = countedKg ? countedKg.minus(expectedKg) : null;
    const state: StockCountDocYarnLine["state"] = l.outOfScopeReason
      ? "OUT_OF_SCOPE"
      : countedKg == null
        ? "UNCOUNTED"
        : diff!.isZero()
          ? "MATCH"
          : "APPLIED";
    if (state === "OUT_OF_SCOPE") yarnOutOfScope++;
    else if (state === "UNCOUNTED") yarnUncounted++;
    else if (state === "APPLIED") {
      yarnApplied++;
      yarnDiffKg = yarnDiffKg.plus(diff!);
    }

    yarnLines.push({
      itemName: l.item?.name ?? "—",
      expectedKg: Number(expectedKg),
      countedKg: countedKg ? Number(countedKg) : null,
      // ⚠️ Kapsam dışı satırda FARK BASILMAZ (`null`): hesaplanmış ama
      // UYGULANMAMIŞ bir sayı, kâğıtta uygulanmış gibi okunurdu.
      diffKg: state === "OUT_OF_SCOPE" || diff == null ? null : Number(diff),
      state,
      outOfScopeReason: l.outOfScopeReason,
    });
  }

  const doc: StockCountDoc = {
    header: {
      documentNo: count.countNo,
      date: (count.completedAt ?? count.createdAt).toISOString(),
      warehouseName: count.warehouse.name,
      warehouseCode: count.warehouse.code,
      createdBy: nameOf(count.createdById),
      completedBy: nameOf(count.completedById),
      status: statusLabel(count.status).toUpperCase(),
      finalized,
    },
    rollLines,
    yarnLines,
    summary: {
      rollTotal: rollLines.length,
      rollFound,
      rollMissing,
      rollUncounted,
      rollOutOfScope,
      expectedMeters,
      missingMeters,
      yarnTotal: yarnLines.length,
      yarnApplied,
      yarnUncounted,
      yarnOutOfScope,
      yarnDiffKg: Number(yarnDiffKg),
    },
    notes: count.notes,
  };

  return {
    documentNo: count.countNo,
    doc: doc as unknown as Record<string, unknown>,
    // İptal yalnız DRAFT'ta (belge doğmamış); VOID yalnız stornodan gelir.
    voidInfo: count.reversedAt
      ? { reason: stockCountVoidReason(count.reverseReason), at: count.reversedAt }
      : null,
  };
}
