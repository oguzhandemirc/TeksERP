// =============================================================================
// DEPOLAR ARASI TRANSFER
// =============================================================================
// TEK ADIMLI: "yolda" (in-transit) durumu yok — yerel depolar arasında araç
// takibi ihtiyacı yok. Gerekirse `WarehouseTransferStatus`a SONA `IN_TRANSIT`
// eklenerek açılır.
//
// ⚠️ MAL KABULDEN FARKLI OLARAK TEK TRANSACTION: burada `createInitialEntry`
// yok, yalnız `Roll.warehouseId` güncelleniyor → tüm transfer atomik olabilir
// ve OLMALI. Yarım transfer ("5 top gitti, 3'ü kaldı") fiziksel dünyada
// karşılığı olmayan bir durumdur: mal kamyona ya birlikte biner ya binmez.
//
// ⚠️ SATIR TABLOSU YOK: kalemler `WarehouseMovement` satırlarıdır (`transferId`).
// =============================================================================
import { Prisma, PrintedDocType, RollStatus, WarehouseEventType, WarehouseTransferStatus } from "@prisma/client";
import { printedDocumentService, registerPrintedDocBuilder } from "./printed-document.service";
import { renderWarehouseTransferHtml, type WarehouseTransferDoc } from "./document-render/warehouse-doc.html";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildSeriesCode, seriesCodePrefix, seriesSeqFrom } from "./number-series.service";
import { applyDateRange, buildWhereClause } from "../utils/query-parser";
import { ROLL_STATUS_TR } from "../constants/status-labels";
import { postStockMoves } from "./helpers/warehouse-ledger.helper";
import { reverseLegacyStockMove, reverseStockMove } from "./helpers/warehouse-ledger-reverse.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import type { ApiResponse } from "../types/api.types";

const TRANSFER_PREFIX = "DT";

/**
 * Transfer edilebilir statüler — mal FİZİKSEL olarak depoda duruyor olmalı.
 *
 * ⚠️ Liste dar tutuldu: `IN_PRODUCTION` (istasyonda), `AT_SUBCONTRACTOR`
 * (fasonda), `SHIPPED` (müşteride), `CANCELLED`/`SCRAP` (yok) ve tüketilmiş
 * statüler DIŞARIDA. Mal zaten depoda değilken "depodan depoya taşıdım" demek
 * defteri yalanlar.
 */
const TRANSFERABLE: RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

export interface TransferCreateInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  rollIds: string[];
  /**
   * Çuval-BÜTÜN transfer (2026-08-14): çuval, içindeki TÜM toplarla birlikte
   * taşınır — toplar çuvaldan ÇIKMAZ (sackId korunur). Yarım çuval taşımak
   * fiziksel dünyada "çuvalı boşaltıp yeniden doldurmak"tır ve o iş zaten
   * çuval bölme/çıkarma akışının işidir, transferin değil.
   */
  sackIds?: string[];
  notes?: string | null;
  clientToken?: string;
}

async function nextTransferNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = seriesCodePrefix("warehouseTransfer", now);
  const rows = await tx.warehouseTransfer.findMany({
    where: { transferNo: { gte: prefix, startsWith: prefix } },
    select: { transferNo: true },
  });
  return buildSeriesCode("warehouseTransfer", seriesSeqFrom(rows.map((r) => r.transferNo), prefix), now);
}

/**
 * Liste tarih aralığı için kabul edilen kolonlar (mal kabul listesiyle simetrik).
 * `cancelledAt` bilinçli olarak DIŞARIDA — bkz. `GOODS_RECEIPT_DATE_FIELDS`.
 */
const WAREHOUSE_TRANSFER_DATE_FIELDS = ["createdAt"] as const;

