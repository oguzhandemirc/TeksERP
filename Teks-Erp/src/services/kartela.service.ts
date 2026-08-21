// =============================================================================
// TeksERP - Kartela (Swatch) Fason Service
// =============================================================================
// Üretim fasonundan AYRI, İŞ EMRİSİZ akış. Bkz. docs/design/KARTELA-TASARIM.md.
//
//   dispatch()       : Depodaki bitmiş toplar kartela firmasına sevk edilir.
//                      Roll.status WAREHOUSE → AT_KARTELA.
//   cancelDispatch() : Sevk soft-cancel; toplar WAREHOUSE'a döner.
//   receive()        : Firmadan dönen kartelalar kabul edilir. Her orijinal top
//                      KARTELA_CONSUMED'a çekilir (komple tükenir) ve N adet
//                      Swatch (SW-) doğar. Uzunluk(cm)+ağırlık(kg) opsiyonel;
//                      toplu (bulk) veya tek-tek (items) girilebilir.
//   cancelReceipt()  : Kabul soft-cancel; doğan kartelalar geri alınır (soft),
//                      toplar AT_KARTELA'ya döner.
//
// Refakat kartı / WO step mantığı YOK — kartela bitmiş üründen üretilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { Prisma, PrintedDocType, RollStatus } from "@prisma/client";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import { renderKartelaCekiHtml } from "./document-render/kartela-ceki.html";
import { sackBlockMessage } from "./helpers/sack-invariants.helper";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { buildPagination, buildTextSearch, readIdCondition } from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Liste filtre/sayfalama parametreleri — hem offset (mobil) hem cursor (admin)
// modunu besler. cursor||mode==="cursor" → cursor response; aksi halde offset.
interface KartelaListParams {
  subcontractorId?: string;
  /**
   * Durum filtresi:
   *   active   (default) — iptal edilmemiş (cancelledAt null)
   *   open     — iptal edilmemiş VE henüz kabul edilmemiş (iptal edilebilir)
   *   received — iptal edilmemiş VE kabul edilmiş
   *   cancelled — iptal edilmiş
   *   all      — hepsi
   */
  status?: "active" | "open" | "received" | "cancelled" | "all";
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  // offset (mobil)
  page?: number;
  pageSize?: number;
  // cursor (admin/useDataTable)
  cursor?: string;
  mode?: string;
  limit?: number;
  withTotal?: boolean;
}

