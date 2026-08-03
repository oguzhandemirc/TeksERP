// =============================================================================
// TeksERP — TAMBUR SAHA DÜZELTMESİ (operatör self-servis)
// =============================================================================
// Tambur operatörü sahada tıkandığında panel başındaki birini beklemesin diye iki
// yetenek: (1) MEVCUT TOPU BURAYA AL — sistemde olan bir topu bu Tambur adımına
// getir; (2) MANUEL TOP EKLE — sistemde HİÇ olmayan bir topu elle yarat ve doğrudan
// Tambur adımına bağla. İzin: `mobile:tambur-duzelt` (ya da `roll:manual-adjust`).
//
// -----------------------------------------------------------------------------
// NEDEN AYRI SERVİS — ve neden burada TAŞIMA MANTIĞI YOK
// -----------------------------------------------------------------------------
// "Buraya al" tek satır bile taşıma kodu yazmaz: `WorkOrderManualMoveService`e
// delege eder (movement kapatma/açma, hedef-sonrası hayalet movement temizliği,
// kalite VOID'i, parti kararı, adım recompute, COMPLETED WO + refakat kartı
// diriltme). Paralel bir taşıma yolu yazmak, iki yolun zamanla ayrışması demekti;
// saha yolu sessizce eksik guard'lı kalırdı. Bu dosyanın işi yalnız ÜÇ şey:
//   • bağlamı çözmek (hangi Tambur adımı, oturum hangi istasyonda),
//   • saha operatörüne uygun DAR guard'ları koymak (aşağıda),
//   • mobil için makine-okunur `code`'lu, tek-top odaklı bir cevap üretmek.
//
// -----------------------------------------------------------------------------
// MANUEL TOP EKLEME = ENVANTER ZİNCİRİNDEKİ İLK DELİK (bilinçli)
// -----------------------------------------------------------------------------
// Bugüne kadar hiçbir top yoktan var edilmiyordu: her top ya KK1 girişine, ya bir
// fason kabul makbuzuna (belgeye bağlı), ya da mevcut bir topun kesilmesine
// dayanıyordu. Bu uç o zinciri kırar. Delik SESSİZ olmasın diye üç kalıcı iz:
//   1. `Roll.entrySource = MANUAL_ENTRY`  → KOLON. Kalıcı, indeksli
//      (`@@index([entrySource, createdAt])`) → "elle eklenen toplar" raporu tek
//      filtreyle çıkar. Zincir dışı doğumun MAKİNE-OKUNUR işareti budur.
//   2. `SystemLog` audit `event = "TAMBUR_MANUAL_ROLL"` → SEBEP + operatör +
//      makine + istasyon + iş emri/adım burada durur. Arşivlense de silinmez
//      (`system_log_archives`'a TAŞINIR).
//   3. Giriş `RollMovement.notes = "TAMBUR_MANUAL_ROLL: <sebep>"` → operasyonel iz;
//      topun hareket geçmişinde OKUNUR. **Kalıcı DEĞİL** (dürüst olalım): Tambur
//      finalize açık movement'ı kapatırken `notes`u kendi damgasıyla EZER. Bu
//      yüzden asıl çapa (1) + (2)'dir, marker onların yerine geçmez.
// Şemaya yeni kolon EKLENMEDİ: aynı sınıf "süpervizör override + sebep" verisi
// (WO kapanış dispozisyonu — `WO_CLOSE_<ACTION>` + `WO_CLOSE_DISPOSITION`) zaten
// bu desenle taşınıyor; canlı fabrikada tek bir sebep alanı için tablo yeniden
// yazımı (ALTER = ACCESS EXCLUSIVE) haklı çıkmıyor. Sebep alanını topun ÜSTÜNDE
// gerektiren bir ihtiyaç doğarsa (örn. sevk irsaliyesinde gösterim) `Roll.notes`
// kolonu ayrı bir kararla, elle yazılan migration'la eklenir.
//
// -----------------------------------------------------------------------------
// SAHA GUARD'LARI — panel taşımasından DAHA DAR (bilinçli)
// -----------------------------------------------------------------------------
// Ölü statüler `K18_DEAD_STATUSES` (tek kaynak), taşınabilirlik `MOVABLE_STATUSES`
// (tek kaynak — ikisi de import edilir, elle liste YAZILMAZ). Ek olarak:
//   • Çuvaldaki/sevkiyata atanmış top REDDEDİLİR (paketlenmiş malı geri çekmek
//     sevk belgesini yalanlar — o iş sevkiyat ekranının).
//   • CANCELLED/SUPERSEDED iş emri REDDEDİLİR (`manualMoveWoBlockReason` — aynı
//     gerekçe: kart VOIDED olduğu için top "canlı ama okutulamaz" çıkmaza düşer).
//   • BAŞKA İŞ EMRİNDE üretimdeki/partili top REDDEDİLİR. Panel taşıması
//     partisiz topu WO'lar arası çekebilir; saha operatörüne bu YETKİ VERİLMEZ:
//     malı bir iş emrinden diğerine almak üretim muhasebesini (ÇIKAN/parti izi)
//     kaydırır ve kaynak WO'nun ekranında iz bırakmaz. Doğru yol panelden
//     süpervizör taşıması. Hata `code: ROLL_OTHER_WORKORDER` + hangi İE olduğu.
//   • SEBEP ZORUNLU (min 3 karakter) — her iki uçta da.
// =============================================================================