export class WarehouseTransferService {
  /**
   * Transferi kurar ve ANINDA uygular (tek tx).
   *
   * Guard ihlalinde 400 + SOMUT top listesi — "3 top uygun değil" gibi soyut bir
   * sayı operatöre hangi topu ayıklayacağını söylemez (kök CLAUDE.md kuralı).
   */
  async create(input: TransferCreateInput, userId?: string): Promise<ApiResponse<unknown>> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw AppError.badRequest("Kaynak ve hedef depo aynı olamaz.");
    }
    const sackIds = [...new Set(input.sackIds ?? [])];
    if (input.rollIds.length === 0 && sackIds.length === 0) {
      throw AppError.badRequest("Transfer edilecek top veya çuval seçilmedi.");
    }

    const [from, to] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: input.fromWarehouseId }, select: { id: true, name: true, isActive: true } }),
      prisma.warehouse.findUnique({ where: { id: input.toWarehouseId }, select: { id: true, name: true, isActive: true } }),
    ]);
    if (!from) throw AppError.badRequest("Kaynak depo bulunamadı.");
    if (!to) throw AppError.badRequest("Hedef depo bulunamadı.");
    if (!to.isActive) throw AppError.badRequest(`"${to.name}" deposu pasif — mal bu depoya taşınamaz.`);

    // İdempotent tekrar (ağ kopması / çift tıklama).
    if (input.clientToken) {
      const dupe = await prisma.warehouseTransfer.findUnique({
        where: { clientToken: input.clientToken },
        select: {
          id: true, transferNo: true, fromWarehouseId: true, toWarehouseId: true,
          // ⚠️ SATIR TABLOSU YOK (dosya başlığı): transferin kalemleri
          // `WarehouseMovement` satırlarıdır. Top başına İKİ satır doğar
          // (çıkış + giriş) → aşağıda Set ile tekilleştirilir.
          movements: { select: { rollId: true } },
        },
      });
      if (dupe) {
        // AYNI TOKEN, FARKLI GÖVDE → 409 (2026-09-01). Gerekçe:
        // `cash-transaction.service.ts` → `assertCashTxnReplay` başlığı. Burada
        // riski TOP KÜMESİ taşır: kullanıcı seçimi düzeltip aynı token'la tekrar
        // gönderdiğinde eski transfer "zaten yapılmış" diye dönüyordu ve
        // eklediği toplar HİÇ taşınmamış oluyordu.
        // ⚠️ Küme SIRASIZ kıyaslanır — istemcinin seçim sırası anlam taşımaz.
        // ⚠️ ÇUVALLAR AÇILIR: transfer çuvalı BÜTÜN olarak taşır, yani hareket
        // defterinde çuvalın ÜYE TOPLARI da vardır ama `input.rollIds` onları
        // İÇERMEZ. Sadece `rollIds` ile kıyaslamak, çuval taşıyan her meşru
        // tekrarı 409'a düşürürdü (kapının kendisi arıza olurdu).
        const cuvalToplari = sackIds.length
          ? await prisma.roll.findMany({ where: { sackId: { in: sackIds } }, select: { id: true } })
          : [];
        const izMevcut = [...new Set(dupe.movements.map((m) => m.rollId))].sort().join(",");
        const izGelen = [...new Set([...input.rollIds, ...cuvalToplari.map((r) => r.id)])].sort().join(",");
        assertReplayPayloadMatches(
          [
            { ad: "fromWarehouseId", mevcut: dupe.fromWarehouseId, gelen: input.fromWarehouseId },
            { ad: "toWarehouseId", mevcut: dupe.toWarehouseId, gelen: input.toWarehouseId },
            { ad: "toplar", mevcut: izMevcut, gelen: izGelen },
          ],
          "Bu istemci anahtarı FARKLI bir depo transferi için kullanılmış. Ekranı yenileyip tekrar deneyin.",
          { warehouseTransferId: dupe.id },
        );
        return { success: true, data: await this.loadDetail(dupe.id), message: `Bu transfer zaten yapılmış (${dupe.transferNo}).` };
      }
    }

    const uniqueIds = [...new Set(input.rollIds)];
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const rolls = await tx.roll.findMany({
          where: { id: { in: uniqueIds } },
          select: {
            id: true, barcode: true, status: true, currentQty: true,
            warehouseId: true, sackId: true, shipmentId: true,
          },
        });

        // ── ÇUVALLAR — bütün olarak, üye toplarıyla ─────────────────────────
        const sacks = sackIds.length
          ? await tx.sack.findMany({
              where: { id: { in: sackIds } },
              select: {
                id: true, sackNo: true, warehouseId: true, shipmentId: true,
                rolls: {
                  select: { id: true, barcode: true, status: true, currentQty: true, warehouseId: true, shipmentId: true },
                },
              },
            })
          : [];

        const problems: string[] = [];
        const ref = (r: { id: string; barcode: string | null }) => r.barcode ?? r.id.slice(0, 8);
        const foundIds = new Set(rolls.map((r) => r.id));
        for (const missing of uniqueIds.filter((id) => !foundIds.has(id))) {
          problems.push(`${missing.slice(0, 8)}: top bulunamadı`);
        }
        for (const r of rolls) {
          if (r.warehouseId !== input.fromWarehouseId) problems.push(`${ref(r)}: bu depoda değil`);
          else if (!TRANSFERABLE.includes(r.status)) problems.push(`${ref(r)}: durumu uygun değil (${ROLL_STATUS_TR[r.status]})`);
          // Çuvaldaki top TEK taşınmaz — çuval bütünlüğü. Çuval da seçildiyse
          // mesaj yol gösterir: top zaten çuvalıyla gidiyor, tekrar seçme.
          else if (r.sackId && sackIds.includes(r.sackId)) problems.push(`${ref(r)}: seçilen çuvalın içinde — çuvalla birlikte zaten taşınacak`);
          else if (r.sackId) problems.push(`${ref(r)}: çuvalda — çuvalı bütün taşıyın ya da önce çuvaldan çıkarın`);
          else if (r.shipmentId) problems.push(`${ref(r)}: sevkiyata bağlı`);
        }

        // Çuval guard'ları — hepsi SOMUT çuval numarasıyla.
        const foundSackIds = new Set(sacks.map((sk) => sk.id));
        for (const missing of sackIds.filter((sid) => !foundSackIds.has(sid))) {
          problems.push(`${missing.slice(0, 8)}: çuval bulunamadı`);
        }
        const sackRollIds: string[] = [];
        for (const sk of sacks) {
          if (sk.shipmentId) {
            problems.push(`${sk.sackNo}: sevkiyata atanmış — önce sevkiyattan çıkarın`);
            continue;
          }
          // Boş çuval TAŞINMAZ: envanter değeri yok, defter satırı üretemez
          // ("kaç metre taşındı" cevapsız kalır). Doğru akış: hedef depoda yeni
          // çuval açmak.
          if (sk.rolls.length === 0) {
            problems.push(`${sk.sackNo}: boş çuval taşınmaz — hedef depoda yeni çuval açın`);
            continue;
          }
          // Konum kuralı: çuval kaynak depoda olmalı. NULL = 2026-08-14 öncesi
          // damgasız çuval → üye topların deposu üzerinden SAHİPLENİLİR (lazy
          // adoption); topların hepsi zaten kaynakta olmak zorunda (aşağıda).
          if (sk.warehouseId !== null && sk.warehouseId !== input.fromWarehouseId) {
            problems.push(`${sk.sackNo}: bu depoda görünmüyor`);
            continue;
          }
          for (const r of sk.rolls) {
            if (r.warehouseId !== input.fromWarehouseId) problems.push(`${sk.sackNo}/${ref(r)}: çuval üyesi bu depoda değil`);
            else if (!TRANSFERABLE.includes(r.status)) problems.push(`${sk.sackNo}/${ref(r)}: durumu uygun değil (${ROLL_STATUS_TR[r.status]})`);
            else if (r.shipmentId) problems.push(`${sk.sackNo}/${ref(r)}: sevkiyata bağlı`);
            else sackRollIds.push(r.id);
          }
        }
        if (problems.length > 0) {
          const sample = problems.slice(0, 8).join(" · ");
          throw AppError.badRequest(
            `${problems.length} top transfer edilemez: ${sample}${problems.length > 8 ? " · …" : ""}`,
          );
        }

        const transferNo = await nextTransferNo(tx);
        const transfer = await tx.warehouseTransfer.create({
          data: {
            transferNo,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            notes: input.notes?.trim() || null,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
          },
          select: { id: true, transferNo: true },
        });

        // ATOMİK CLAIM: taşıma yalnız toplar HÂLÂ kaynak depodaysa geçer. Guard'lar
        // yukarıda tx İÇİNDE okundu ama araya giren bir sevk/başka transfer aynı
        // pencerede commit edebilir; koşullu updateMany kaybedeni 409'a düşürür.
        // Serbest toplar ile çuval üyeleri AYRI claim'dir: guard koşulları farklı
        // (serbest top sackId=null ister, üye top sackId=çuvalı ister).
        const moved = await tx.roll.updateMany({
          where: { id: { in: uniqueIds }, warehouseId: input.fromWarehouseId, sackId: null, shipmentId: null },
          data: { warehouseId: input.toWarehouseId },
        });
        if (moved.count !== uniqueIds.length) {
          throw AppError.conflict(
            `Toplar bu sırada başka bir işleme girdi (${moved.count}/${uniqueIds.length} taşınabildi) — transfer iptal edildi, tekrar deneyin.`,
          );
        }
        if (sackRollIds.length > 0) {
          const movedMembers = await tx.roll.updateMany({
            where: { id: { in: sackRollIds }, warehouseId: input.fromWarehouseId, sackId: { in: sackIds }, shipmentId: null },
            data: { warehouseId: input.toWarehouseId },
          });
          if (movedMembers.count !== sackRollIds.length) {
            throw AppError.conflict(
              `Çuval içeriği bu sırada değişti (${movedMembers.count}/${sackRollIds.length}) — transfer iptal edildi, tekrar deneyin.`,
            );
          }
          // Çuvalın KENDİ konumu — sevkiyata atanmamışsa. Damgasız (NULL) çuval
          // burada sahiplenilmiş olur: bundan sonra konumu hep dolu.
          const movedSacks = await tx.sack.updateMany({
            where: { id: { in: sackIds }, shipmentId: null },
            data: { warehouseId: input.toWarehouseId },
          });
          if (movedSacks.count !== sackIds.length) {
            throw AppError.conflict("Çuval bu sırada sevkiyata atandı — transfer iptal edildi, tekrar deneyin.");
          }
        }

        // ⚠️ TRANSFER İKİ UÇLU TEK OLAYDIR: `from` ve `to` DOLU ve FARKLI, ve
        // İKİ UÇ DA stok kümesindedir — sevk/fason gibi tek uçlu DEĞİL. Statü iki
        // uçta da AYNIDIR: taşımak malı hareket ettirir, durumunu değiştirmez.
        // Sevk kalıbını kopyalamak burada sessiz bir yanlış üretirdi.
        //
        // ⚠️ STOK KÜMESİ DIŞI TOP SATIR YAZMAZ ve bu SESSİZ ATLAMA DEĞİL, OLAY
        // YOKLUĞUDUR (§64: stok dışından stok dışına satır yazılmaz). Transfer
        // statüyü kısıtlamıyor ve depolu-çuvalsız-sevkiyatsız şekilde stok kümesi
        // DIŞI 2.431 top var (ölçüldü 2026-09-13, fabrika kopyası: CONSUMED 1.519 ·
        // CANCELLED 382 · TAMBUR_CONSUMED 250 · AT_SUBCONTRACTOR 187 ·
        // IN_PRODUCTION 87 · SCRAP 6) — ör. fireyi hurda deposuna taşımak meşru
        // bir iştir ve Σ'yı etkilemez. Onlara satır yazmak K1 uç şeklini ihlal
        // eder (`assertEndShape` 500 verir); REDDETMEK de yanlış olurdu.
        const stokUcu = (r: { status: RollStatus }) => WAREHOUSE_STOCK_STATUSES.includes(r.status);
        const memberRows = sacks.flatMap((sk) =>
          sk.rolls.filter(stokUcu).map((r) => ({
            rollId: r.id,
            eventType: WarehouseEventType.TRANSFER,
            qty: r.currentQty,
            from: { warehouseId: input.fromWarehouseId, status: r.status },
            to: { warehouseId: input.toWarehouseId, status: r.status },
            reasonCode: STOCK_MOVE_REASON.TRANSFER,
            transferId: transfer.id,
            sackId: sk.id,
            userId: userId ?? null,
          })),
        );
        await postStockMoves(tx, [
          ...rolls.filter(stokUcu).map((r) => ({
            rollId: r.id,
            eventType: WarehouseEventType.TRANSFER,
            qty: r.currentQty,
            from: { warehouseId: input.fromWarehouseId, status: r.status },
            to: { warehouseId: input.toWarehouseId, status: r.status },
            reasonCode: STOCK_MOVE_REASON.TRANSFER,
            transferId: transfer.id,
            userId: userId ?? null,
          })),
          ...memberRows,
        ]);
        // Transfer İPTALİ defterden okuyor: eksik satır malı hedef depoda MAHSUR
        // bırakır. Politika argümanı YOK — yeni kapı 0 metrajda her zaman fırlatır.

        // Resmi belge — transfer irsaliyesi v1 BURADA, aynı tx içinde donar
        // (sevk irsaliyesi emsali): içerik "taşıma anı"dır.
        await printedDocumentService.freezeForSource(tx, PrintedDocType.TRANSFER_DISPATCH, transfer.id, userId);

        return { id: transfer.id, transferNo: transfer.transferNo, count: rolls.length + sackRollIds.length, sackCount: sacks.length };
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WAREHOUSE_TRANSFER",
      recordId: result.id,
      newData: { transferNo: result.transferNo, from: from.name, to: to.name, rollCount: result.count, sackCount: result.sackCount },
    });

    return {
      success: true,
      data: await this.loadDetail(result.id),
      message: `${result.transferNo}: ${result.count} top${result.sackCount > 0 ? ` (${result.sackCount} çuval)` : ""} "${from.name}" → "${to.name}" taşındı.`,
    };
  }

  /**
   * Çuval kodlarını transfer formu için çözer.
   *
   * ⚠️ Uygunluk HÜKMÜ burada verilmez, yalnız KARAR VERDİRECEK bilgi taşınır
   * (konum, sevkiyat bağı, üye sayısı/metraj) — gerçek guard'lar create
   * transaction'ının içindedir. Form-anı hükmü ile tx-anı gerçeği ayrışabilir;
   * hüküm iki yerde yaşarsa bir gün biri "olur" derken diğeri 400 verir.
   *
   * Bulunamayan kod SESSİZCE ATLANMAZ — `notFound` listesiyle döner: operatör
   * yanlış okuttuğu kodu bilmezse çuvalı taşıdığını sanır.
   */
  async lookupSacks(codes: string[]): Promise<ApiResponse<unknown>> {
    if (codes.length === 0) return { success: true, data: { sacks: [], notFound: [] } };
    const sacks = await prisma.sack.findMany({
      where: { sackNo: { in: codes } },
      select: {
        id: true,
        sackNo: true,
        shipmentId: true,
        warehouseId: true,
        warehouse: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        rolls: { select: { id: true, currentQty: true, status: true } },
      },
    });
    const foundNos = new Set(sacks.map((sk) => sk.sackNo));
    return {
      success: true,
      data: {
        sacks: sacks.map((sk) => ({
          id: sk.id,
          sackNo: sk.sackNo,
          warehouseId: sk.warehouseId,
          warehouseName: sk.warehouse?.name ?? null,
          customerName: sk.customer?.name ?? null,
          shipmentAssigned: sk.shipmentId != null,
          rollCount: sk.rolls.length,
          totalQty: sk.rolls.reduce((sum, r) => sum + Number(r.currentQty), 0),
        })),
        notFound: codes.filter((c) => !foundNos.has(c)),
      },
    };
  }

  /**
   * BARKODSUZ SEÇİM — bir depodaki transfer edilebilir çuvalları listeler.
   *
   * Etiket basmayan / barkod okutmayan kullanıcı (alım-satım personası) için
   * transferin tek girişi okutmaktı; bu, o kullanıcıyı fiilen dışarıda
   * bırakıyordu. Top tarafının karşılığı `GET /api/rolls` ile ZATEN vardı
   * (`filter[warehouseId]` + `filter[statusIn]`); eksik olan yalnız ÇUVAL'dı.
   *
   * ⚠️ AYRI UÇ, `sack-search`e filtre EKLEMEK DEĞİL: o uç `shipping:read`
   * ailesiyle kapılı ve depo/paketleme yüzeylerini besliyor. Transfer
   * kullanıcısının izni `warehouse:transfer` — oraya filtre eklemek ya bu
   * kullanıcıya sevkiyat yüzeyini açmak ya da transferi sevk iznine bağlamak
   * demekti. İkisi de yanlış yönde bir genişleme.
   *
   * ⚠️ SEVKİYATA ATANMIŞ ÇUVAL LİSTEDE ÇIKMAZ (`shipmentId: null`): `create`
   * onu zaten reddediyor ve göstermek "seç → 400 al" döngüsü kurardı. Aynı
   * gerekçeyle boş çuval da elenir — taşınacak mal yok.
   */
  async listWarehouseSacks(params: {
    warehouseId: string;
    search?: string | null;
    limit: number;
  }): Promise<ApiResponse<unknown>> {
    const sacks = await prisma.sack.findMany({
      where: {
        warehouseId: params.warehouseId,
        shipmentId: null,
        ...(params.search ? { sackNo: { contains: params.search.toUpperCase() } } : {}),
        // ⚠️ YÜKLEM `some` DEĞİL, "boş değil VE hiçbir üyesi uygunsuz değil".
        // `create` çuvalı BÜTÜN taşır ve TEK bir uygunsuz üye (iptal/fire/
        // fasonda) çuvalın TAMAMINI reddeder — `some` ile listelemek, sevkin
        // reddedeceği çuvalı önermek olurdu (bekçide kilitli: §5d).
        // Boş çuval da elenir: `create` onu ayrıca reddediyor (defter satırı
        // üretemez).
        rolls: {
          some: {},
          none: { status: { notIn: TRANSFERABLE } },
        },
      },
      select: {
        id: true,
        sackNo: true,
        customer: { select: { name: true } },
        rolls: { select: { currentQty: true, status: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(params.limit, 1), 200),
    });
    return {
      success: true,
      // Süzgeç gereği bu çuvalların TÜM üyeleri transfer edilebilir — sayım
      // ayrıca filtrelenmez. (Filtreleseydi ekran, taşınacak olandan DAHA AZ
      // metraj gösterirdi: çuval bütün gider.)
      data: sacks.map((sk) => ({
        id: sk.id,
        sackNo: sk.sackNo,
        customerName: sk.customer?.name ?? null,
        rollCount: sk.rolls.length,
        totalQty: sk.rolls.reduce((sum, r) => sum + Number(r.currentQty), 0),
      })),
    };
  }

  /**
   * Transferi geri alır (storno) — toplar kaynak depoya döner.
   *
   * ⚠️ Geri dönüş adresi transferin KENDİ satırındadır (`fromWarehouseId`), yani
   * `preShipStatus` gibi ayrı bir snapshot alanına gerek yok.
   *
   * ⚠️ Yalnız toplar HÂLÂ hedef depoda ve SERBEST ise geri alınır: aradan sevk
   * geçmişse ya da başka bir transferle taşınmışsa geri sarmak yanlış defter
   * yazar. İhlalde 409 + hangi toplar.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<unknown>> {
    const transfer = await prisma.warehouseTransfer.findUnique({
      where: { id },
      select: { id: true, transferNo: true, status: true, fromWarehouseId: true, toWarehouseId: true },
    });
    if (!transfer) throw AppError.notFound("Transfer bulunamadı.");
    if (transfer.status === WarehouseTransferStatus.CANCELLED) {
      return { success: true, data: transfer, message: `${transfer.transferNo} zaten iptal edilmiş.` };
    }

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.warehouseMovement.findMany({
        where: { transferId: id, eventType: WarehouseEventType.TRANSFER },
        // `id` + uçlar: ters satır `reversesMovementId` ile BAĞLANIR, ve statüsüz
        // eski satır (②-c öncesi) aynalanamadığı için K4 dalına yönlendirilir.
        select: { id: true, rollId: true, qty: true, sackId: true, fromStatus: true, toStatus: true },
      });
      if (rows.length === 0) throw AppError.conflict("Transferin kalemleri bulunamadı.");

      const rollIds = rows.map((r) => r.rollId);
      const rolls = await tx.roll.findMany({
        where: { id: { in: rollIds } },
        select: { id: true, barcode: true, status: true, warehouseId: true, sackId: true, shipmentId: true },
      });
      // Guard "aynı halde mi" sorusudur ve çuval üyeliği o halin PARÇASIDIR:
      // hareket satırı sackId taşıyorsa top hâlâ AYNI çuvalda olmalı; taşımıyorsa
      // hâlâ serbest olmalı. Çuvaldan çıkarılmış/başka çuvala konmuş top,
      // "transfer sonrası işlem görmüş"tür ve geri sarma yanlış defter yazar.
      const expectedSack = new Map(rows.map((r) => [r.rollId, r.sackId ?? null]));
      // ⚠️ MESAJ SEBEBİ SÖYLER, DURUMU DEĞİL. Filtre DÖRT ayrı sebeple eliyor
      // (depo değişmiş · çuval üyeliği değişmiş · sevkiyata bağlanmış · durum
      // uygun değil) ama eski satır her sebepte `(${r.status})` basıyordu:
      // çuvala konmuş bir top için "T15… (WAREHOUSE)" yazıyordu — kullanıcı
      // durumu okuyor, hiçbir sorun görmüyor ve engeli çözemiyordu. Ham enum'u
      // Türkçeleştirmek TEK BAŞINA yetmez; söylenmesi gereken şey SEBEPTİR.
      // Sıra ön-kontroldeki (`create`) sırayla aynı: en somut olan önce.
      const undoBlockReason = (r: {
        status: RollStatus;
        warehouseId: string | null;
        sackId: string | null;
        shipmentId: string | null;
        id: string;
      }): string | null => {
        if (r.warehouseId !== transfer.toWarehouseId) return "hedef depoda değil — başka depoya taşınmış";
        const expected = expectedSack.get(r.id) ?? null;
        if (r.sackId !== expected) {
          if (expected === null) return "transferden sonra bir çuvala konmuş";
          return r.sackId === null
            ? "transferden sonra çuvaldan çıkarılmış"
            : "transferden sonra başka bir çuvala konmuş";
        }
        if (r.shipmentId) return "bir sevkiyata bağlanmış";
        if (!TRANSFERABLE.includes(r.status)) return `durumu uygun değil (${ROLL_STATUS_TR[r.status]})`;
        return null;
      };
      const problems = rolls
        .map((r) => ({ r, reason: undoBlockReason(r) }))
        .filter((x): x is { r: (typeof rolls)[number]; reason: string } => x.reason !== null)
        .map(({ r, reason }) => `${r.barcode ?? r.id.slice(0, 8)}: ${reason}`);
      if (problems.length > 0) {
        throw AppError.conflict(
          `${transfer.transferNo}: ${problems.length} top transfer sonrası işlem görmüş (${problems.slice(0, 5).join(", ")}` +
            `${problems.length > 5 ? "…" : ""}) — transfer geri alınamaz.`,
        );
      }

      const claim = await tx.warehouseTransfer.updateMany({
        where: { id, status: WarehouseTransferStatus.COMPLETED },
        data: {
          status: WarehouseTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claim.count === 0) throw AppError.conflict("Transfer bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");

      const looseIds = rows.filter((r) => !r.sackId).map((r) => r.rollId);
      const memberIds = rows.filter((r) => r.sackId).map((r) => r.rollId);
      const cancelSackIds = [...new Set(rows.map((r) => r.sackId).filter((x): x is string => Boolean(x)))];
      let backCount = 0;
      if (looseIds.length > 0) {
        const back = await tx.roll.updateMany({
          where: { id: { in: looseIds }, warehouseId: transfer.toWarehouseId, sackId: null, shipmentId: null },
          data: { warehouseId: transfer.fromWarehouseId },
        });
        backCount += back.count;
      }
      if (memberIds.length > 0) {
        const back = await tx.roll.updateMany({
          where: { id: { in: memberIds }, warehouseId: transfer.toWarehouseId, sackId: { in: cancelSackIds }, shipmentId: null },
          data: { warehouseId: transfer.fromWarehouseId },
        });
        backCount += back.count;
      }
      if (backCount !== rollIds.length) {
        throw AppError.conflict("Toplar bu sırada taşındı — transfer geri alınamadı, tekrar deneyin.");
      }
      if (cancelSackIds.length > 0) {
        // Çuval da kaynak depoya döner — sevkiyata atanmışsa yukarıdaki roll
        // guard'ı zaten düşürdü (üyeler shipmentId taşırdı).
        await tx.sack.updateMany({
          where: { id: { in: cancelSackIds }, shipmentId: null },
          data: { warehouseId: transfer.fromWarehouseId },
        });
      }

      // Defter APPEND-ONLY: TRANSFER satırı silinmez, ters satır eklenir —
      // taşıma gerçekten olmuştu; ikisi birlikte "gitti ve geri geldi" der.
      // ⚠️ TERS SATIR BAĞLI DOĞAR (tasarım D2a): iki uçlu olayda "ters" demek
      // UÇLARIN AYNALANMASIDIR (from↔to yer değiştirir) — sevkteki "tek uç boşalır"
      // kalıbı DEĞİL. `reverseStockMove` aynalamayı kendisi yapar ve metrajı ileri
      // satırdan kopyalar; bağsız yazsaydık çift iptal DB unique'ine çarpmazdı.
      for (const r of rows) {
        const ters = {
          eventType: WarehouseEventType.TRANSFER_REVERSAL,
          reasonCode: STOCK_MOVE_REASON.TRANSFER_CANCEL,
          userId: userId ?? null,
          notes: reason?.trim() || null,
        };
        if (r.fromStatus !== null || r.toStatus !== null) {
          await reverseStockMove(tx, r.id, ters);
          continue;
        }
        // ESKİ KAYIT DALI (K4): statüsüz ileri satırın yönü aynalanamaz; uçlar elle
        // kurulur ama BAĞ kurulur (epoch sondası `reverseLegacyStockMove` içinde).
        // Uçlar transferin KENDİ belgesinden gelir, canlı veriden değil.
        const top = rolls.find((x) => x.id === r.rollId);
        if (!top || !WAREHOUSE_STOCK_STATUSES.includes(top.status)) continue;
        await reverseLegacyStockMove(tx, r.id, {
          ...ters,
          from: { warehouseId: transfer.toWarehouseId, status: top.status },
          to: { warehouseId: transfer.fromWarehouseId, status: top.status },
        });
      }

      // Belge İPTAL filigranıyla VOIDED'e çekilir — silinmez: transfer gerçekten
      // yapılmıştı ve kâğıdı sahada dolaşmış olabilir.
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.TRANSFER_DISPATCH,
        id,
        reason?.trim() || "Transfer geri alındı",
      );

      return { count: rollIds.length };
    });

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WAREHOUSE_TRANSFER",
      recordId: id,
      newData: { kind: "CANCEL", transferNo: transfer.transferNo, rollCount: result.count, reason: reason ?? null },
    });

    return {
      success: true,
      data: await this.loadDetail(id),
      message: `${transfer.transferNo} geri alındı (${result.count} top kaynak depoya döndü).`,
    };
  }

  /** Transfer listesi (sayfalı) — sorgu SERVİSTE (katman kuralı). */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
    /** `?dateField=createdAt&dateFrom=…&dateTo=…` — üçü BİRLİKTE gider. */
    dateField?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<{ rows: unknown[]; total: number }> {
    // ⚠️ KOD ↔ METİN kovası AYRI — bkz. `goods-receipt.service.ts` gerekçesi.
    const where = buildWhereClause(params.filters, ["notes"], params.search, ["transferNo"]);
    // ⚠️ TARİH ARALIĞI (2026-08-15): mal kabul listesiyle aynı boşluk —
    // `applyDateRange` hiç çağrılmadığı için `dateFrom` SESSİZCE yok sayılıyor
    // ve liste tam dönüyordu. Whitelist DAR: `createdAt` transferin yapıldığı
    // andır ve liste zaten onunla sıralanıyor.
    applyDateRange(where, params, WAREHOUSE_TRANSFER_DATE_FIELDS);
    const [rows, total] = await Promise.all([
      prisma.warehouseTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          transferNo: true,
          status: true,
          createdAt: true,
          cancelledAt: true,
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          _count: { select: { movements: true } },
        },
      }),
      prisma.warehouseTransfer.count({ where }),
    ]);
    return { rows, total };
  }

  /** Transfer detayı — başlık + taşınan toplar (defter satırlarından). */
  async loadDetail(id: string): Promise<Record<string, unknown>> {
    const transfer = await prisma.warehouseTransfer.findUnique({
      where: { id },
      include: {
        fromWarehouse: { select: { id: true, code: true, name: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        cancelledBy: { select: { id: true, fullName: true, username: true } },
      },
    });
    if (!transfer) throw AppError.notFound("Transfer bulunamadı.");

    // Kalemler defterden okunur (satır tablosu YOK — tek kaynak).
    const lines = await prisma.warehouseMovement.findMany({
      where: { transferId: id, eventType: WarehouseEventType.TRANSFER },
      orderBy: { createdAt: "asc" },
      select: {
        qty: true,
        roll: {
          select: {
            id: true, barcode: true, status: true, currentQty: true, width: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true } },
          },
        },
      },
    });

    const totalQty = lines.reduce((s, l) => s.plus(l.qty), new Prisma.Decimal(0));
    return { ...transfer, lines, totals: { rollCount: lines.length, totalQty: Number(totalQty) } };
  }
}