type ListResult = {
  success: true;
  data: unknown[];
  pagination: Record<string, unknown>;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Kartela sevk/kabul belge no sequence (KS/KK + GGAAYY + NNNN). */
async function nextKartelaDocSequence(
  tx: Prisma.TransactionClient,
  kind: "dispatch" | "receipt",
  prefix: string,
  date: Date
): Promise<number> {
  const docPrefix = dailyCodePrefix(prefix, date); // PREFIX + GGAAYY

  // O-21: gte (index seek) + startsWith (collation-bağımsız tam-prefix) + JS sayısal
  // max. Eski startsWith-tek + orderBy desc glibc collation sırasına/lex taşmaya
  // güveniyordu (glibc seq-no bug — order.service.ts deseni).
  let nos: string[];
  if (kind === "dispatch") {
    const rows = await tx.kartelaDispatch.findMany({
      where: { dispatchNo: { gte: docPrefix, startsWith: docPrefix } },
      select: { dispatchNo: true },
    });
    nos = rows.map((r) => r.dispatchNo);
  } else {
    const rows = await tx.kartelaReceipt.findMany({
      where: { receiptNo: { gte: docPrefix, startsWith: docPrefix } },
      select: { receiptNo: true },
    });
    nos = rows.map((r) => r.receiptNo);
  }
  return nextDailySeq(nos, docPrefix);
}

/** KRT kartela/numune kodu sequence (KRT + GGAAYY + NNNN; barcode = cardNumber). */
async function nextSwatchSequence(
  tx: Prisma.TransactionClient,
  date: Date
): Promise<number> {
  const codePrefix = dailyCodePrefix("KRT", date); // KRT + GGAAYY
  // O-21: gte + startsWith (tam-prefix) + sayısal max — tek collation-top satıra
  // güvenmek yerine günün tüm kodlarının sayısal max'ı.
  const rows = await tx.swatch.findMany({
    where: { cardNumber: { gte: codePrefix, startsWith: codePrefix } },
    select: { cardNumber: true },
  });
  return nextDailySeq(rows.map((r) => r.cardNumber), codePrefix);
}

// -----------------------------------------------------------------------------
// Input types
// -----------------------------------------------------------------------------

export interface KartelaDispatchInput {
  subcontractorId: string;
  rollIds: string[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface KartelaReceiveReturn {
  rollId: string;
  /** Bu toptan dönen kartela adedi (1 top → N kartela). */
  count: number;
  /** Toplu ölçüm — bu toptan doğan TÜM kartelalara uygulanır. */
  bulkLengthCm?: number | null;
  bulkWeightKg?: number | null;
  /** Tek-tek ölçüm — varsa length === count olmalı; bulk'u ezer. */
  items?: Array<{ lengthCm?: number | null; weightKg?: number | null }>;
  notes?: string | null;
}

export interface KartelaReceiveInput {
  subcontractorId: string;
  dispatchId?: string | null;
  manifestNo?: string | null;
  notes?: string | null;
  returns: KartelaReceiveReturn[];
}

/** Kartela stoğu: müsait (sevke girmemiş) kartelaların ürün+renk bazında sayımı.
 *  Sevkiyatta "kartela seç + adet" picker'ını besler. */
export interface KartelaStockGroup {
  itemId: string;
  itemCode: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  count: number;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class KartelaService {
  // ===========================================================================
  // DISPATCH — Depodaki bitmiş topları kartela firmasına sevk
  // ===========================================================================
  async dispatch(
    data: KartelaDispatchInput,
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (!data.rollIds || data.rollIds.length === 0) {
      throw AppError.badRequest("En az bir top seçmelisiniz");
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true, isActive: true },
    });
    if (!subcontractor) throw AppError.notFound("Kartela firması bulunamadı");
    // Soft-delete guard: pasife alınmış firmaya yeni kartela sevki açılamaz.
    if (!subcontractor.isActive) throw AppError.badRequest("Kartela firması pasif durumda");

    // F172: mükerrer top kimliği guard'ı (receive() ile simetri) — { in } dedup ettiğinden
    // aksi halde N istenen ama 1 top bulunup sessizce/parite hatasıyla ilerlerdi.
    if (new Set(data.rollIds).size !== data.rollIds.length) {
      throw AppError.badRequest("Aynı top birden fazla kez girilemez");
    }

    // F176: yalnız kullanılan alanlar — item/color include'u hiç okunmuyordu
    // (validasyon + item create sadece id/barcode/status/shipmentId/currentQty/weightKg
    // kullanıyor; yanıt `result`, bu `rolls` değil).
    const rolls = await prisma.roll.findMany({
      where: { id: { in: data.rollIds } },
      select: {
        id: true,
        barcode: true,
        status: true,
        shipmentId: true,
        // Çuval üyeliği + kod: aşağıdaki çuval guard'ı için (operatöre HANGİ çuval
        // olduğunu söylemek gerekiyor, yoksa "bir çuvalda" mesajı sahada işe yaramaz).
        sackId: true,
        sack: { select: { sackNo: true } },
        currentQty: true,
        weightKg: true,
      },
    });
    if (rolls.length !== data.rollIds.length) {
      const foundIds = new Set(rolls.map((r) => r.id));
      const missing = data.rollIds.filter((id) => !foundIds.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // IDEMPOTENCY: offline replay — aynı firma + aynı toplarla açık (kabul edilmemiş)
    // bir sevk varsa onu döndür. WAREHOUSE guard'ından ÖNCE: replay'de toplar zaten
    // AT_KARTELA olduğundan guard'a takılmadan cached sevk dönmeli.
    const openDispatch = await prisma.kartelaDispatch.findFirst({
      where: {
        subcontractorId: data.subcontractorId,
        cancelledAt: null,
        items: {
          some: { rollId: { in: data.rollIds }, receiptItems: { none: {} } },
        },
      },
      include: { items: { select: { rollId: true } } },
    });
    if (openDispatch) {
      const existing = new Set(openDispatch.items.map((i) => i.rollId));
      const incoming = new Set(data.rollIds);
      const sameRolls =
        existing.size === incoming.size &&
        [...existing].every((id) => incoming.has(id));
      if (sameRolls) {
        return {
          success: true,
          data: openDispatch as unknown as Record<string, unknown>,
          message: `Kartela sevki zaten oluşturulmuş (idempotent): ${openDispatch.dispatchNo}`,
        };
      }
    }

    // Sadece depodaki (WAREHOUSE) ve sevkiyata girmemiş bitmiş toplar kartelaya gider.
    for (const r of rolls) {
      if (r.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} kartelaya gönderilemez (durum: ${r.status}). Sadece depodaki bitmiş toplar.`
        );
      }
      if (r.shipmentId) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} bir sevkiyatta — önce sevkiyattan çıkarın.`
        );
      }
      // ÇUVAL GUARD'I (2026-07-30): "çuvalda mı?" sorusunun cevabı `sackId`'dir.
      // Üstteki `shipmentId` kontrolü YALNIZ sevkiyata ATANMIŞ çuvalı yakalar; DEPO
      // çuvalındaki topun `shipmentId`'si NULL olduğu için serbest sanılıyordu →
      // top AT_KARTELA olup çuvalda kalıyor, çuval etiketi onu saymıyor ama irsaliye
      // sayıyor, sevkte statü SHIPPED'e eziliyor (çift tüketim + şişmiş donmuş belge).
      // OTOMATİK ÇIKARMIYORUZ: çıkarmak `markSackContentChangedTx` ile çuvalın brüt
      // kg'sini siler (operatörün kantar ölçümü) + çuval etiketini bayat işaretler →
      // yıkıcı, açık onay ister ve bu ekran onu soramaz.
      // Emsal: `workorder.service.attachRolls` (F5) reddeder, çıkarmaz.
      if (r.sackId) {
        throw AppError.badRequest(
          sackBlockMessage(r.barcode ?? r.id, r.sack?.sackNo ?? null, "kartelaya gönderilemez")
        );
      }
    }

    const totalQty = rolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0)
    );

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const seq = await nextKartelaDocSequence(tx, "dispatch", "KS", now);
        const dispatchNo = buildDailyCode("KS", seq, now);

        const dispatch = await tx.kartelaDispatch.create({
          data: {
            dispatchNo,
            subcontractorId: data.subcontractorId,
            plateNumber: data.plateNumber ?? null,
            driverName: data.driverName ?? null,
            dispatchedById: userId ?? null,
            notes: data.notes ?? null,
            totalQty,
            items: {
              create: rolls.map((r) => ({
                rollId: r.id,
                dispatchedQty: r.currentQty,
                dispatchedWeight: r.weightKg,
              })),
            },
          },
          include: { items: true, subcontractor: true },
        });

        // RESMİ BELGE — kartela çeki listesi v1 BURADA donar (PrintedDocument).
        // Builder az önce yaratılan dispatch+item'ları aynı tx içinden okur;
        // kaynak sonradan değişse bile belge sabit kalır. Düzeltme = reissue.
        await printedDocumentService.freezeForSource(
          tx,
          PrintedDocType.KARTELA_DISPATCH,
          dispatch.id,
          userId
        );

        // ATOMIK SAHİPLENME: toplar hâlâ depoda (WAREHOUSE), bir sevkiyata bağlı
        // DEĞİL (shipmentId null) VE bir çuvalda DEĞİLSE (sackId null) AT_KARTELA'ya
        // çek. Okuma ile yazma arasında biri (çuvala okutma / sevkiyat / başka kartela
        // sevki) kapmışsa count < beklenen olur → tüm tx geri sarılır (KartelaDispatch
        // da oluşmaz), çift-bağ engellenir. `sackId: null` yukarıdaki pre-check'in
        // tx-içi ikizidir: pre-check yarışı kapatmaz, bu WHERE kapatır.
        const claimed = await tx.roll.updateMany({
          where: {
            id: { in: data.rollIds },
            status: RollStatus.WAREHOUSE,
            shipmentId: null,
            sackId: null,
          },
          data: { status: RollStatus.AT_KARTELA },
        });
        if (claimed.count !== data.rollIds.length) {
          throw AppError.conflict(
            "Toplardan biri az önce başka bir akışa girdi (çuvala okutma/sevkiyat/başka kartela sevki) — tekrar deneyin."
          );
        }

        return dispatch;
      })
    );

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "KARTELA_DISPATCH",
      recordId: result.id,
      newData: {
        dispatchNo: result.dispatchNo,
        subcontractorId: data.subcontractorId,
        rollCount: rolls.length,
        totalQty,
      },
    });

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: `Kartela sevki oluşturuldu: ${result.dispatchNo} (${rolls.length} top, ${totalQty.toFixed(1)}m)`,
    };
  }

  // ===========================================================================
  // CANCEL DISPATCH — Sevk iptali (soft cancel)
  // ===========================================================================
  async cancelDispatch(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim();
    if (!trimmed || trimmed.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.kartelaDispatch.findUnique({
      where: { id: dispatchId },
      include: { items: { select: { rollId: true } } },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    if (dispatch.cancelledAt) throw AppError.conflict("Bu sevk zaten iptal edilmiş");

    // Kabul yapılmış sevk iptal edilemez (önce kabulü iptal et).
    const accepted = await prisma.kartelaReceiptItem.findFirst({
      where: {
        sourceDispatchItem: { is: { dispatchId } },
        receipt: { cancelledAt: null },
      },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (accepted?.receipt) {
      throw AppError.conflict(
        `Kabul yapılmış sevk iptal edilemez (kabul: ${accepted.receipt.receiptNo}). Önce kabulü iptal edin.`
      );
    }

    const rollIds = dispatch.items.map((i) => i.rollId);

    // Defansif: toplar hâlâ AT_KARTELA olmalı (kabul/manuel müdahale sonrası taşınmamış).
    const movedRolls = await prisma.roll.findMany({
      where: { id: { in: rollIds }, status: { not: RollStatus.AT_KARTELA } },
      select: { id: true, barcode: true, status: true },
    });
    if (movedRolls.length > 0) {
      throw AppError.conflict(
        `${movedRolls.length} top sevkten sonra taşınmış/statüsü değişmiş — sevk iptal edilemez.`,
        {
          code: "ROLLS_MOVED_PAST_DISPATCH",
          movedRolls,
        }
      );
    }

    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: cancelledAt kontrolü tx DIŞINDA — eşzamanlı çift iptalin
      // kaybedeni burada 409 alır.
      const cancelClaim = await tx.kartelaDispatch.updateMany({
        where: { id: dispatchId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmed,
        },
      });
      if (cancelClaim.count === 0) {
        throw AppError.conflict("Bu sevk az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }
      // RESMİ BELGE — çeki listesi VOIDED'e çekilir (baskıda İPTAL filigranı).
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.KARTELA_DISPATCH,
        dispatchId,
        trimmed
      );
      // ATOMİK CLAIM (dispatch()'teki desenin aynası): movedRolls kontrolü tx
      // DIŞINDA — pencerede kabul/başka işlem araya girdiyse count uyuşmaz →
      // 409 + rollback (toplar kabul edilmişken depoya dönmesin).
      const reverted = await tx.roll.updateMany({
        where: { id: { in: rollIds }, status: RollStatus.AT_KARTELA },
        data: { status: RollStatus.WAREHOUSE },
      });
      if (reverted.count !== rollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle değişmiş — sevk iptal edilemedi. Listeyi yenileyip tekrar deneyin."
        );
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KARTELA_DISPATCH",
      recordId: dispatchId,
      newData: {
        cancelled: true,
        cancelReason: trimmed,
        rolledBackRollCount: rollIds.length,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Sevk iptal edildi: ${dispatch.dispatchNo}`,
    };
  }

  // ===========================================================================
  // RECEIVE — Kartela mal kabul (top komple tükenir → N kartela doğar)
  // ===========================================================================
  async receive(
    data: KartelaReceiveInput,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.returns || data.returns.length === 0) {
      throw AppError.badRequest("En az bir dönen top girmelisiniz");
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true, isActive: true },
    });
    if (!subcontractor) throw AppError.notFound("Kartela firması bulunamadı");
    // Soft-delete guard: pasife alınmış firmadan kartela kabulü yapılamaz.
    if (!subcontractor.isActive) throw AppError.badRequest("Kartela firması pasif durumda");

    // F169: Bilgi amaçlı dispatch bağı verildiyse var-mı + iptal-değil + firma-tutarlı
    // olsun (soft-delete/iptal giriş guard'ı deseni). Yanlış/iptal/yabancı bir dispatchId
    // belgeyi ve dispatch↔receipt görünümünü bozar; var-olmayan ID tx içinde ham P2003 verir.
    if (data.dispatchId) {
      const dispatch = await prisma.kartelaDispatch.findUnique({
        where: { id: data.dispatchId },
        select: { id: true, cancelledAt: true, subcontractorId: true },
      });
      if (!dispatch) throw AppError.notFound("Kartela sevki bulunamadı");
      if (dispatch.cancelledAt) {
        throw AppError.conflict("İptal edilmiş kartela sevkine kabul yapılamaz");
      }
      if (dispatch.subcontractorId !== data.subcontractorId) {
        throw AppError.badRequest("Kartela sevki bu firmaya ait değil");
      }
    }

    // Doğrula: adet + ölçüm tutarlılığı
    for (const ret of data.returns) {
      if (!Number.isInteger(ret.count) || ret.count <= 0) {
        throw AppError.badRequest("Her top için kartela adedi pozitif tam sayı olmalı");
      }
      if (ret.items && ret.items.length !== ret.count) {
        throw AppError.badRequest(
          `Tek-tek ölçüm sayısı (${ret.items.length}) kartela adedi (${ret.count}) ile eşleşmeli`
        );
      }
    }

    const rollIds = data.returns.map((r) => r.rollId);
    if (new Set(rollIds).size !== rollIds.length) {
      throw AppError.badRequest("Aynı top birden fazla kez girilemez");
    }

    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
      },
    });
    if (rolls.length !== rollIds.length) {
      const found = new Set(rolls.map((r) => r.id));
      const missing = rollIds.filter((id) => !found.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // IDEMPOTENCY: tüm toplar zaten KARTELA_CONSUMED ise ve tek bir iptal-edilmemiş
    // receipt'e aitse onu döndür (offline replay). Kısmi tüketim = gerçek çakışma.
    const consumed = rolls.filter((r) => r.status === RollStatus.KARTELA_CONSUMED);
    if (consumed.length === rolls.length) {
      const existingItems = await prisma.kartelaReceiptItem.findMany({
        where: {
          consumedRollId: { in: rollIds },
          receipt: { cancelledAt: null },
        },
        select: { receiptId: true },
      });
      const receiptIds = new Set(existingItems.map((i) => i.receiptId));
      if (receiptIds.size === 1) {
        const receiptId = [...receiptIds][0];
        const rec = await prisma.kartelaReceipt.findUnique({ where: { id: receiptId } });
        // F173: idempotent replay YALNIZ tam eşleşmede — aynı firma + birebir aynı
        // top kümesi. Aksi halde (farklı firma, kısmi ya da fazladan top) gerçek
        // çakışmadır → aşağıdaki 409 ile net reddet, sessizce "kaydedildi" gösterme.
        if (rec && rec.subcontractorId === data.subcontractorId) {
          const receiptRolls = await prisma.kartelaReceiptItem.findMany({
            where: { receiptId },
            select: { consumedRollId: true },
          });
          const incoming = new Set(rollIds);
          const sameRolls =
            receiptRolls.length === incoming.size &&
            receiptRolls.every((r) => incoming.has(r.consumedRollId));
          if (sameRolls) {
            return {
              success: true,
              data: rec,
              message: `Kartela kabulü zaten yapılmış (idempotent): ${rec.receiptNo}`,
            };
          }
        }
      }
      throw AppError.conflict("Bu toplar zaten kartela olarak kabul edilmiş.");
    }

    // Tüm toplar AT_KARTELA olmalı; firma da bu topların açık sevkindeki firma olmalı.
    const dispatchItems = await prisma.kartelaDispatchItem.findMany({
      where: {
        rollId: { in: rollIds },
        dispatch: { cancelledAt: null },
      },
      select: {
        id: true,
        rollId: true,
        dispatch: { select: { id: true, subcontractorId: true } },
      },
    });
    const dispatchItemByRoll = new Map(dispatchItems.map((di) => [di.rollId, di]));

    for (const r of rolls) {
      if (r.status !== RollStatus.AT_KARTELA) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} kabul edilemez (durum: ${r.status}). Sadece kartelada (AT_KARTELA) toplar.`
        );
      }
      const di = dispatchItemByRoll.get(r.id);
      if (!di) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} için açık kartela sevki bulunamadı.`
        );
      }
      if (di.dispatch.subcontractorId !== data.subcontractorId) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} bu firmaya ait kartela sevkinde değil.`
        );
      }
    }

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const seq = await nextKartelaDocSequence(tx, "receipt", "KK", now);
        const receiptNo = buildDailyCode("KK", seq, now);

        const receipt = await tx.kartelaReceipt.create({
          data: {
            receiptNo,
            manifestNo: data.manifestNo ?? null,
            dispatchId: data.dispatchId ?? null,
            subcontractorId: data.subcontractorId,
            receivedById: userId ?? null,
            notes: data.notes ?? null,
          },
        });

        const rollById = new Map(rolls.map((r) => [r.id, r]));

        // Sıra numarasını döngü DIŞINDA bir kez oku; tüm kartelalara bellekte
        // ardışık ata (seq, seq+1, ...). Eski kod her kartela için ayrı
        // nextSwatchSequence taraması + tek-tek create yapıyordu (N+1 + yavaş).
        // P2002 çakışmasında withBarcodeRetry tx'i baştan dener → sıra yeniden okunur.
        let seqCounter = await nextSwatchSequence(tx, now);

        const receiptItemData: Prisma.KartelaReceiptItemCreateManyInput[] = [];
        const swatchData: Prisma.SwatchCreateManyInput[] = [];
        const consumedRollIds: string[] = [];

        for (const ret of data.returns) {
          const roll = rollById.get(ret.rollId)!;
          const di = dispatchItemByRoll.get(ret.rollId)!;

          receiptItemData.push({
            receiptId: receipt.id,
            consumedRollId: roll.id,
            sourceDispatchItemId: di.id,
            kartelaCount: ret.count,
            notes: ret.notes ?? null,
          });
          consumedRollIds.push(roll.id);

          // N adet kartela doğar (bellekte hazırlanır, aşağıda tek createMany).
          for (let i = 0; i < ret.count; i++) {
            const sSeq = seqCounter++;
            const measure = ret.items?.[i];
            swatchData.push({
              // Tek kod: insan-okur cardNumber = tarama barcode (KRT + GGAAYY + NNNN)
              cardNumber: buildDailyCode("KRT", sSeq, now),
              barcode: buildDailyCode("KRT", sSeq, now),
              itemId: roll.itemId,
              colorId: roll.colorId ?? null,
              width: roll.width ?? null,
              length: measure?.lengthCm ?? ret.bulkLengthCm ?? null,
              weightKg: measure?.weightKg ?? ret.bulkWeightKg ?? null,
              parentReceiptId: receipt.id,
              parentRollId: roll.id,
              createdById: userId ?? null,
            });
          }
        }

        // Toplu yazma: tek-tek create yerine createMany / updateMany.
        await tx.kartelaReceiptItem.createMany({ data: receiptItemData });
        // ATOMİK CLAIM (dispatch()'teki desenin aynası): AT_KARTELA ön-kontrolü
        // tx DIŞINDA — iki eşzamanlı kabul ikisinde de geçerdi ve withBarcodeRetry
        // receiptNo/SW-barkod P2002'sinde tx'i ön-kontrolsüz tekrar deneyip yarışı
        // BAŞARILI çift makbuz+çift kartelaya çevirirdi. Statü koşulu + count ile
        // kaybeden 409 alır (conflict P2002 olmadığından retry'a girmez).
        const consumedClaim = await tx.roll.updateMany({
          where: { id: { in: consumedRollIds }, status: RollStatus.AT_KARTELA },
          data: { status: RollStatus.KARTELA_CONSUMED },
        });
        if (consumedClaim.count !== consumedRollIds.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada başka bir işlemle (kabul/iptal) değişmiş. Listeyi yenileyip tekrar deneyin."
          );
        }
        await tx.swatch.createMany({ data: swatchData });

        return { receipt, totalSwatches: swatchData.length };
      })
    );

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "KARTELA_RECEIPT",
      recordId: result.receipt.id,
      newData: {
        receiptNo: result.receipt.receiptNo,
        subcontractorId: data.subcontractorId,
        consumedRollCount: rolls.length,
        swatchCount: result.totalSwatches,
      },
    });

    return {
      success: true,
      data: result.receipt,
      message: `Kartela kabulü yapıldı: ${result.receipt.receiptNo} (${rolls.length} top → ${result.totalSwatches} kartela)`,
    };
  }

  // ===========================================================================
  // CANCEL RECEIPT — Kabul iptali (doğan kartelalar soft geri alınır)
  // ===========================================================================
  /** İptal önizleme — doğan kartelaların downstream (sevkiyat/çuval) bağ kontrolü. */
  async getReceiptCancelPreview(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id },
      include: {
        swatches: {
          where: { cancelledAt: null },
          select: {
            id: true,
            cardNumber: true,
            barcode: true,
            shipmentId: true,
            sackId: true,
            item: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");

    const swatches = receipt.swatches.map((s) => {
      const blockingReasons: string[] = [];
      if (s.shipmentId) blockingReasons.push("Bir sevkiyatta");
      if (s.sackId) blockingReasons.push("Bir çuvalda");
      return { ...s, blockingReasons, safeToCancel: blockingReasons.length === 0 };
    });

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        cancellable: swatches.every((s) => s.safeToCancel),
        swatches,
      },
    };
  }

  async cancelReceipt(
    receiptId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim();
    if (!trimmed || trimmed.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id: receiptId },
      include: {
        items: { select: { consumedRollId: true } },
        swatches: {
          where: { cancelledAt: null },
          select: { id: true, shipmentId: true, sackId: true, cardNumber: true },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");
    if (receipt.cancelledAt) throw AppError.conflict("Bu kabul zaten iptal edilmiş");

    // Downstream bağlı (sevkiyatta/çuvalda) kartela varsa iptal edilemez.
    const blocked = receipt.swatches.filter((s) => s.shipmentId || s.sackId);
    if (blocked.length > 0) {
      throw AppError.conflict(
        `${blocked.length} kartela sevkiyatta/çuvalda — kabul iptal edilemez. Önce sevkiyattan çıkarın.`,
        {
          code: "SWATCHES_DOWNSTREAM",
          blocked: blocked.map((s) => s.cardNumber),
        }
      );
    }

    const rollIds = receipt.items.map((i) => i.consumedRollId);
    const swatchIds = receipt.swatches.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      // Kabul soft-cancel — ATOMİK CLAIM: cancelledAt kontrolü tx DIŞINDA;
      // eşzamanlı çift iptalin kaybedeni burada 409 alır.
      const receiptClaim = await tx.kartelaReceipt.updateMany({
        where: { id: receiptId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmed,
        },
      });
      if (receiptClaim.count === 0) {
        throw AppError.conflict("Bu kabul az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }
      // Doğan kartelalar soft-delete — downstream guard'ı tx DIŞINDA okunduğu
      // için pencerede sevkiyata/çuvala bağlanan kartela varsa iptal etme.
      if (swatchIds.length > 0) {
        const cancelledSwatches = await tx.swatch.updateMany({
          where: { id: { in: swatchIds }, shipmentId: null, sackId: null, cancelledAt: null },
          data: { cancelledAt: new Date(), cancelReason: trimmed },
        });
        if (cancelledSwatches.count !== swatchIds.length) {
          throw AppError.conflict(
            "Kartelalardan biri bu sırada sevkiyata/çuvala bağlanmış — kabul iptal edilemedi. Önce sevkiyattan çıkarın."
          );
        }
      }
      // Tüketilen toplar AT_KARTELA'ya döner (firma hâlâ malı işlemiş sayılır).
      // ATOMİK CLAIM: beklenen statüde değilse (eşzamanlı işlem) 409 + rollback.
      if (rollIds.length > 0) {
        const reverted = await tx.roll.updateMany({
          where: { id: { in: rollIds }, status: RollStatus.KARTELA_CONSUMED },
          data: { status: RollStatus.AT_KARTELA },
        });
        if (reverted.count !== rollIds.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada başka bir işlemle değişmiş — kabul iptali yapılamadı. Listeyi yenileyip tekrar deneyin."
          );
        }
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KARTELA_RECEIPT",
      recordId: receiptId,
      newData: {
        cancelled: true,
        cancelReason: trimmed,
        revertedRollCount: rollIds.length,
        cancelledSwatchCount: swatchIds.length,
      },
    });

    return {
      success: true,
      data: { id: receiptId, receiptNo: receipt.receiptNo },
      message: `Kabul iptal edildi: ${receipt.receiptNo}`,
    };
  }

  // ===========================================================================
  // LISTS & DETAIL
  // ===========================================================================
  async listDispatches(params?: KartelaListParams): Promise<ListResult> {
    // Filtre: firma + durum + tarih(dispatchedAt) + arama(belge no/firma adı).
    // Tüm filtre kolonları indeksli (@@index dispatchedAt / subcontractorId,dispatchedAt).
    const where: Prisma.KartelaDispatchWhereInput = {};
    // Firma ÇOKLU seçilebilir (`?subcontractorId=a,b`). Ham CSV atansaydı Prisma
    // `subcontractorId = "a,b"` arar → uuid kolonu olduğu için P2007 → HTTP 400
    // (arıza modları: query-parser `readIdCondition` notu).
    const subCond = readIdCondition(params?.subcontractorId);
    if (subCond) where.subcontractorId = subCond;
    // "Kabul edilmiş" = en az bir sevk kalemi, iptal edilmemiş bir kabulde tüketilmiş.
    // (cancelDispatch ile aynı kural — receiptItem.sourceDispatchItem üzerinden.)
    const receivedFilter: Prisma.KartelaDispatchWhereInput = {
      items: { some: { receiptItems: { some: { receipt: { cancelledAt: null } } } } },
    };
    const status = params?.status ?? "active";
    if (status === "active") where.cancelledAt = null;
    else if (status === "cancelled") where.cancelledAt = { not: null };
    else if (status === "open") {
      where.cancelledAt = null;
      where.NOT = receivedFilter;
    } else if (status === "received") {
      where.cancelledAt = null;
      where.items = receivedFilter.items;
    }
    if (params?.dateFrom || params?.dateTo) {
      where.dispatchedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    const search = params?.search?.trim();
    if (search) {
      where.OR = buildTextSearch<Prisma.KartelaDispatchWhereInput>(search, {
        text: ["subcontractor.name"],
        code: ["dispatchNo"],
      });
    }

    // Liste için hafif select — detay (`getDispatch`) tam veriyi döner.
    // `receivedProbe`: kabul edilmiş kalem var mı (indeksli, take:1 existence).
    // Mobil kabul dispatchId set etmediği için _count.receipts güvenilmez;
    // "kabul edildi" rozeti bu probe ile hesaplanır (isReceived).
    const select = {
      id: true,
      dispatchNo: true,
      dispatchedAt: true,
      totalQty: true,
      plateNumber: true,
      driverName: true,
      notes: true,
      cancelledAt: true,
      cancelReason: true,
      subcontractor: { select: { id: true, name: true, code: true } },
      dispatchedBy: { select: { id: true, fullName: true } },
      _count: { select: { items: true, receipts: true } },
      // Existence probe: kabul edilmiş kalem var mı (take:1, indeksli).
      items: {
        where: { receiptItems: { some: { receipt: { cancelledAt: null } } } },
        select: { id: true },
        take: 1,
      },
    } as const;

    // Probe array'ini boolean isReceived'a indir, ham relation'ı yanıttan çıkar.
    const withReceived = (r: { items: { id: string }[] }) => {
      const { items: receivedProbe, ...rest } = r;
      return { ...rest, isReceived: receivedProbe.length > 0 };
    };

    // CURSOR mode (admin/useDataTable): keyset by dispatchedAt desc + id desc.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "dispatchedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.kartelaDispatch.findMany({
          where: whereClause,
          select,
          orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.kartelaDispatch.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "dispatchedAt") : null;
      return {
        success: true,
        data: rows.map(withReceived),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (mobil).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const { skip } = buildPagination(page, pageSize);
    const [dispatches, total] = await Promise.all([
      prisma.kartelaDispatch.findMany({
        where,
        select,
        orderBy: { dispatchedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.kartelaDispatch.count({ where }),
    ]);
    return {
      success: true,
      data: dispatches.map(withReceived),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  async getDispatch(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.kartelaDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
        items: {
          include: { roll: { include: { item: true, color: true } } },
        },
        receipts: {
          where: { cancelledAt: null },
          select: { id: true, receiptNo: true, receivedAt: true },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    return { success: true, data: dispatch };
  }

  async listReceipts(params?: KartelaListParams): Promise<ListResult> {
    const where: Prisma.KartelaReceiptWhereInput = {};
    // Firma ÇOKLU (sevk listesiyle aynı sözleşme).
    const subCond = readIdCondition(params?.subcontractorId);
    if (subCond) where.subcontractorId = subCond;
    const status = params?.status ?? "active";
    // F171: controller open/received durumlarını da geçiriyor; bunlar 'active' gibi
    // cancelledAt=null süzülmeli (aksi halde iptaller de listeye sızıyordu). Yalnız
    // 'cancelled' ve 'all' özel; geri kalan tümü aktif filtresine düşer.
    if (status === "cancelled") where.cancelledAt = { not: null };
    else if (status !== "all") where.cancelledAt = null;
    if (params?.dateFrom || params?.dateTo) {
      where.receivedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    const search = params?.search?.trim();
    if (search) {
      where.OR = buildTextSearch<Prisma.KartelaReceiptWhereInput>(search, {
        text: ["subcontractor.name"],
        code: ["receiptNo", "manifestNo"],
      });
    }

    const select = {
      id: true,
      receiptNo: true,
      manifestNo: true,
      receivedAt: true,
      notes: true,
      cancelledAt: true,
      subcontractor: { select: { id: true, name: true, code: true } },
      receivedBy: { select: { id: true, fullName: true } },
      _count: { select: { items: true, swatches: true } },
      // Downstream probe: doğan kartelalardan biri sevkiyatta/çuvalda mı (take:1).
      // Varsa kabul iptal edilemez (cancelReceipt zaten engeller).
      swatches: {
        where: { cancelledAt: null, OR: [{ shipmentId: { not: null } }, { sackId: { not: null } }] },
        select: { id: true },
        take: 1,
      },
    } satisfies Prisma.KartelaReceiptSelect;

    // İptal edilebilir mi: iptal edilmemiş VE hiçbir kartela downstream'de değil.
    const withCancellable = (r: { cancelledAt: Date | null; swatches: { id: string }[] }) => {
      const { swatches: downstreamProbe, ...rest } = r;
      return { ...rest, cancellable: !r.cancelledAt && downstreamProbe.length === 0 };
    };

    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "receivedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.kartelaReceipt.findMany({
          where: whereClause,
          select,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.kartelaReceipt.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "receivedAt") : null;
      return {
        success: true,
        data: rows.map(withCancellable),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const { skip } = buildPagination(page, pageSize);
    const [receipts, total] = await Promise.all([
      prisma.kartelaReceipt.findMany({
        where,
        select,
        orderBy: { receivedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.kartelaReceipt.count({ where }),
    ]);
    return {
      success: true,
      data: receipts.map(withCancellable),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true } },
        receivedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
        items: {
          include: { consumedRoll: { include: { item: true, color: true } } },
        },
        swatches: {
          where: { cancelledAt: null },
          select: {
            id: true,
            cardNumber: true,
            barcode: true,
            length: true,
            width: true,
            weightKg: true,
            parentRollId: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");
    return { success: true, data: receipt };
  }

  // ===========================================================================
  // OUTSTANDING — Kabul worklist'i: firmadaki AT_KARTELA toplar
  // ===========================================================================
  async outstandingRolls(params?: {
    subcontractorId?: string;
  }): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.kartelaDispatchItem.findMany({
      where: {
        dispatch: {
          cancelledAt: null,
          ...(params?.subcontractorId
            ? { subcontractorId: params.subcontractorId }
            : {}),
        },
        roll: { status: RollStatus.AT_KARTELA },
      },
      select: {
        dispatchedQty: true,
        dispatchedWeight: true,
        dispatch: {
          select: {
            id: true,
            dispatchNo: true,
            dispatchedAt: true,
            subcontractor: { select: { id: true, name: true } },
          },
        },
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            weightKg: true,
            qualityGrade: true,
            markedForKartela: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            properties: {
              select: { property: { select: { id: true, name: true, color: true } } },
            },
          },
        },
      },
      orderBy: { dispatch: { dispatchedAt: "asc" } },
      // AT_KARTELA kendini-boşaltan geçici küme (normalde onlarca-birkaç yüz);
      // patolojik birikime karşı savunma tavanı (MAX_OFFSET guard'ı ruhunda).
      take: 2000,
    });

    return { success: true, data: items };
  }

  // ===========================================================================
  // KARTELALIK işareti — Tambur'da set, depoda toggle (frontend opsiyonel)
  // ===========================================================================
  async setRollMarkedForKartela(
    rollId: string,
    value: boolean,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, markedForKartela: true, labelDirty: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // ATOMİK CLAIM (check-then-act DEĞİL): "zaten bu değerde mi" sorusu yazmanın
    // WHERE'ine konur. Eski `findUnique → if → update` dizisinde iki paralel toggle
    // ikisi de "değiştirdim" der, iki audit satırı ve (aşağıdaki) iki bayat işareti
    // doğardı. count===0 → değer bu sırada zaten hedefe geçmiş: no-op cevabı.
    const claim = await prisma.roll.updateMany({
      where: { id: rollId, markedForKartela: !value },
      data: { markedForKartela: value },
    });
    if (claim.count === 0) {
      return {
        success: true,
        data: { id: rollId, markedForKartela: value },
        message: "Değişiklik yok",
      };
    }

    // ETİKET BAYAT (2026-08-21): kartelalık damgası KÂĞIDA basılıyor
    // (`config/label-fields.ts` → `kartelaMark`; `label-field-values` onu
    // `present: markedForKartela === true` ile çözer) → işaret değişince eldeki
    // etiket gerçeği anlatmıyor. HER İKİ YÖN bayatlatır: işaretlemek damgayı
    // EKLER, kaldırmak SİLER — ikisi de basılı kâğıdı yalanlar (emsal:
    // `inventory.service.applyManualProperties` renk/en/metraj bloğu).
    // ⚠️ `labelPrintedAt: { not: null }` — etiket HİÇ basılmadıysa bayatlatma:
    // sahte "yeniden bas" uyarısı operatörü körleştirir (hiç kâğıt yokken rozet
    // gösteren liste, gerçek rozeti de göz ardı ettirir). `labelDirty: false`
    // koşulu ise gereksiz yazmayı eler (Sack/TravelerCard emsali).
    const dirty = await prisma.roll.updateMany({
      where: { id: rollId, labelPrintedAt: { not: null }, labelDirty: false },
      data: { labelDirty: true },
    });
    // Audit'e "kâğıt artık bayat mı" bilgisi: bu işlemde işaretlendi ya da zaten
    // işaretliydi. Hiç basılmamış etikette false kalır (bilinçli).
    const labelDirty = dirty.count > 0 || roll.labelDirty;

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { markedForKartela: value, labelDirty },
    });

    return {
      success: true,
      data: { id: rollId, markedForKartela: value },
      message: value ? "Top kartelalık işaretlendi" : "Kartelalık işareti kaldırıldı",
    };
  }

  // ===========================================================================
  // STOK — müsait kartelaların ürün+renk bazında sayımı (sevk picker'ı besler)
  // ===========================================================================
  /**
   * Kartela stoğu = sevke girmemiş, iptal edilmemiş Swatch satırları
   * (`shipmentId IS NULL AND cancelledAt IS NULL`), `(itemId, colorId)` ile
   * gruplanıp sayılır. groupBy iki kolon + tek _count (tek round-trip); ad/hex
   * çözümü iki batch findMany (N+1 değil). `colorId null` → "renksiz" ayrı grup.
   */
  async getStock(params?: {
    search?: string;
    itemId?: string;
    colorId?: string;
  }): Promise<ApiResponse<KartelaStockGroup[]>> {
    // Kumaş/renk ÇOKLU seçilebilir (`?itemId=a,b`) — `readIdCondition` olmadan
    // CSV ham `groupBy` where'ine düşer ve uuid cast'inde patlardı.
    const itemCond = readIdCondition(params?.itemId);
    const colorCond = readIdCondition(params?.colorId);
    const groups = await prisma.swatch.groupBy({
      by: ["itemId", "colorId"],
      // sackId:null: çuvala girmiş kartela stokta sayılmaz (havuz rezervi).
      where: {
        shipmentId: null,
        sackId: null,
        cancelledAt: null,
        ...(itemCond && { itemId: itemCond }),
        ...(colorCond && { colorId: colorCond }),
      },
      _count: { _all: true },
    });

    if (groups.length === 0) return { success: true, data: [] };

    const itemIds = [...new Set(groups.map((g) => g.itemId))];
    const colorIds = [
      ...new Set(groups.map((g) => g.colorId).filter((id): id is string => id !== null)),
    ];

    const items = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, code: true, name: true },
    });
    const colors = colorIds.length
      ? await prisma.color.findMany({
          where: { id: { in: colorIds } },
          select: { id: true, name: true, hex: true },
        })
      : [];
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const colorMap = new Map(colors.map((c) => [c.id, c]));

    let data: KartelaStockGroup[] = groups.map((g) => {
      const item = itemMap.get(g.itemId);
      const color = g.colorId ? colorMap.get(g.colorId) : null;
      return {
        itemId: g.itemId,
        itemCode: item?.code ?? "",
        itemName: item?.name ?? "",
        colorId: g.colorId,
        colorName: color?.name ?? null,
        colorHex: color?.hex ?? null,
        count: g._count._all,
      };
    });

    const search = params?.search?.trim().toLocaleLowerCase("tr-TR");
    if (search) {
      data = data.filter((d) =>
        [d.itemName, d.itemCode, d.colorName ?? ""]
          .join(" ")
          .toLocaleLowerCase("tr-TR")
          .includes(search),
      );
    }

    data.sort((a, b) => {
      const byItem = a.itemName.localeCompare(b.itemName, "tr-TR");
      if (byItem !== 0) return byItem;
      return (a.colorName ?? "").localeCompare(b.colorName ?? "", "tr-TR");
    });

    return { success: true, data };
  }

  // ===========================================================================
  // STOK DÜŞ — kayıp/hasar/numune/sayım düzeltmesi için müsait kartelaları elle iptal
  // ===========================================================================
  /**
   * Bir (ürün, renk) grubundan N müsait kartelayı elle stoktan düşer (soft-cancel).
   * Kabul (+) / sevkiyat (−) dışındaki tek manuel ayar yolu. Swatch soft-delete'i
   * (`cancelledAt`/`cancelReason`) kullanır → `getStock` filtresinden otomatik düşer.
   * Kaynak top (`KARTELA_CONSUMED`) DOKUNULMAZ — bu bir stok zayiat/düzeltme yazımı,
   * kabul iptali değil. `addKartelaToShipment` ile aynı FIFO select-then-claim kalıbı.
   */
  async reduceStock(
    data: { itemId: string; colorId: string | null; count: number; reason: string; clientToken?: string | null },
    userId?: string
  ): Promise<ApiResponse<{ reduced: number }>> {
    if (!Number.isInteger(data.count) || data.count < 1) {
      throw AppError.badRequest("Adet pozitif tam sayı olmalı");
    }
    const reason = data.reason?.trim();
    if (!reason || reason.length < 3) {
      throw AppError.badRequest("Gerekçe en az 3 karakter olmalı");
    }

    let ids: string[];
    let reductionId: string;
    try {
      ({ ids, reductionId } = await prisma.$transaction(async (tx) => {
        // İdempotency çapası ÖNCE yazılır (SwatchStockReduction olay kaydı):
        // istek "şu ID'leri iptal et" değil "N adet düş" dediğinden replay'de FIFO
        // FARKLI N kartela seçerdi → çift düşüm. clientToken @unique P2002 burada,
        // claim'e hiç ulaşılmadan patlar → tx rollback, aşağıdaki catch cached döner.
        const reduction = await tx.swatchStockReduction.create({
          data: {
            clientToken: data.clientToken ?? null,
            itemId: data.itemId,
            colorId: data.colorId,
            count: data.count,
            reason,
            createdById: userId ?? null,
          },
          select: { id: true },
        });

        // updateMany LIMIT desteklemediğinden select-then-claim: N adayı FIFO seç,
        // sonra yalnız hâlâ müsait olanları (TOCTOU guard) tek updateMany ile iptal et.
        const candidates = await tx.swatch.findMany({
          where: {
            itemId: data.itemId,
            colorId: data.colorId, // null → colorId IS NULL ("renksiz" grubu)
            shipmentId: null,
            sackId: null, // çuvaldaki kartela stok değil
            cancelledAt: null,
          },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: data.count,
        });
        if (candidates.length < data.count) {
          throw AppError.conflict(
            `Yeterli kartela stoğu yok — istenen ${data.count}, mevcut ${candidates.length}. Listeyi yenileyin.`
          );
        }
        const claimIds = candidates.map((c) => c.id);
        const claimed = await tx.swatch.updateMany({
          where: { id: { in: claimIds }, shipmentId: null, sackId: null, cancelledAt: null },
          data: { cancelledAt: new Date(), cancelReason: reason },
        });
        if (claimed.count !== data.count) {
          // Kısmi claim: aralarından biri az önce sevkiyata girdi/iptal oldu → tüm tx
          // rollback (reduction kaydı dahil — yarım olay kaydı kalmaz, token boşa gitmez).
          throw AppError.conflict("Kartelalardan biri az önce değişti — tekrar deneyin.");
        }
        return { ids: claimIds, reductionId: reduction.id };
      }));
    } catch (err) {
      // İdempotent replay (Roll emsali): aynı token'lı düşüm İLK çağrıda uygulandı.
      if (data.clientToken && isClientTokenP2002(err)) {
        const existing = await prisma.swatchStockReduction.findUnique({
          where: { clientToken: data.clientToken },
        });
        if (existing) {
          // Hafif payload-özdeşlik (F117 emsali).
          const same =
            existing.itemId === data.itemId &&
            (existing.colorId ?? null) === (data.colorId ?? null) &&
            existing.count === data.count;
          if (same) {
            return {
              success: true,
              data: { reduced: existing.count },
              message: `${existing.count} kartela stoktan düşüldü (idempotent retry)`,
            };
          }
          throw AppError.conflict(
            "Bu istemci anahtarı farklı bir stok düşümüyle kullanılmış. Formu kapatıp yeniden deneyin.",
            {
              code: "CLIENT_TOKEN_COLLISION",
              existing: { itemId: existing.itemId, colorId: existing.colorId, count: existing.count },
              incoming: { itemId: data.itemId, colorId: data.colorId, count: data.count },
            },
          );
        }
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: ids[0],
      newData: {
        kind: "KARTELA_STOCK_REDUCE",
        reductionId,
        itemId: data.itemId,
        colorId: data.colorId,
        count: data.count,
        // F177: hangi kartelaların düşüldüğü izlensin (recordId yalnız ilkini gösteriyordu).
        swatchIds: ids.slice(0, 100),
        reason,
      },
    });

    return {
      success: true,
      data: { reduced: ids.length },
      message: `${ids.length} kartela stoktan düşüldü`,
    };
  }
}

export const kartelaService = new KartelaService();

// =============================================================================
// RESMİ BELGE — Kartela Çeki Listesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici iki yolda: freeze (sevk create tx'i) + reissue (gerekçeli revizyon).
// getCurrent belgesi olmayan eski kayıtta bunu lazy-init olarak da kullanır.
async function buildKartelaDispatchDoc(
  db: PrintedDocDb,
  dispatchId: string
): Promise<BuiltDocContent | null> {
  const dispatch = await db.kartelaDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      subcontractor: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          roll: {
            include: {
              item: { select: { code: true, name: true } },
              color: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!dispatch) return null;

  const rolls = dispatch.items.map((item, idx) => ({
    sequence: idx + 1,
    id: item.roll.id,
    barcode: item.roll.barcode,
    itemCode: item.roll.item?.code ?? "",
    itemName: item.roll.item?.name ?? "",
    colorCode: item.roll.color?.code ?? null,
    colorName: item.roll.color?.name ?? null,
    dispatchedQty: Number(item.dispatchedQty),
    dispatchedWeight: item.dispatchedWeight != null ? Number(item.dispatchedWeight) : null,
    qualityGrade: item.roll.qualityGrade,
    width: item.roll.width != null ? Number(item.roll.width) : null,
  }));
  const totalWeight = rolls.reduce((s, r) => s + (r.dispatchedWeight ?? 0), 0);

  return {
    documentNo: dispatch.dispatchNo,
    voidInfo: dispatch.cancelledAt
      ? { reason: dispatch.cancelReason, at: dispatch.cancelledAt }
      : null,
    doc: {
      dispatchNo: dispatch.dispatchNo,
      dispatchedAt: dispatch.dispatchedAt.toISOString(),
      driverName: dispatch.driverName,
      plateNumber: dispatch.plateNumber,
      notes: dispatch.notes,
      subcontractor: {
        id: dispatch.subcontractor.id,
        name: dispatch.subcontractor.name,
        code: dispatch.subcontractor.code ?? null,
      },
      rolls,
      totals: {
        rollCount: rolls.length,
        totalQty: Number(dispatch.totalQty),
        totalWeight,
      },
    },
  };
}

registerPrintedDocBuilder(PrintedDocType.KARTELA_DISPATCH, {
  fresh: buildKartelaDispatchDoc,
  // Tek-kaynak HTML — Electron iframe/printHtmlString aynı çıktıyı basar.
  renderHtml: renderKartelaCekiHtml,
  // Belge şablon profili: kartela firmasına atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const d = await db.kartelaDispatch.findUnique({
      where: { id: sourceId },
      select: { subcontractor: { select: { documentProfileId: true } } },
    });
    return d?.subcontractor?.documentProfileId ?? null;
  },
});
