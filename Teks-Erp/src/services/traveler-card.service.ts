// =============================================================================
// TeksERP - TravelerCard (Refakat Kartı) Service
// =============================================================================
// MODEL (2026-07-14): Kart İŞ EMRİ başınadır (parti değil) ve iş emri açılışında
// doğar. Tek-kod: cardNumber = barcode = workOrderNumber (İE+GGAAYY+NNNN). Karekod
// versiyonlar arası SABİT — WO değişirse reprint AYNI satırda snapshot'ı tazeler +
// version++, kod DEĞİŞMEZ (sahada hep aynı karekod). Parti (Batch) veri modeli kalır
// ama kart üretmez.
//
// İş Kuralları:
//   - Bir WorkOrder = tek TravelerCard (workOrderId @unique).
//   - Kart WO create tx'inde doğar (createForWorkOrder, idempotent).
//   - Reprint eski satırı korur (barkod sabit), snapshot'ı güncel WO'dan tazeler,
//     version++ eder. Ayrı satır/REPRINTED durumu YOK.
//   - Scan (tarama) ACTIVE olmayan kart ile reddedilir.
//   - WO COMPLETED / CANCELLED olunca kart COMPLETED / VOIDED'a çekilir
//     (setWorkOrderCardStatuses fan-out helper).
//
// ⚠️ PLAN CANLI, SUNUM DONMUŞ (2026-08-05 — otomatik revizyon):
//   Kart kontrollü bir belgedir (ISO 9001 §7.5.3) ve sahaya inen kâğıt HER ZAMAN
//   yürürlükteki planı göstermelidir. Bu yüzden ACTIVE kartın İÇERİĞİ (rota,
//   sipariş, hedef spec) baskı/önizleme anında iş emrinin GÜNCEL hâlinden üretilir
//   — SAP PP'nin "değişiklik baskısı" (Änderungsdruck) davranışı. `snapshot` artık
//   "doğuşta dondurulan plan" değil **son BASILAN kopyanın kaydıdır**; baskı olayı
//   onu tazeler ve içerik gerçekten değiştiyse `version++` eder (otomatik revizyon).
//   Kartın SUNUMU (şablon + sayfa/config) sürüm hesabına DAHİL DEĞİLDİR ama
//   2026-08-06'dan beri o da HER BASKIDA GÜNCELDİR — "şablon karta donar" kuralı
//   kaldırıldı (gerekçe: `resolvePrintPlan` başlığı). Tek karar noktası odur;
//   önizleme, baskı ve versiyon numarası ondan beslenir — ayrıştırırsan önizleme
//   "v2" der, baskı "v3" yazar.
// =============================================================================

import { Request } from "express";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import { isDailyCode, normalizeScanCode } from "../utils/code-format";
// NOT: `readTravelerCardConfig` artık BURADAN çağrılmıyor — kart config'i
// şablon çözümünden gelir (`travelerTemplateService.resolveForPrint`, şablon
// yoksa o zaten sistem ayarına düşer). Tip hâlâ gerekli.
import { type TravelerCardConfig } from "./system-setting.service";
import bwipjs from "bwip-js";
import {
  renderTravelerCard,
  type TravelerCardSnapshot,
  type TravelerBatchLine,
} from "./document-render/traveler-card.html";
import { travelerTemplateService } from "./traveler-template.service";
import type { TravelerPageSize } from "./document-render/traveler-card.density";
// Ölü top kümesi TEK KAYNAK — parti sayımında elle statü listesi kopyalama (K18).
import { K18_DEAD_STATUSES } from "./batch.service";
import { parseQueryParams, buildPagination, resolveSortBy, buildTextSearch } from "../utils/query-parser";
import {
  Prisma,
  PrintedDocStatus,
  PrintedDocType,
  TravelerCard,
  TravelerCardScan,
  TravelerCardStatus,
  ScanType,
  WorkOrderStatus,
} from "@prisma/client";

// Refakat kartı listesinde sıralanabilir kolonlar. createdAt BİLEREK yok →
// varsayılan/createdAt isteği printedAt'e düşer (yeni basılan kart ilk gelsin).
const TRAVELER_SORTABLE_FIELDS = ["printedAt", "cardNumber", "status", "version"] as const;

/** Kart kodu kabulü — İE (yeni tek-kod) birincil, RK (eski kart) legacy toleransı. */
function isCardCode(code: string): boolean {
  return isDailyCode(code, "IE") || isDailyCode(code, "RK");
}

/**
 * PLAN karşılaştırma anahtarı — iki snapshot'ın İÇERİK olarak aynı olup olmadığını
 * anahtar sırasından bağımsız söyler (otomatik revizyon kararı bunun üzerine kurulu).
 *
 * `config` + `template` BİLEREK DIŞARIDA: onlar kartın SUNUMU'dur, içeriği değil.
 * Şablon/sayfa düzenlemesi revizyon sayılsaydı, bir kez letterhead değiştirildiğinde
 * sahadaki HER kart bir sonraki baskısında sürüm atlar ve revizyon numarası "içerik
 * değişti" anlamını yitirirdi. Aynı ayrım `contentDirty` tarafında da geçerli —
 * şablon düzenlemesi kartı bayat İŞARETLEMEZ (markTravelerCardDirtyTx çağrılmaz).
 *
 * ⚠️ Anahtar sırası bağımsızlığı ŞART: Prisma alan sırasını garanti etmez, düz
 * `JSON.stringify` karşılaştırması hiç değişmemiş kartı "revize edildi" sayıp her
 * baskıda sürüm şişirirdi. Aynı sebeple `buildPlan` dizileri deterministik sıralar.
 */
function planKey(snapshot: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      return Object.keys(src)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortDeep(src[k]);
          return acc;
        }, {});
    }
    return v;
  };
  if (!snapshot || typeof snapshot !== "object") return "";
  const plan = { ...(snapshot as Record<string, unknown>) };
  delete plan.config;
  delete plan.template;
  return JSON.stringify(sortDeep(plan));
}