import prisma from "../lib/prisma";
import {
  Prisma,
  RollStatus,
  StationKind,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { K18_DEAD_STATUSES } from "./batch.service";
import { InventoryService } from "./inventory.service";
import {
  MOVABLE_STATUSES,
  WorkOrderManualMoveService,
  manualMoveWoBlockReason,
} from "./workorder-manual-move.service";
import { ensureWorkOrderInProgress, recomputeStepStatus } from "./helpers/roll-step.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";

/**
 * Elle eklenen topun giriş hareketine yazılan marker ÖN EKİ (tam değer
 * `TAMBUR_MANUAL_ROLL: <sebep>`). `KURSUN_BYPASS_FINISHED` emsali; TEK KAYNAK
 * burada durur (audit `event` alanı da aynı sabiti kullanır → iki iz aynı
 * anahtarla aranır).
 */
export const TAMBUR_MANUAL_ROLL_MARKER = "TAMBUR_MANUAL_ROLL";

/** "Buraya al" audit olayı — MANUAL_MOVE'un saha varyantını ayırt eder. */
export const TAMBUR_MANUAL_BRING_EVENT = "TAMBUR_MANUAL_BRING";

/** Operatörün istekte topu gösterme biçimi — barkod (okutma) ya da ID (listeden seçim). */
export interface RollRef {
  rollId?: string;
  barcode?: string;
}

/** Saha bağlamı — controller `getStampContext` ile çözer, servis yalnız doğrular. */
export interface TamburFieldContext {
  userId?: string;
  /** Aktif çalışma oturumunun makinesi (üretim atfı). */
  machineId?: string | null;
  /** Aktif çalışma oturumunun istasyonu; null = oturumsuz (Electron/DESKTOP). */
  stationId?: string | null;
}

/**
 * `WorkOrderManualMoveService.getManualMovePreview` cevabının BU dosyanın okuduğu
 * alt kümesi. Servis `ApiResponse<unknown>` döndüğü için daraltma burada yapılır
 * (`any` yok); alan adları değişirse derleme değil, testler düşer — bu yüzden
 * `scripts/test_tambur_manual_field.ts` önizleme alanlarını de doğrular.
 */
interface ManualMovePreviewShape {
  targetStep: { id: string; stepSequence: number; name: string | null; type: string | null };
  isWholeParty: boolean;
  rolls: Array<{
    id: string;
    barcode: string | null;
    batchNumber: string | null;
    currentStepId: string | null;
    currentStepName: string | null;
    currentQty: number;
    movable: boolean;
    blockReason: string | null;
    qcWillVoid: boolean;
  }>;
  backflush: {
    direction: "forward" | "backward";
    skippedStepNames: string[];
    appliesColor: boolean;
    colorBlocked: boolean;
    qualityStaysUnknown: boolean;
  };
  warnings: string[];
  woBlocked: boolean;
  woBlockReason: string | null;
}

/** Saha ekranının topu tanıması için minimum özet (liste yüzeyi — tek metraj). */
interface FieldRollSummary {
  id: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  status: RollStatus;
  batchNumber: string | null;
  /** Topun ŞU ANKİ konumu — istasyon adı, yoksa depo/stok etiketi. */
  currentLocation: string;
  /** Topun bağlı olduğu iş emri (varsa) — "başka İE" uyarısının kaynağı. */
  workOrderNumber: string | null;
}

/** Engel bilgisi — mesaj + makine-okunur kod (mobil kodu okur). */
interface BringBlock {
  code: string;
  reason: string;
}

/** Topu çözerken çekilen alanlar (guard'ların ihtiyacı kadar — over-fetch yok). */
const ROLL_SELECT = {
  id: true,
  barcode: true,
  status: true,
  currentQty: true,
  weightKg: true,
  currentStepId: true,
  sackId: true,
  shipmentId: true,
  batchId: true,
  item: { select: { code: true, name: true } },
  color: { select: { name: true } },
  batch: {
    select: {
      batchNumber: true,
      workOrderId: true,
      workOrder: { select: { workOrderNumber: true } },
    },
  },
  currentStep: {
    select: {
      workOrderId: true,
      station: { select: { name: true } },
      workOrder: { select: { workOrderNumber: true } },
    },
  },
} as const;

type ResolvedRoll = Prisma.RollGetPayload<{ select: typeof ROLL_SELECT }>;

export class TamburManualService {
  private moveService = new WorkOrderManualMoveService();
  private inventoryService = new InventoryService();

  // ===========================================================================
  // ORTAK ÇÖZÜMLEME
  // ===========================================================================

  /**
   * Hedef Tambur adımını çöz + saha guard'ları. `sessionStationId` doluysa
   * (mobil oturum) adımın istasyonuyla EŞLEŞMELİ: aksi halde operatör başka bir
   * yerde onay vermişken uzaktaki Tambur'un kuyruğuna müdahale ederdi.
   * Oturumsuz (Electron/DESKTOP) çağrıda istasyon kontrolü ATLANIR — F221 deseni:
   * bağlam verilmediyse enforcement yok.
   */
  private async resolveTamburStep(targetStepId: string, sessionStationId?: string | null) {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: targetStepId },
      select: {
        id: true,
        stationId: true,
        workOrderId: true,
        station: { select: { kind: true, name: true } },
        workOrder: {
          select: {
            id: true,
            status: true,
            workOrderNumber: true,
            targetItemId: true,
            targetColorId: true,
          },
        },
      },
    });
    if (!step) {
      throw AppError.notFound("Tambur adımı bulunamadı", { code: "STEP_NOT_FOUND" });
    }
    if (step.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Bu adım Tambur tipinde değil (${step.station.kind}) — saha düzeltmesi yalnız Tambur'da yapılır`,
        { code: "STEP_NOT_TAMBUR", stationKind: step.station.kind },
      );
    }
    if (sessionStationId && sessionStationId !== step.stationId) {
      throw AppError.conflict(
        `Bu cihazın çalışma oturumu başka bir istasyonda — "${step.station.name}" adımına buradan müdahale edilemez. Yer onayını Tambur istasyonu için verin.`,
        { code: "STATION_MISMATCH", sessionStationId, stepStationId: step.stationId },
      );
    }
    const woBlock = manualMoveWoBlockReason(step.workOrder.status);
    if (woBlock) {
      throw AppError.conflict(woBlock, {
        code: "WORKORDER_DEAD",
        workOrderStatus: step.workOrder.status,
        workOrderNumber: step.workOrder.workOrderNumber,
      });
    }
    return step;
  }

  /** Barkod (okutma) ya da ID ile topu çöz. Barkod TAM eşleşme (unique index seek). */
  private async resolveRoll(ref: RollRef): Promise<ResolvedRoll> {
    const barcode = ref.barcode?.trim();
    const where: Prisma.RollWhereInput | null = ref.rollId
      ? { id: ref.rollId }
      : barcode
        ? { barcode }
        : null;
    if (!where) {
      throw AppError.badRequest("Top barkodu ya da ID'si gerekli", {
        code: "ROLL_REF_REQUIRED",
      });
    }
    const roll = await prisma.roll.findFirst({ where, select: ROLL_SELECT });
    if (!roll) {
      throw AppError.notFound(
        barcode
          ? `Bu barkodla top bulunamadı: ${barcode}. Kod bir çuval/kartela koduysa top alanına okutulamaz.`
          : "Top bulunamadı",
        { code: "ROLL_NOT_FOUND", barcode: barcode ?? null },
      );
    }
    return roll;
  }

  /** Topun okunabilir konumu — istasyon adı, yoksa statüden türetilen etiket. */
  private locationLabel(roll: ResolvedRoll): string {
    if (roll.currentStep?.station?.name) return roll.currentStep.station.name;
    if (roll.status === RollStatus.WAREHOUSE) return "Bitmiş Depo";
    if (roll.status === RollStatus.STOCK) return "Ham Stok";
    if (roll.status === RollStatus.A1_STOCK) return "2. Kalite Stok";
    return "—";
  }

  private toSummary(roll: ResolvedRoll): FieldRollSummary {
    return {
      id: roll.id,
      barcode: roll.barcode,
      itemCode: roll.item.code,
      itemName: roll.item.name,
      colorName: roll.color?.name ?? null,
      currentQty: Number(roll.currentQty),
      status: roll.status,
      batchNumber: roll.batch?.batchNumber ?? null,
      currentLocation: this.locationLabel(roll),
      workOrderNumber:
        roll.currentStep?.workOrder?.workOrderNumber ??
        roll.batch?.workOrder?.workOrderNumber ??
        null,
    };
  }

  /**
   * Saha "buraya al" engelleri (null = engel yok). Panel taşımasının guard'larını
   * TEKRARLAMAZ — onun kümesine (`MOVABLE_STATUSES`, çuval/sevk) bakar ve üstüne
   * yalnız saha kapsamını daraltan iki kuralı (başka İE, zaten burada) ekler.
   */
  private bringBlockReason(
    roll: ResolvedRoll,
    targetWorkOrderId: string,
    targetStepId: string,
  ): BringBlock | null {
    if (K18_DEAD_STATUSES.includes(roll.status)) {
      return {
        code: "ROLL_DEAD",
        reason:
          "Bu top tüketilmiş/iptal edilmiş bir tarihçe kaydı (kesildi, fasonda kapandı ya da iptal edildi) — üretime alınamaz.",
      };
    }
    if (roll.status === RollStatus.SHIPPED) {
      return { code: "ROLL_SHIPPED", reason: "Bu top sevk edilmiş — geri alınamaz." };
    }
    if (roll.sackId) {
      return {
        code: "ROLL_IN_SACK",
        reason: "Bu top bir çuvalın içinde — önce çuvaldan çıkarılmalı (Paketleme ekranı).",
      };
    }
    if (roll.shipmentId) {
      return {
        code: "ROLL_IN_SHIPMENT",
        reason: "Bu top bir sevkiyata atanmış — önce sevkiyattan çıkarılmalı.",
      };
    }
    if (roll.status === RollStatus.AT_SUBCONTRACTOR) {
      return {
        code: "ROLL_AT_SUBCONTRACTOR",
        reason: "Bu top fasonda (dışarıda) — önce Fason Kabul yapılmalı.",
      };
    }
    if (!MOVABLE_STATUSES.includes(roll.status)) {
      return {
        code: "ROLL_STATUS_NOT_MOVABLE",
        reason: `Bu durumdaki top (${roll.status}) Tambur'a alınamaz.`,
      };
    }
    // Saha kapsamı: mal başka bir iş emrinin üretimindeyse ya da başka bir iş
    // emrinin partisine bağlıysa taşıma İŞ EMİRLERİ ARASI olur → süpervizör kararı.
    const otherWoId =
      (roll.currentStep && roll.currentStep.workOrderId !== targetWorkOrderId
        ? roll.currentStep.workOrderId
        : null) ??
      (roll.batch && roll.batch.workOrderId !== targetWorkOrderId ? roll.batch.workOrderId : null);
    if (otherWoId) {
      const woNo =
        roll.currentStep?.workOrder?.workOrderNumber ??
        roll.batch?.workOrder?.workOrderNumber ??
        otherWoId;
      return {
        code: "ROLL_OTHER_WORKORDER",
        reason: `Bu top başka bir iş emrine bağlı (${woNo}). İş emirleri arası taşımayı panelden süpervizör yapar.`,
      };
    }
    if (roll.currentStepId === targetStepId && roll.status === RollStatus.IN_PRODUCTION) {
      return {
        code: "ROLL_ALREADY_HERE",
        reason: "Bu top zaten bu Tambur adımında — listeyi yenileyin.",
      };
    }
    return null;
  }

  // ===========================================================================
  // 1) MEVCUT TOPU BURAYA AL — ÖNİZLEME
  // ===========================================================================

  /**
   * Ne olacağını SOMUT söyler; hiçbir şeyi değiştirmez. Taşımanın gerçek etkileri
   * (hangi adımdan gelecek, kalite kararı VOID olacak mı, hangi adımlar atlanacak,
   * yeni parti doğacak mı, tamamlanmış iş emri yeniden açılacak mı) panel taşıma
   * servisinin ÖNİZLEMESİNDEN okunur — saha ekranı ayrı bir tahmin yürütmez.
   */
  async getBringPreview(
    input: RollRef & { targetStepId: string },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const step = await this.resolveTamburStep(input.targetStepId, ctx.stationId);
    const roll = await this.resolveRoll(input);
    const summary = this.toSummary(roll);
    const target = {
      id: step.id,
      stationName: step.station.name,
      workOrderId: step.workOrderId,
      workOrderNumber: step.workOrder.workOrderNumber,
    };

    const block = this.bringBlockReason(roll, step.workOrderId, step.id);
    if (block) {
      return {
        success: true,
        data: {
          roll: summary,
          targetStep: target,
          canApply: false,
          blockCode: block.code,
          blockReason: block.reason,
          warnings: [],
          effects: null,
        },
      };
    }

    const preview = (
      await this.moveService.getManualMovePreview(step.workOrderId, {
        rollIds: [roll.id],
        targetStepId: step.id,
      })
    ).data as ManualMovePreviewShape;
    const row = preview.rolls.find((r) => r.id === roll.id);
    if (!row) {
      // Taze okuma ile önizleme arasında top terminal statüye kaçtı (sevk/tüketim).
      return {
        success: true,
        data: {
          roll: summary,
          targetStep: target,
          canApply: false,
          blockCode: "ROLL_STATE_CHANGED",
          blockReason: "Top bu sırada başka bir işleme girdi — ekranı yenileyin.",
          warnings: [],
          effects: null,
        },
      };
    }

    const warnings = [...preview.warnings];
    // Parti kararı: saha ekranı seçim sunmaz; `manualMove`in kendi varsayılanı
    // uygulanır (tüm parti taşınıyorsa 'keep', değilse 'new' → yeni P numarası).
    const newParty = !preview.isWholeParty;
    if (newParty) {
      warnings.push("Bu top için yeni bir parti numarası oluşturulacak.");
    }
    if (row.qcWillVoid) {
      warnings.push(
        "Hedef sonrası kalite/kurşun kararı geri alınacak — topun kalitesi Belirsiz olur.",
      );
    }

    const canApply = row.movable && !preview.woBlocked && !preview.backflush.colorBlocked;
    const blockReason = !row.movable
      ? row.blockReason
      : preview.woBlocked
        ? preview.woBlockReason
        : preview.backflush.colorBlocked
          ? "İş emrinin hedef rengi yok — renk veren adım atlanamaz."
          : null;

    return {
      success: true,
      data: {
        roll: summary,
        targetStep: target,
        canApply,
        blockCode: canApply
          ? null
          : !row.movable
            ? "ROLL_NOT_MOVABLE"
            : preview.woBlocked
              ? "WORKORDER_DEAD"
              : "COLOR_BLOCKED",
        blockReason,
        warnings,
        effects: {
          /** forward = ileri atlama (aradaki adımlar SKIPPED), backward = geri çekme. */
          direction: preview.backflush.direction,
          fromStepName: row.currentStepName,
          skippedStepNames: preview.backflush.skippedStepNames,
          qualityWillVoid: row.qcWillVoid,
          qualityStaysUnknown: preview.backflush.qualityStaysUnknown,
          colorWillApply: preview.backflush.appliesColor,
          newParty,
        },
      },
    };
  }

  // ===========================================================================
  // 1b) MEVCUT TOPU BURAYA AL — UYGULA
  // ===========================================================================

  /**
   * Taşımayı UYGULAR — tüm iş `WorkOrderManualMoveService.manualMove`de yapılır.
   * Buradaki ön-kontroller yalnız saha kapsamını daraltır ve mobile makine-okunur
   * `code` verir; yarış kontrolü (atomik claim → 409) taşıma servisindedir.
   */
  async bringRoll(
    input: RollRef & { targetStepId: string; reason: string },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni zorunlu (en az 3 karakter)", {
        code: "REASON_REQUIRED",
      });
    }
    const step = await this.resolveTamburStep(input.targetStepId, ctx.stationId);
    const roll = await this.resolveRoll(input);
    const block = this.bringBlockReason(roll, step.workOrderId, step.id);
    if (block) {
      // ROLL_ALREADY_HERE dışındakiler gerçek engel; "zaten burada" da 409 döner
      // (idempotent değil — operatör listeyi yenilesin, sessiz no-op yanıltıcı olur).
      throw AppError.conflict(block.reason, { code: block.code });
    }

    let moved: ApiResponse<unknown>;
    try {
      moved = await this.moveService.manualMove(
        step.workOrderId,
        { rollIds: [roll.id], targetStepId: step.id, reason },
        ctx.userId,
      );
    } catch (err) {
      // Delege edilen servis kod TAŞIMAZ; mesajı koruyup makine-okunur kod ekle.
      if (err instanceof AppError) {
        throw new AppError(err.message, err.statusCode, err.isOperational, {
          ...(err.details ?? {}),
          code: (err.details?.code as string | undefined) ?? "MOVE_REJECTED",
        });
      }
      throw err;
    }

    // İkinci audit satırı: `manualMove` zaten MANUAL_MOVE yazdı (taşımanın kendisi).
    // Bu satır SAHA yolunu ayırt eder — "bu taşımayı panel değil, Tambur operatörü
    // tabletten yaptı; oturum şu makine/istasyondu" sorusunun cevabı.
    await AuditService.log({
      userId: ctx.userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: TAMBUR_MANUAL_BRING_EVENT,
        reason,
        rollBarcode: roll.barcode,
        fromStatus: roll.status,
        fromStepId: roll.currentStepId,
        fromLocation: this.locationLabel(roll),
        targetStepId: step.id,
        targetStationId: step.stationId,
        workOrderId: step.workOrderId,
        workOrderNumber: step.workOrder.workOrderNumber,
        machineId: ctx.machineId ?? null,
        sessionStationId: ctx.stationId ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        targetStepId: step.id,
        workOrderNumber: step.workOrder.workOrderNumber,
        move: moved.data,
      },
      // Barkodsuz açık kumaş da taşınabilir → barkod yoksa etiketsiz cümle kur.
      message: roll.barcode
        ? `${roll.barcode} barkodlu top "${step.station.name}" adımına alındı.`
        : `Top "${step.station.name}" adımına alındı.`,
    };
  }

  // ===========================================================================
  // 2) MANUEL TOP EKLE
  // ===========================================================================

  /**
   * Sistemde HİÇ olmayan bir topu elle yaratır ve doğrudan bu Tambur adımına bağlar
   * (operatör hemen kesebilsin). İki fazlıdır ve **her iki faz da idempotenttir**:
   *
   *   FAZ 1 — `InventoryService.createInitialEntry` (yeniden kullanım; barkod
   *     SUNUCUDA `generateRollBarcode` ile, `entrySource=MANUAL_ENTRY`, mükerrer
   *     koruması `clientToken @unique` ile). Kendi transaction'ını açtığı için
   *     FAZ 2 ile tek tx'te birleştirilemez.
   *   FAZ 2 — atomik claim + giriş hareketi + adım/WO recompute.
   *
   * FAZ 1 ile FAZ 2 arasında bağlantı koparsa top depoda/stokta kalır (yetim
   * DEĞİL — barkodlu, envanterde, audit'li). İstemci AYNI `clientToken` ile tekrar
   * denediğinde FAZ 1 mevcut topu döner, FAZ 2 onu adıma bağlar → akış YAKINSAR.
   * Bu yüzden `clientToken` bu uçta ZORUNLUDUR (KK1'de opsiyonel): tekrar deneme
   * mükerrer top doğurmasın.
   *
   * VARSAYILAN MİRAS: `itemId`/`colorId` verilmezse iş emrinin hedefinden alınır
   * (`targetItemId`/`targetColorId`) — operatör Tambur'da ürün seçmez, elindeki mal
   * bu iş emrinin malıdır. `colorId: null` AÇIKÇA gönderilirse renksiz kalır
   * (miras uygulanmaz) — "boyasız geldi" durumu susturulmasın.
   */
  async createManualRoll(
    input: {
      targetStepId: string;
      initialQty: number;
      reason: string;
      clientToken: string;
      itemId?: string;
      colorId?: string | null;
      width?: number | null;
      qualityGrade?: string;
      weightKg?: number;
    },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni zorunlu (en az 3 karakter)", {
        code: "REASON_REQUIRED",
      });
    }
    if (!(input.initialQty > 0)) {
      throw AppError.badRequest("Metraj pozitif olmalı", { code: "QTY_REQUIRED" });
    }
    const step = await this.resolveTamburStep(input.targetStepId, ctx.stationId);

    const itemId = input.itemId ?? step.workOrder.targetItemId;
    if (!itemId) {
      throw AppError.badRequest(
        "Ürün seçilmeli — bu iş emrinin hedef ürünü tanımlı değil, elle top eklerken ürün zorunlu.",
        { code: "ITEM_REQUIRED" },
      );
    }
    // `undefined` = operatör renk belirtmedi → iş emrinin hedef rengi miras alınır.
    // `null`     = operatör "renksiz" dedi → miras UYGULANMAZ.
    const colorId =
      input.colorId === undefined ? (step.workOrder.targetColorId ?? null) : input.colorId;
    const colorSource: "OPERATOR" | "WORKORDER" | "NONE" =
      input.colorId !== undefined ? "OPERATOR" : colorId ? "WORKORDER" : "NONE";

    // FAZ 1 — topun kendisi. `isMobileOrigin=false` BİLİNÇLİ: istek Tambur
    // tabletinden (eşleşmiş cihaz) gelse de bu bir KK1 istasyon taraması DEĞİL,
    // elle girilen bir kayıttır → `entrySource` MANUAL_ENTRY kalmalı (zincir dışı
    // doğumun makine-okunur işareti). `Boolean(req.device)` mantığı burada geçersiz.
    const created = await this.inventoryService.createInitialEntry(
      {
        itemId,
        colorId,
        initialQty: input.initialQty,
        weightKg: input.weightKg,
        qualityGrade: input.qualityGrade,
        width: input.width ?? null,
        clientToken: input.clientToken,
      },
      ctx.userId,
      ctx.machineId ?? null,
      false,
    );
    const roll = created.data;

    // FAZ 2 — Tambur adımına bağla.
    const attach = await prisma.$transaction(async (tx) => {
      const fresh = await tx.roll.findUnique({
        where: { id: roll.id },
        select: {
          status: true,
          currentStepId: true,
          currentQty: true,
          weightKg: true,
          sackId: true,
          shipmentId: true,
        },
      });
      if (!fresh) throw AppError.notFound("Top bulunamadı", { code: "ROLL_NOT_FOUND" });

      // İdempotent tekrar: top zaten bu adımda üretimde → hareketi garanti et, çık.
      if (fresh.status === RollStatus.IN_PRODUCTION && fresh.currentStepId === step.id) {
        const open = await tx.rollMovement.findFirst({
          where: { rollId: roll.id, workOrderStepId: step.id, exitedAt: null },
          select: { id: true },
        });
        if (!open) {
          await tx.rollMovement.create({
            data: {
              rollId: roll.id,
              workOrderStepId: step.id,
              qtyIn: fresh.currentQty,
              weightIn: fresh.weightKg,
              operatorId: ctx.userId ?? null,
              machineId: ctx.machineId ?? null,
              notes: `${TAMBUR_MANUAL_ROLL_MARKER}: ${reason}`.slice(0, 500),
            },
          });
        }
        return { alreadyAttached: true, reopened: false };
      }

      // Atomik claim — createInitialEntry topu renkliyse WAREHOUSE, renksizse
      // STOCK yaratır; ikisi de serbest olmalı (çuval/sevk yok, adımsız).
      const claim = await tx.roll.updateMany({
        where: {
          id: roll.id,
          status: { in: [RollStatus.STOCK, RollStatus.WAREHOUSE] },
          sackId: null,
          shipmentId: null,
          currentStepId: null,
        },
        data: { currentStepId: step.id, status: RollStatus.IN_PRODUCTION },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işleme girdi — ekranı yenileyip tekrar deneyin.",
          { code: "ROLL_STATE_CHANGED", rollId: roll.id, status: fresh.status },
        );
      }

      await tx.rollMovement.create({
        data: {
          rollId: roll.id,
          workOrderStepId: step.id,
          qtyIn: fresh.currentQty,
          weightIn: fresh.weightKg,
          operatorId: ctx.userId ?? null,
          machineId: ctx.machineId ?? null,
          // Marker + sebep: topun hareket geçmişinde okunur (operasyonel iz).
          // Kalıcı çapa değil — finalize bu notu EZER (dosya başlığı).
          notes: `${TAMBUR_MANUAL_ROLL_MARKER}: ${reason}`.slice(0, 500),
        },
      });

      // Adım/WO durumu: yeni açık hareket adımı ACTIVE'e çeker; PLANNED WO üretime
      // girer; COMPLETED WO (mal geri geldi) yeniden açılır + refakat kartı canlanır
      // — `manualMove` ile birebir aynı diriltme sözleşmesi.
      await touchWorkOrderTx(tx, step.workOrderId);
      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, step.workOrderId);
      const reopen = await tx.workOrder.updateMany({
        where: { id: step.workOrderId, status: WorkOrderStatus.COMPLETED },
        data: { status: WorkOrderStatus.IN_PROGRESS },
      });
      if (reopen.count > 0) {
        await setWorkOrderCardStatuses(
          tx,
          step.workOrderId,
          TravelerCardStatus.COMPLETED,
          TravelerCardStatus.ACTIVE,
        );
      }
      return { alreadyAttached: false, reopened: reopen.count > 0 };
    });

    // Zincir-dışı doğumun KALICI sebep izi (dosya başlığı, madde 2).
    await AuditService.log({
      userId: ctx.userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: TAMBUR_MANUAL_ROLL_MARKER,
        reason,
        barcode: roll.barcode,
        itemId,
        colorId,
        colorSource,
        initialQty: Number(roll.initialQty),
        weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
        width: roll.width !== null ? Number(roll.width) : null,
        qualityGrade: roll.qualityGrade,
        entrySource: roll.entrySource,
        clientToken: input.clientToken,
        targetStepId: step.id,
        targetStationId: step.stationId,
        workOrderId: step.workOrderId,
        workOrderNumber: step.workOrder.workOrderNumber,
        machineId: ctx.machineId ?? null,
        sessionStationId: ctx.stationId ?? null,
        alreadyAttached: attach.alreadyAttached,
        reopenedWorkOrder: attach.reopened,
      },
    });

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        itemId,
        colorId,
        colorSource,
        currentQty: Number(roll.currentQty),
        targetStepId: step.id,
        workOrderNumber: step.workOrder.workOrderNumber,
        alreadyAttached: attach.alreadyAttached,
        reopenedWorkOrder: attach.reopened,
      },
      message: `Top elle eklendi ve "${step.station.name}" adımına alındı. Barkod: ${roll.barcode}`,
    };
  }
}