export const warehouseTransferService = new WarehouseTransferService();
export default warehouseTransferService;

// =============================================================================
// DONMUŞ BELGE — Transfer İrsaliyesi
// =============================================================================
// Kalemler DEFTERDEN okunur (transferin ayrı satır tablosu yok). Belge, transfer
// tx'inin İÇİNDE dondurulur → içerik "taşıma anı"dır; sonradan bir top başka
// depoya giderse belge DEĞİŞMEZ (donmuş belge kuralı).
registerPrintedDocBuilder(PrintedDocType.TRANSFER_DISPATCH, {
  fresh: async (db, sourceId) => {
    const t = await db.warehouseTransfer.findUnique({
      where: { id: sourceId },
      select: {
        transferNo: true, createdAt: true, notes: true,
        fromWarehouse: { select: { name: true, code: true } },
        toWarehouse: { select: { name: true, code: true } },
        createdBy: { select: { fullName: true, username: true } },
      },
    });
    if (!t) return null;

    const lines = await db.warehouseMovement.findMany({
      where: { transferId: sourceId, eventType: WarehouseEventType.TRANSFER },
      orderBy: { createdAt: "asc" },
      select: {
        qty: true,
        roll: {
          select: {
            barcode: true, width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    });

    const doc: WarehouseTransferDoc = {
      header: {
        documentNo: t.transferNo,
        date: t.createdAt.toISOString(),
        fromWarehouseName: t.fromWarehouse.name,
        fromWarehouseCode: t.fromWarehouse.code,
        toWarehouseName: t.toWarehouse.name,
        toWarehouseCode: t.toWarehouse.code,
        createdBy: t.createdBy?.fullName ?? t.createdBy?.username ?? null,
      },
      lines: lines.map((l) => ({
        barcode: l.roll.barcode,
        itemName: l.roll.item.name,
        colorName: l.roll.color?.name ?? null,
        width: l.roll.width != null ? Number(l.roll.width) : null,
        qty: Number(l.qty),
      })),
      notes: t.notes,
    };
    return { documentNo: t.transferNo, doc: doc as unknown as Record<string, unknown> };
  },
  renderHtml: renderWarehouseTransferHtml,
});