// Belge Şablonu (Refakat Kartı Ayarları) canlı önizlemesi için örnek içerik.
// Gerçek kart verisi DEĞİL; renderSampleHtml taslak config ile birleştirir.
const SAMPLE_TRAVELER_BARCODE = "IE1207260001"; // tek kod: İE + GGAAYY + NNNN (= iş emri no)
const SAMPLE_TRAVELER_SNAPSHOT: Omit<TravelerCardSnapshot, "config"> = {
  workOrderNumber: "IE1207260001",
  type: "ORDER_PRODUCTION",
  width: 150,
  targetQuantity: 680,
  targetWeight: 110,
  foldType: "Top",
  plannedStartDate: "2026-06-07T00:00:00.000Z",
  plannedEndDate: "2026-06-14T00:00:00.000Z",
  routeTemplate: { name: "Standart Boyama Rotası" },
  targetItem: { code: "KMS-001", name: "Pamuklu Astar" },
  targetColor: { name: "Bej", hex: "#d8c9a8" },
  targetProperties: [{ propertyId: "p1", property: { name: "Su İticilik" } }],
  steps: [
    { id: "step1", stepSequence: 1, isUrgent: false, notes: null, station: { name: "Ham Kalite (KK1)", type: "INTERNAL" }, plannedSubcontractor: null },
    { id: "step2", stepSequence: 2, isUrgent: false, notes: "Yıkama yapma, matlaştır", station: { name: "Boyahane", type: "EXTERNAL" }, plannedSubcontractor: { id: "sub1", name: "Yıldız Boyahane" } },
    { id: "step3", stepSequence: 3, isUrgent: false, notes: null, station: { name: "Kurşun + KK2", type: "INTERNAL" }, plannedSubcontractor: null },
    { id: "step4", stepSequence: 4, isUrgent: false, notes: null, station: { name: "Tambur", type: "INTERNAL" }, plannedSubcontractor: null },
  ],
  orderLinks: [
    {
      orderLineId: "ol1",
      orderLine: {
        quantity: 680,
        order: { orderNumber: "SIP-2026-0107", customer: { name: "Örnek Tekstil A.Ş." } },
        item: { name: "Pamuklu Astar" },
        color: { name: "Bej" },
      },
    },
    {
      orderLineId: "ol2",
      orderLine: {
        quantity: 320,
        order: { orderNumber: "SIP-2026-0108", customer: { name: "Deneme Konfeksiyon" } },
        item: { name: "Pamuklu Astar" },
        color: { name: "Lacivert" },
      },
    },
  ],
};

/** Önizleme partileri — gerçek veri DEĞİL (canlı kartta resolveLiveBatches çözer). */
const SAMPLE_TRAVELER_BATCHES: TravelerBatchLine[] = [
  {
    batchNumber: "P1207261",
    rollCount: 4,
    quantity: 1240,
    dispatch: { dispatchNo: "FS1207260001", subcontractorName: "Yıldız Boyahane", moreCount: 0 },
  },
  { batchNumber: "P1207262", rollCount: 2, quantity: 610, dispatch: null },
];

export class TravelerCardService {
  /**
   * İş emri açılışından (`workorder.service` create tx'i) çağrılan idempotent kart
   * üretici. Bir WO = tek kart. Kart zaten varsa döner ({created:false}); yoksa
   * version=1 ile üretir. Tek-kod: cardNumber = barcode = workOrderNumber (İE) →
   * sequence/barkod-retry YOK (kod deterministik, WO no benzersiz).
   *
   * Audit BU METOTTAN KALDIRILDI (tx içinde) — çağıran, `created:true` ise audit'i
   * tx COMMIT'inden SONRA yazar.
   */
  async createForWorkOrder(
    tx: Prisma.TransactionClient,
    workOrderId: string,
    userId?: string,
  ): Promise<{ card: TravelerCard; created: boolean }> {
    const existing = await tx.travelerCard.findUnique({ where: { workOrderId } });
    if (existing) return { card: existing, created: false };

    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { workOrderNumber: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const snapshot = await this.buildSnapshot(tx, workOrderId);
    const card = await tx.travelerCard.create({
      data: {
        cardNumber: wo.workOrderNumber, // = barcode (tek kod)
        barcode: wo.workOrderNumber,
        workOrderId,
        version: 1,
        status: TravelerCardStatus.ACTIVE,
        printedById: userId ?? null,
        snapshot,
      },
    });
    return { card, created: true };
  }

  /**
   * Kartı garanti eder (idempotent). Kart WO açılışında doğduğundan bu uç genelde
   * mevcut kartı döner; eski/kartsız WO'larda oluşturur. 409 ATMAZ.
   */
  async print(
    workOrderId: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    const runTx = () =>
      prisma.$transaction((tx) => this.createForWorkOrder(tx, workOrderId, userId));
    let result: { card: TravelerCard; created: boolean };
    try {
      result = await runTx();
    } catch (err) {
      // Eşzamanlı yarış (kartsız/eski WO'ya iki paralel print): ikisi de
      // findUnique'te kart görmez, kaybeden workOrderId @unique P2002'sine düşer.
      // Catch tx DIŞINDA (PG aborted-tx tuzağı) — tx BİR KEZ yeniden koşulur;
      // ikinci geçiş mevcut kartı bulup idempotent {created:false} döner (200,
      // ham 409 yerine). Bu tx yalnız travelerCard yazar → her P2002 buraya ait.
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isP2002) throw err;
      result = await runTx();
    }
    const { card, created } = result;
    if (created) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "TRAVELER_CARD",
        recordId: card.id,
        newData: { cardNumber: card.cardNumber, barcode: card.barcode, event: "PRINT" },
      });
    }
    return {
      success: true,
      data: card,
      message: created
        ? `Refakat kartı basıldı: ${card.cardNumber}`
        : `Refakat kartı zaten mevcut: ${card.cardNumber}`,
    };
  }

  /**
   * Yeniden basım — AYNI satırda: snapshot'ı GÜNCEL WO'dan tazeler + version++.
   * Karekod (İE) DEĞİŞMEZ. Yalnız ACTIVE kart yeniden basılabilir (iptal/tamamlanmış
   * WO'da 409).
   *
   * ⚠️ ARTIK GEREKLİ DEĞİL ve hiçbir istemci çağırmıyor: düz baskı hem güncel planı
   * basıyor (gerekirse otomatik revizyon) hem de güncel tasarımı kullanıyor
   * (2026-08-06). Geriye kalan tek farkı, içerik değişmese bile gerekçeyle sürüm
   * atlatması. Uç KALDIRILMADI çünkü "bu kartı gerekçeli olarak yeniden yayınladım"
   * ihtiyacı doğarsa hazır; yeni bir işlev için buna yamamak yerine gerekçesini yaz.
   */
  async reprint(
    workOrderId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("Yeniden basım için gerekçe zorunlu (en az 3 karakter)");
    }

    const runTx = () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.travelerCard.findUnique({ where: { workOrderId } });
        if (!existing) {
          // Kartsız (eski) WO — ilk kez üret.
          const created = await this.createForWorkOrder(tx, workOrderId, userId);
          return created.card;
        }
        if (existing.status !== TravelerCardStatus.ACTIVE) {
          throw AppError.conflict(
            `Kart aktif değil (${existing.status}) — iptal/tamamlanmış iş emrinin kartı yeniden basılamaz.`,
          );
        }
        const snapshot = await this.buildSnapshot(tx, workOrderId);
        return tx.travelerCard.update({
          where: { id: existing.id },
          data: {
            version: existing.version + 1,
            snapshot,
            printedById: userId ?? null,
            printedAt: new Date(),
            // Yeniden basım = eldeki kâğıt tazelendi → bayat işareti kalkar.
            contentDirty: false,
          },
        });
      });
    let card: TravelerCard;
    try {
      card = await runTx();
    } catch (err) {
      // print() ile aynı yarış: kartsız-WO dalında kaybeden P2002 alır → tx BİR KEZ
      // yeniden koşulur, ikinci geçiş mevcut kartı bulup normal reprint yolundan döner.
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isP2002) throw err;
      card = await runTx();
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: { cardNumber: card.cardNumber, version: card.version, event: "REPRINT", reason },
    });

    return {
      success: true,
      data: card,
      message: `Refakat kartı yeniden basıldı: ${card.cardNumber} (v${card.version})`,
    };
  }

  /**
   * BASKI OLAYI — "bu kart fiziksel olarak basıldı" bildirimi. Bayat işaretini
   * (`contentDirty`) temizler, `printedAt`'i tazeler ve **basılan planı kaydeder**.
   *
   * OTOMATİK REVİZYON (2026-08-05): snapshot artık "doğuşta donan içerik" değil
   * *son basılan kopyanın kaydı*dır. Baskıda plan yeniden çözülür; iş emri içeriği
   * gerçekten değiştiyse `version++` (revizyon), değişmediyse sürüm AYNI kalır
   * (aynı belgenin ikinci kopyası revizyon değildir). Karar `resolvePrintPlan`'da —
   * önizleme aynı fonksiyondan beslendiği için kâğıda basılan "v" ile DB'ye yazılan
   * "v" tanım gereği aynıdır. Sunum (şablon/sayfa) bu yolda TAZELENMEZ.
   *
   * ⚠️ NEDEN AYRI UÇ — `GET /traveler-cards/:id/html` bayrağı TEMİZLEYEMEZ:
   * o uç önizleme tarafından da çağrılır ("HTML almak" ≠ "basmak"), ve GET'in
   * yan etkisi olmamalı. Emsal: `POST /api/labels/rolls/:id/print` ve
   * `POST /api/labels/sacks/:id/print-event` — ikisi de `labelDirty`'yi orada
   * temizler. İstemci `printHtml` BAŞARIYLA döndükten sonra çağırır.
   *
   * `contentDirty: true` koşulu yok — baskı olayı her hâlükârda `printedAt`
   * tazeler; koşullu updateMany "zaten temizdi" durumunda tarihi güncellemezdi.
   *
   * ⚠️ BİLİNEN SINIR (bilinçli, makinesi kurulmadı): HTML'i çekmek ile "basıldı"
   * demek AYRI isteklerdir. İş emri tam o saniyelerde düzenlenirse kâğıt A planını
   * gösterir, burada kaydedilen B planı olur (ikisi de aynı sürüm numarasını taşır)
   * ve bayat işareti bir kez boşa temizlenir. Pencere saniyelerdir, sınıf olarak
   * YENİ DEĞİL (canlı partiler baştan beri aynı boşluğu taşıyor) ve bir sonraki WO
   * düzenlemesi işareti geri koyar. Gerçekten sorun olursa doğru çözüm istemcinin
   * bastığı sürümü geri bildirmesi + sunucunun sürüm oynamışsa 409 vermesidir;
   * "her ihtimale karşı temizleme" gibi yarım çözümler işareti tümden güvenilmez yapar.
   */
  async recordPrintEvent(cardId: string, userId?: string): Promise<ApiResponse<null>> {
    const card = await prisma.travelerCard.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        cardNumber: true,
        status: true,
        contentDirty: true,
        version: true,
        snapshot: true,
        workOrderId: true,
      },
    });
    if (!card) throw AppError.notFound("Refakat kartı bulunamadı");

    const plan = await this.resolvePrintPlan(card);

    // Kart satırı ve belge defteri AYNI transaction'da yazılır: kâğıda basılan
    // sürüm numarası (kart) ile o sürümün arşiv kopyası (defter) ayrışamamalı.
    await prisma.$transaction(async (tx) => {
      await tx.travelerCard.update({
        where: { id: cardId },
        data: {
          contentDirty: false,
          printedAt: new Date(),
          printedById: userId ?? null,
          snapshot: plan.snapshot as unknown as Prisma.InputJsonValue,
          version: plan.version,
        },
      });
      await this.archivePrintedVersionTx(tx, {
        cardId,
        cardNumber: card.cardNumber,
        version: plan.version,
        snapshot: plan.snapshot,
        userId,
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "TRAVELER_CARD",
      recordId: cardId,
      // Revizyon ile düz kopya AYRI olaylardır: denetimde "bu kâğıt neden değişti"
      // sorusunun cevabı sürüm numarasının yanında yazılı olmalı.
      newData: {
        cardNumber: card.cardNumber,
        event: plan.revised ? "PRINT_REVISION" : "PRINT_EVENT",
        wasDirty: card.contentDirty,
        version: plan.version,
      },
    });

    return {
      success: true,
      data: null,
      message: plan.revised
        ? `Refakat kartı güncel içerikle basıldı — revizyon v${plan.version}`
        : "Baskı kaydedildi",
    };
  }

  /**
   * BASILAN SÜRÜMÜ DEFTERE ARŞİVLER (2026-08-17 saha isteği: "eski versiyonu da
   * görebilelim").
   *
   * ⚠️ YENİ TABLO AÇILMADI — `printed_documents` yeniden kullanılır. Kolonlar
   * birebir uyuyor (docType/sourceId/version/status/snapshot/printedById) ve
   * `listVersions`/`getVersion` uçları zaten domain bilmez, yani geçmiş listesi
   * ve tek sürüm okuma bedelsiz gelir. `sourceId` = **kart id'si**: iş emri belge
   * listesi (`getDocuments`) refakat kartını zaten bu kimlikle basıyor.
   *
   * ⚠️ CREATE DEĞİL UPSERT. "Aynı içeriğin ikinci kopyası revizyon değildir"
   * kuralı gereği sürüm ARTMAZ; düz `create` ikinci kopyada
   * `@@unique([docType,sourceId,version])`'a çarpar ve **baskı yolunu düşürürdü**
   * — hem de operatör elinde kâğıt tutarken.
   *
   * Kart tek satırdır (`workOrderId @unique`) ve sürüm orada artar; defter yalnız
   * ARŞİVDİR. Bu yüzden bu tip için generic freeze/reissue yolları KAPALIDIR
   * (bkz. `SELF_MANAGED_DOC_TYPES`) — ikinci bir sürüm üretici, kâğıda basılan
   * numara ile kayıtlı numaranın eşitliğini sessizce bozardı.
   */
  private async archivePrintedVersionTx(
    tx: Prisma.TransactionClient,
    p: {
      cardId: string;
      cardNumber: string;
      version: number;
      snapshot: TravelerCardSnapshot;
      userId?: string;
    },
  ): Promise<void> {
    const snapshot = p.snapshot as unknown as Prisma.InputJsonValue;
    await tx.printedDocument.upsert({
      where: {
        docType_sourceId_version: {
          docType: PrintedDocType.TRAVELER_CARD,
          sourceId: p.cardId,
          version: p.version,
        },
      },
      create: {
        docType: PrintedDocType.TRAVELER_CARD,
        sourceId: p.cardId,
        version: p.version,
        status: PrintedDocStatus.ACTIVE,
        documentNo: p.cardNumber,
        snapshot,
        printedById: p.userId ?? null,
      },
      // Aynı sürümün yeniden basımı: içerik tanım gereği aynı (planKey eşit),
      // yalnız sunum tazelenmiş olabilir + son basan kişi güncellenir.
      update: { snapshot, printedById: p.userId ?? null },
    });

    // Önceki sürümler tarihsel kopyaya düşer. Koşulsuz koşar (revize olmayan
    // baskıda hiçbir satır eşleşmez) — "yalnız revizyonda çalıştır" dalı, bir
    // sonraki değişiklikte unutulacak ikinci bir kural olurdu.
    await tx.printedDocument.updateMany({
      where: {
        docType: PrintedDocType.TRAVELER_CARD,
        sourceId: p.cardId,
        status: PrintedDocStatus.ACTIVE,
        version: { not: p.version },
      },
      data: { status: PrintedDocStatus.SUPERSEDED, supersededAt: new Date() },
    });
  }

  /**
   * Aktif kartı manuel olarak iptal eder (VOIDED). Atomik claim (ACTIVE→VOIDED).
   */
  async voidCard(
    cardId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("İptal gerekçesi zorunlu (en az 3 karakter)");
    }

    const card = await prisma.travelerCard.findUnique({ where: { id: cardId } });
    if (!card) throw AppError.notFound("Refakat kartı bulunamadı");
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.badRequest(
        `Sadece ACTIVE durumdaki kart iptal edilebilir (mevcut: ${card.status})`,
      );
    }

    const claim = await prisma.travelerCard.updateMany({
      where: { id: cardId, status: TravelerCardStatus.ACTIVE },
      data: { status: TravelerCardStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Kart bu sırada iptal edildi veya durumu değişti");
    }
    const updated = await prisma.travelerCard.findUnique({ where: { id: cardId } });
    if (!updated) throw AppError.notFound("Refakat kartı bulunamadı");

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "TRAVELER_CARD",
      recordId: cardId,
      oldData: { status: TravelerCardStatus.ACTIVE },
      newData: { status: TravelerCardStatus.VOIDED, reason },
    });

    return {
      success: true,
      data: updated,
      message: `Refakat kartı iptal edildi: ${updated.cardNumber}`,
    };
  }

  /**
   * İstasyon taraması — barkodu oku, ACTIVE kart ise scan kaydı oluştur.
   * workOrderStepId otomatik çözümlenir (WO'nun bu istasyondaki PENDING/ACTIVE adımı).
   */
  async scan(
    data: {
      barcode: string;
      stationId: string;
      scanType: ScanType;
      notes?: string;
      deviceId?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<TravelerCardScan>> {
    // ⚠️ BİÇİM KONTROLÜ NORMALİZE EDİLMİŞ KODLA (2026-08-17): eskiden ham değere
    // bakıyordu ve küçük harf gelen kart okutması, arama yapılmadan ÖNCE
    // "Geçersiz barkod formatı" ile düşüyordu — mesaj da yanıltıcıydı (kod
    // geçerliydi, yalnız yazımı farklıydı).
    const scanned = normalizeScanCode(data.barcode);
    if (!isCardCode(scanned)) {
      throw AppError.badRequest("Geçersiz barkod formatı");
    }

    const card = await prisma.travelerCard.findUnique({
      where: { barcode: scanned },
      include: {
        workOrder: { include: { steps: { orderBy: { stepSequence: "asc" } } } },
      },
    });

    if (!card) throw AppError.notFound("Barkod sistemde kayıtlı değil");
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.conflict(
        `Bu kart artık geçerli değil: ${card.status}. Kart numarası: ${card.cardNumber}`,
      );
    }
    if (
      card.workOrder.status === WorkOrderStatus.CANCELLED ||
      card.workOrder.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict("Bağlı iş emri iptal/devredilmiş");
    }

    const station = await prisma.station.findUnique({
      where: { id: data.stationId },
      select: { isActive: true },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");
    if (!station.isActive) throw AppError.badRequest("İstasyon pasif — okutma yapılamaz");

    // İstasyona karşılık gelen step'i bul (birden fazla varsa PENDING/ACTIVE olanı tercih et)
    const woSteps = card.workOrder.steps;
    const matchingStep =
      woSteps.find(
        (s) => s.stationId === data.stationId && s.status !== "COMPLETED" && s.status !== "SKIPPED",
      ) ?? woSteps.find((s) => s.stationId === data.stationId);

    // Çift okutma dedup'u (UX): aynı kart + istasyon + tarama tipi son 10 sn
    // içinde kaydedildiyse yeni satır/audit YAZMA — mevcut kaydı idempotent döndür
    // (wedge çift-burst'ü ve el titremesi yeniden-okutmayı örter; ARRIVAL/DEPARTURE
    // ayrı scanType olduğundan meşru ardışık taramalar etkilenmez; mevcut
    // @@index([cardId, scannedAt Desc]) sorguyu sürer). Bilinçli sınır: bu bir
    // check-then-act penceresi — eşzamanlı iki istek yine iki satır yazabilir;
    // append-only log için kabul, unique/kova mühendisliği yapılmadı.
    const DUP_SCAN_WINDOW_MS = 10_000;
    const recentDup = await prisma.travelerCardScan.findFirst({
      where: {
        cardId: card.id,
        stationId: data.stationId,
        scanType: data.scanType,
        scannedAt: { gte: new Date(Date.now() - DUP_SCAN_WINDOW_MS) },
      },
      orderBy: { scannedAt: "desc" },
      include: { station: true, step: true },
    });
    if (recentDup) {
      return {
        success: true,
        data: recentDup,
        message: `Tarama zaten kaydedildi (mükerrer okutma): ${card.cardNumber} @ ${recentDup.station.name}`,
      };
    }

    const scan = await prisma.travelerCardScan.create({
      data: {
        cardId: card.id,
        stationId: data.stationId,
        workOrderStepId: matchingStep?.id ?? null,
        scanType: data.scanType,
        scannedById: userId ?? null,
        deviceId: data.deviceId ?? null,
        notes: data.notes ?? null,
      },
      include: { station: true, step: true },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD_SCAN",
      recordId: scan.id,
      newData: {
        cardId: card.id,
        barcode: card.barcode,
        stationId: data.stationId,
        scanType: data.scanType,
      },
    });

    return {
      success: true,
      data: scan,
      message: `Tarama kaydedildi: ${card.cardNumber} @ ${scan.station.name}`,
    };
  }

  /**
   * Aktif refakat kartlarını listeler — mobil ekranlarda "kart seç" picker'ı için.
   *  - `?filter[status]=ACTIVE|...|ALL` (default: ACTIVE)
   *  - `?filter[workOrderId]=...` — WO'ya birebir filtre
   *  - `?search=...` — cardNumber/barcode TAM eşleşme + workOrderNumber contains
   */
  async list(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where: Prisma.TravelerCardWhereInput = {};

    const woFilter = params.filters.workOrderId;
    if (typeof woFilter === "string" && woFilter) where.workOrderId = woFilter;

    const statusFilter = params.filters.status;
    if (statusFilter === "ALL" || (Array.isArray(statusFilter) && statusFilter.includes("ALL"))) {
      // no status filter
    } else if (Array.isArray(statusFilter)) {
      where.status = { in: statusFilter as TravelerCardStatus[] };
    } else if (typeof statusFilter === "string") {
      where.status = statusFilter as TravelerCardStatus;
    } else {
      where.status = TravelerCardStatus.ACTIVE;
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      const qUpper = q.toUpperCase();
      where.OR = [
        { cardNumber: qUpper },
        { barcode: qUpper },
        ...buildTextSearch<Prisma.TravelerCardWhereInput>(q, {
          code: ["workOrder.workOrderNumber"],
        }),
      ];
    }

    const { skip, take } = buildPagination(params.page, params.pageSize);
    const sortField = resolveSortBy(params.sortBy, TRAVELER_SORTABLE_FIELDS, "printedAt");
    const orderBy = { [sortField]: params.sortOrder };

    const [items, total] = await Promise.all([
      prisma.travelerCard.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          cardNumber: true,
          barcode: true,
          version: true,
          status: true,
          workOrderId: true,
          printedAt: true,
          contentDirty: true,
          workOrder: {
            select: {
              id: true,
              workOrderNumber: true,
              status: true,
              type: true,
              targetItem: { select: { id: true, code: true, name: true } },
              targetColor: { select: { id: true, code: true, name: true, hex: true } },
            },
          },
        },
      }),
      prisma.travelerCard.count({ where }),
    ]);

    return {
      success: true,
      data: items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize) || 1,
      },
    };
  }

  /**
   * Kartı tek kodu (barkod = kart numarası = iş emri no) ile bulur. İE (yeni) veya
   * RK (eski/legacy) kabul edilir. Tarama öncesi önizleme.
   */
  async findByBarcode(
    input: string,
  ): Promise<ApiResponse<(Omit<TravelerCard, "snapshot"> & { hasOpenDispatch: boolean }) | null>> {
    const normalized = normalizeScanCode(input);
    if (!isCardCode(normalized)) {
      throw AppError.badRequest("Geçersiz format. Beklenen: İE1207260001 (iş emri kartı)");
    }

    const card = await prisma.travelerCard.findFirst({
      where: { OR: [{ barcode: normalized }, { cardNumber: normalized }] },
      omit: { snapshot: true },
      include: {
        workOrder: {
          include: {
            targetItem: true,
            targetColor: true,
            steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          },
        },
        scans: { orderBy: { scannedAt: "desc" }, take: 20, include: { station: true } },
      },
    });

    if (!card) {
      return { success: false, data: null, message: "Kart bulunamadı" };
    }

    // Fason Sevk akışı: bu WO için açık (cancelledAt=null + mal kabul tam değil) sevk
    // varsa mobil UI erken uyarı verir (backend dispatch de ayrıca 409 atabilir).
    const openDispatchCount = await prisma.subcontractorDispatch.count({
      where: {
        workOrderId: card.workOrderId,
        cancelledAt: null,
        items: { some: { receiptItems: { none: {} } } },
      },
    });

    const data = { ...card, hasOpenDispatch: openDispatchCount > 0 };
    return { success: true, data };
  }

  /**
   * Bir iş emrinin kartı + tarama geçmişi (WO = tek kart).
   */
  async getHistory(workOrderId: string): Promise<ApiResponse<unknown>> {
    const cards = await prisma.travelerCard.findMany({
      where: { workOrderId },
      orderBy: { version: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
        scans: {
          orderBy: { scannedAt: "asc" },
          include: {
            station: true,
            step: true,
            scannedBy: { select: { id: true, username: true, fullName: true } },
          },
        },
      },
    });
    return { success: true, data: cards };
  }

  /**
   * İş emrinin PARTİLERİNİ baskı anında CANLI çözer (kart snapshot'ında DEĞİL).
   *
   * Neden canlı: kart WO AÇILIŞINDA donar, parti `attachRolls`'ta doğar — Hızlı
   * İş Emri'nde sıra create → attach → dispatch. Snapshot'a yazılsaydı parti
   * kartta HER ZAMAN boş çıkardı (özelliğin en çok istendiği akışta tam olarak
   * işe yaramazdı). Parti ayrıca bölünüp birleşebilir; kart malla gezen
   * operasyon kâğıdıdır, donmuş muhasebe belgesi değil.
   *
   * Üç kural:
   *   • `mergedIntoId != null` partiler ATLANIR — başkasının altına birleşmiş
   *     parti tarihçedir, sahada o numarayla bir mal yoktur (K15).
   *   • Top sayımı/metrajı K18 ölü statülerini (tüketilmiş/iptal) DIŞLAR.
   *   • Sevk yalnız iptal EDİLMEMİŞ olanlardan; en yenisi basılır, ondan
   *     öncekiler `(+N)` ile sayılır (çok fason adımlı rotada parti birden çok
   *     kez dışarı çıkabilir).
   */
  private async resolveLiveBatches(workOrderId: string): Promise<TravelerBatchLine[]> {
    const batches = await prisma.batch.findMany({
      where: { workOrderId, mergedIntoId: null },
      // ⚠️ `batchNumber` ile SIRALAMA YOK: parti no dolgusuzdur (P0508262 …
      // P05082610) → sözlüksel sıra sayısal sırayı ters çevirir. Doğuş sırası
      // zaten istenen sıradır ve diğer tüm parti listeleri de böyle sıralar.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, batchNumber: true },
    });
    if (batches.length === 0) return [];
    const ids = batches.map((b) => b.id);

    const rollAgg = await prisma.roll.groupBy({
      by: ["batchId"],
      where: { batchId: { in: ids }, status: { notIn: K18_DEAD_STATUSES } },
      _count: { _all: true },
      _sum: { currentQty: true },
    });
    const aggByBatch = new Map(
      rollAgg.map((r) => [
        r.batchId,
        { count: r._count._all, qty: r._sum.currentQty == null ? null : Number(r._sum.currentQty) },
      ]),
    );

    // En yeni önce → ilk görülen partinin "canlı" sevki, sonrakiler sayılır.
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { batchId: { in: ids }, cancelledAt: null },
      orderBy: { dispatchedAt: "desc" },
      select: { batchId: true, dispatchNo: true, subcontractor: { select: { name: true } } },
    });
    const dispByBatch = new Map<string, TravelerBatchLine["dispatch"]>();
    for (const d of dispatches) {
      const seen = dispByBatch.get(d.batchId);
      if (seen) {
        seen.moreCount += 1;
        continue;
      }
      dispByBatch.set(d.batchId, {
        dispatchNo: d.dispatchNo,
        subcontractorName: d.subcontractor?.name ?? "—",
        moreCount: 0,
      });
    }

    return batches.map((b) => {
      const agg = aggByBatch.get(b.id);
      return {
        batchNumber: b.batchNumber,
        rollCount: agg?.count ?? 0,
        quantity: agg?.qty ?? null,
        dispatch: dispByBatch.get(b.id) ?? null,
      };
    });
  }

  /**
   * BASILACAK PLANI ÇÖZ — önizleme, baskı ve versiyon numarasının TEK KAYNAĞI.
   *
   * Üç karar burada birlikte verilir, çünkü ayrıştıkları anda önizlemedeki "v2" ile
   * DB'ye yazılan "v3" birbirinden kopar ve kâğıttaki revizyon numarası içeriği
   * tanımlamaz olur (revizyon kontrolünün tamamı bu eşitliğe dayanır):
   *
   *   ① İÇERİK — ACTIVE kartta iş emrinin GÜNCEL hâli (yürürlükteki plan sahaya iner).
   *   ② SUNUM  — şablon + sayfa/config HER ZAMAN GÜNCEL (kartın yaşına bakılmaz).
   *   ③ SÜRÜM  — içerik gerçekten değiştiyse +1 (revizyon), aksi halde aynı.
   *
   * ⚠️ SUNUM NEDEN DONMUYOR (2026-08-06 — "şablon karta donar" kuralı KALDIRILDI):
   * Aynı kararın diğer yarısı zaten "tasarım değişikliği revizyon SAYILMAZ" diyor
   * (`planKey` config/template'i dışlar). Bir şey revizyon değilse dondurmanın da
   * işi kalmaz — dondurmak yalnız yan etkisini bırakırdı: tasarımı değiştirme
   * sebebi genelde *"sahada okunmuyor"*dur ve donmuş sunum, düzeltmeyi tam da
   * düzeltilmesi gereken kâğıtlara ulaştırmaz (ölçüm 2026-08-06: 30 aktif kartın
   * 11'i bir haftadan eski — haftalarca eski tasarımla basmaya devam ederlerdi).
   * Sayfa boyutu da buna dahildir; baskı başına A4/A5 ezmesi diyalogda duruyor.
   * ⚠️ Bu, eski `test_traveler_template` E2 kuralının BİLİNÇLİ tersi — geri almadan
   * önce yukarıdaki gerekçeyi çürüt.
   *
   * ⚠️ ACTIVE OLMAYAN kart (VOIDED/COMPLETED/REPRINTED) **hiç revize edilmez**:
   * elde olan tarihsel bir kopyadır, iptal edilmiş kartın İÇERİĞİNİ bugünkü planla
   * tazelemek belgeyi geçmişe dönük değiştirmek olurdu. Sunumu yine de güncel gelir —
   * o belgenin kaydı değil, kâğıda nasıl çizildiğidir.
   *
   * ⚠️ İş emri okunamazsa (silinmiş/erişilemez) **eldeki snapshot'a düşülür**:
   * baskı yolunu düşürmek, biraz eski bir kâğıt basmaktan kötüdür.
   *
   * ⚠️ `snapshot` NULL olan eski kartta sürüm ARTMAZ — karşılaştırılacak bir önceki
   * içerik yok; revize edilecek bir şey de yok, sadece ilk kayıt oluşur.
   */
  /**
   * ARŞİV KOPYASI — `?version=N` ile geçmiş bir sürümü çözer.
   *
   * İÇERİK donmuştur (o gün basılan plan), SUNUM güncel ayardan gelir — canlı
   * kartla birebir aynı ayrım (`resolvePrintPlan` başlığı: bir şey revizyon
   * değilse dondurmanın da işi yoktur). Yani eski sürüme bakan kişi "o gün ne
   * yazıyordu"yu görür, "o gün hangi puntoyla basılmıştı"yı değil.
   *
   * Bilinmeyen sürüm 404 — sessizce güncele düşmek, operatöre baktığını sandığı
   * belgeden BAŞKASINI göstermek olurdu.
   */
  private async resolveArchivedPlan(
    cardId: string,
    version: number,
  ): Promise<{
    snapshot: TravelerCardSnapshot;
    version: number;
    revised: boolean;
    printedAt?: Date;
  }> {
    const row = await prisma.printedDocument.findUnique({
      where: {
        docType_sourceId_version: {
          docType: PrintedDocType.TRAVELER_CARD,
          sourceId: cardId,
          version,
        },
      },
      select: { snapshot: true, version: true, createdAt: true },
    });
    if (!row) throw AppError.notFound(`Refakat kartının v${version} kopyası bulunamadı`);

    const { template, config } = await travelerTemplateService.resolveForPrint(null, prisma);
    return {
      snapshot: {
        ...(row.snapshot as unknown as TravelerCardSnapshot),
        config,
        template,
      } as TravelerCardSnapshot,
      version: row.version,
      revised: false,
      printedAt: row.createdAt,
    };
  }

  private async resolvePrintPlan(card: {
    status: TravelerCardStatus;
    version: number;
    snapshot: Prisma.JsonValue | null;
    workOrderId: string;
  }): Promise<{
    snapshot: TravelerCardSnapshot;
    version: number;
    revised: boolean;
    printedAt?: Date;
  }> {
    const stored = card.snapshot as unknown as TravelerCardSnapshot | null;
    // SUNUM her yolda GÜNCEL — tek çözüm noktası, dallardan ÖNCE (aşağıdaki her
    // dönüş onu kullanır; dala kopyalanırsa biri sessizce donmuş kalır).
    const { template, config } = await travelerTemplateService.resolveForPrint(null, prisma);
    const dress = (base: TravelerCardSnapshot): TravelerCardSnapshot =>
      ({ ...base, config, template }) as TravelerCardSnapshot;

    // İçeriği donmuş dal: geçersiz kart (tarihsel kopya) ya da okunamayan iş emri.
    const keepContent = async (): Promise<TravelerCardSnapshot> =>
      dress(
        stored ??
          ((await this.buildSnapshot(prisma, card.workOrderId)) as unknown as TravelerCardSnapshot),
      );

    if (card.status !== TravelerCardStatus.ACTIVE) {
      return { snapshot: await keepContent(), version: card.version, revised: false };
    }

    const plan = await this.buildPlan(prisma, card.workOrderId);
    if (!plan) return { snapshot: await keepContent(), version: card.version, revised: false };

    const snapshot = dress({ config, template, ...plan } as unknown as TravelerCardSnapshot);
    // Karşılaştırma yalnız İÇERİĞE bakar (planKey config/template'i atar) — tasarım
    // değişikliği sürüm ARTIRMAZ, yoksa tek bir punto düzenlemesi sahadaki her kartı
    // bir sonraki baskıda revize göstermiş olurdu.
    const revised = stored != null && planKey(stored) !== planKey(snapshot);
    return { snapshot, version: card.version + (revised ? 1 : 0), revised };
  }

  /**
   * Refakat kartının resmi HTML çıktısı — TEK KAYNAK (Electron + mobil aynı HTML).
   * İçerik `resolvePrintPlan`'dan gelir: ACTIVE kartta iş emrinin GÜNCEL hâli,
   * geçersiz kartta donmuş kopya. QR = barkod (İE). Partiler zaten canlı çözülür
   * (bkz. resolveLiveBatches).
   *
   * ⚠️ Basılan versiyon numarası da oradan gelir — kart henüz revize EDİLMEDİĞİ
   * hâlde önizleme "bu baskı v2 olacak" der ve `recordPrintEvent` tam o numarayı
   * yazar. GET yan etkisizdir: önizleyip kapatan kullanıcı hiçbir şey değiştirmez.
   *
   * `opts.pageSize` = TEK SEFERLİK sayfa boyutu ezmesi (baskı diyaloğundan). Kalıcı
   * ayarı da donmuş snapshot'ı da EZER ama HİÇBİR YERE YAZILMAZ ve yeni kart
   * versiyonu doğurmaz — belge kolonu `?rowNotes=1` bayrağıyla aynı sözleşme.
   * Meşru sayılmasının sebebi: sayfa boyutu SUNUM kararıdır, belgenin İÇERİĞİ
   * değil — kart hangi kâğıda basılırsa basılsın aynı şeyi söyler.
   */
  async getCardHtml(
    cardId: string,
    opts?: { pageSize?: TravelerPageSize; version?: number },
  ): Promise<string> {
    const card = await prisma.travelerCard.findUnique({
      where: { id: cardId },
      select: {
        cardNumber: true,
        barcode: true,
        version: true,
        printedAt: true,
        status: true,
        voidReason: true,
        snapshot: true,
        workOrderId: true,
      },
    });
    if (!card) throw new AppError("Refakat kartı bulunamadı", 404);

    const plan = opts?.version
      ? await this.resolveArchivedPlan(cardId, opts.version)
      : await this.resolvePrintPlan(card);
    // Tek seferlik ezme yalnız BU render'ın kopyasına uygulanır — `card.snapshot`
    // satırına dokunulmaz (kartın kendi sayfa boyutu korunur).
    const snapshot: TravelerCardSnapshot = opts?.pageSize
      ? {
          ...plan.snapshot,
          config: { ...(plan.snapshot.config ?? {}), pageSize: opts.pageSize } as TravelerCardConfig,
        }
      : plan.snapshot;

    let qrSvg: string | null = null;
    try {
      qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: card.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    } catch {
      qrSvg = null;
    }

    return renderTravelerCard(snapshot, {
      cardNumber: card.cardNumber,
      barcode: card.barcode,
      // Kâğıda basılan sürüm = baskı kaydedildiğinde yazılacak sürüm (tek kaynak).
      version: plan.version,
      // Arşiv kopyasında tarih O BASKININ tarihidir; kartın son baskı tarihini
      // yazmak geçmiş kâğıda bugünün damgasını vurmak olurdu.
      printedAt: (plan.printedAt ?? card.printedAt).toISOString(),
      status: card.status,
      voidReason: card.voidReason,
      qrSvg,
      // ⚠️ Partiler arşiv kopyasında da CANLI çözülür: parti bloğu baştan beri
      // snapshot'ta değil (kart WO açılışında doğar, parti attachRolls'ta) —
      // donmuş bir parti listesi diye bir şey hiç var olmadı.
      batches: await this.resolveLiveBatches(card.workOrderId),
    });
  }

  /**
   * ÖRNEK HTML — "Refakat Kartı Ayarları" panelindeki canlı önizleme.
   * Örnek partiler bilerek KARIŞIK: biri fasona çıkmış, biri içeride — ayarı
   * yapan kişi "Sevk" sütununun dolu ve boş hâlini aynı anda görsün.
   */
  async renderSampleHtml(
    config: TravelerCardConfig,
    /** Stüdyo taslağı — KAYDEDİLMEDEN önizlenir (uzman modunda ham HTML dahil).
     *  Verilmezse yerleşik kart. Önizleme = gerçek baskı yolu (aynı dağıtıcı). */
    template?: TravelerCardSnapshot["template"],
  ): Promise<string> {
    const snapshot: TravelerCardSnapshot = { ...SAMPLE_TRAVELER_SNAPSHOT, config, template };
    let qrSvg: string | null = null;
    try {
      qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: SAMPLE_TRAVELER_BARCODE, scale: 3, backgroundcolor: "FFFFFF" });
    } catch {
      qrSvg = null;
    }
    return renderTravelerCard(snapshot, {
      cardNumber: SAMPLE_TRAVELER_BARCODE,
      barcode: SAMPLE_TRAVELER_BARCODE,
      version: 1,
      printedAt: "2026-06-07T10:30:00.000Z",
      qrSvg,
      draft: true,
      batches: SAMPLE_TRAVELER_BATCHES,
    });
  }

  /**
   * Kartın İÇERİĞİ (plan) — sunum (şablon/config) HARİÇ. Değişken veriler
   * (top sayısı/metraj/parti) buraya girmez; onlar baskı anında canlı çözülür.
   *
   * ⚠️ Diziler DETERMİNİSTİK sıralanır (`targetProperties`, `orderLinks`). Prisma
   * `orderBy` verilmeyen ilişkide satır sırasını garanti etmez; sıra oynadığında
   * `planKey` karşılaştırması "içerik değişti" der ve hiç değişmemiş kart her
   * baskıda sürüm atlardı. Sıra ayrıca kâğıttaki satır sırasıdır — sabit olması
   * operatörün iki kopyayı karşılaştırabilmesi için de gerekli.
   *
   * @returns WO okunamazsa `null` (çağıran eldeki snapshot'a düşer).
   */
  private async buildPlan(
    client: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<Record<string, unknown> | null> {
    const wo = await client.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        workOrderNumber: true,
        type: true,
        width: true,
        targetQuantity: true,
        targetWeight: true,
        foldType: true,
        plannedStartDate: true,
        plannedEndDate: true,
        routeTemplate: { select: { name: true } },
        targetItem: { select: { code: true, name: true } },
        targetColor: { select: { name: true, hex: true } },
        targetProperties: {
          orderBy: { propertyId: "asc" },
          select: { propertyId: true, property: { select: { name: true } } },
        },
        steps: {
          orderBy: { stepSequence: "asc" },
          select: {
            id: true,
            stepSequence: true,
            isUrgent: true,
            notes: true,
            station: { select: { name: true, type: true } },
            plannedSubcontractor: { select: { id: true, name: true } },
          },
        },
        orderLinks: {
          orderBy: { orderLineId: "asc" },
          select: {
            orderLineId: true,
            orderLine: {
              select: {
                quantity: true,
                order: {
                  select: { orderNumber: true, customer: { select: { name: true } } },
                },
                item: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!wo) return null;
    const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));
    return {
      workOrderNumber: wo.workOrderNumber, // İş Emri no (İE…) — kartta iri kimlik
      type: wo.type,
      width: num(wo.width),
      targetQuantity: num(wo.targetQuantity),
      targetWeight: num(wo.targetWeight),
      foldType: wo.foldType,
      plannedStartDate: wo.plannedStartDate?.toISOString() ?? null,
      plannedEndDate: wo.plannedEndDate?.toISOString() ?? null,
      routeTemplate: wo.routeTemplate ? { name: wo.routeTemplate.name } : null,
      targetItem: wo.targetItem
        ? { code: wo.targetItem.code, name: wo.targetItem.name }
        : null,
      targetColor: wo.targetColor
        ? { name: wo.targetColor.name, hex: wo.targetColor.hex }
        : null,
      targetProperties: wo.targetProperties.map((p) => ({
        propertyId: p.propertyId,
        property: { name: p.property.name },
      })),
      steps: wo.steps.map((st) => ({
        id: st.id,
        stepSequence: st.stepSequence,
        isUrgent: st.isUrgent,
        notes: st.notes,
        station: st.station ? { name: st.station.name, type: st.station.type } : null,
        plannedSubcontractor: st.plannedSubcontractor
          ? { id: st.plannedSubcontractor.id, name: st.plannedSubcontractor.name }
          : null,
      })),
      orderLinks: wo.orderLinks.map((l) => ({
        orderLineId: l.orderLineId,
        orderLine: l.orderLine
          ? {
              quantity: num(l.orderLine.quantity),
              order: l.orderLine.order
                ? {
                    orderNumber: l.orderLine.order.orderNumber,
                    customer: l.orderLine.order.customer
                      ? { name: l.orderLine.order.customer.name }
                      : null,
                  }
                : null,
              item: l.orderLine.item ? { name: l.orderLine.item.name } : null,
              color: l.orderLine.color ? { name: l.orderLine.color.name } : null,
            }
          : null,
      })),
    };
  }

  /**
   * Kartın TAM snapshot'ı = plan + SUNUM (şablon/config). Kart doğuşu ve `reprint`
   * için; baskı yolu `resolvePrintPlan` üzerinden gider (o da sunumu aynı şekilde
   * güncel çözer, yani ikisi ayrışmaz).
   *
   * `config` sistem ayarından DEĞİL şablondan gelir; şablon yoksa `resolveForPrint`
   * zaten sistem ayarına düşer → şablonsuz kurulumda davranış Faz 2 öncesiyle aynı.
   */
  private async buildSnapshot(
    client: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<Prisma.InputJsonValue> {
    const plan = await this.buildPlan(client, workOrderId);
    if (!plan) return {};
    const { template, config } = await travelerTemplateService.resolveForPrint(null, client);
    return { config, template, ...plan } as unknown as Prisma.InputJsonValue;
  }
}
