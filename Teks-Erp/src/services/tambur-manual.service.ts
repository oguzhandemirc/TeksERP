// =============================================================================
// TeksERP — TAMBUR SAHA DÜZELTMESİ (operatör self-servis)
// =============================================================================
// Tambur operatörü sahada tıkandığında panel başındaki birini beklemesin diye üç
// yetenek: (1) MEVCUT TOPU BURAYA AL — sistemde olan bir topu bu Tambur adımına
// getir; (2) MANUEL TOP EKLE — sistemde HİÇ olmayan bir topu elle yarat ve doğrudan
// Tambur adımına bağla; (3) KARTSIZ BİTMİŞ ÜRÜN ("Manuel Mod") — refakat kartı
// olmadan bitmiş top üret, doğrudan Bitmiş Depo'ya yaz.
// İzin: `mobile:tambur-duzelt` (ya da `roll:manual-adjust`).
//
// (1) ve (2) KART VARSAYAR (`targetStepId` zorunlu, çıktı iş emri adımına bağlanır).
// (3) kartın YOKLUĞUNU varsayar: hiçbir WO/adım/parti/harekete dokunmaz. Sınır bu —
// üçünü tek uçta birleştirmek, kapsamı "hangi alan dolu" gibi örtük bir şeye
// bağlardı (bkz. produceFinishedRoll doc'u).
//
// -----------------------------------------------------------------------------
// NEDEN AYRI SERVİS — ve neden burada TAŞIMA MANTIĞI YOK
// -----------------------------------------------------------------------------
// "Buraya al" tek satır bile taşıma kodu yazmaz: `WorkOrderManualMoveService`e
// delege eder (movement kapatma/açma, hedef-sonrası hayalet movement'ın geri alınması,
// kalite VOID'i, parti kararı, adım recompute; tamamlanmış iş emrine 409). Paralel bir taşıma yolu yazmak, iki yolun zamanla ayrışması demekti;
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
import { normalizeScanCode } from "../utils/code-format";
import {
  Prisma,
  ReasonPresetKind,
  RollEntrySource,
  RollStatus,
  StationKind,
  WorkOrderStatus,
} from "@prisma/client";
import { AppError } from "../utils/app-error";
import { assertRollReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
import { resolveReasonCode } from "./reason-preset.service";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { K18_DEAD_STATUSES, createBatchTx } from "./batch.service";
import { readBatchAutoCreateEnabled } from "./system-setting.service";
import { InventoryService } from "./inventory.service";
import { resolveEntryStationId } from "./helpers/roll-entry-station.helper";
import {
  MOVABLE_STATUSES,
  WorkOrderManualMoveService,
  manualMoveWoBlockReason,
} from "./workorder-manual-move.service";
import { ensureWorkOrderInProgress, recomputeStepStatus } from "./helpers/roll-step.helper";
import { completedNoAddError } from "./workorder-batch-add.service";
import { ACTIVE_MOVEMENT } from "./helpers/roll-movement.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { postProductionIssuesTx } from "./helpers/production-issue-ledger.helper";
import { resolveLabelIntent } from "./helpers/label-intent.helper";
import { resolveFoldTypeForWrite } from "./helpers/fold-type";
import { STEP_CAPABILITY_SELECT, stepCanApplyColor } from "./helpers/step-capability.helper";
import { lengthWarning } from "./helpers/measurement-threshold.helper";
import { buildIntentSnapshot } from "./label.service";

/**
 * Elle eklenen topun giriş hareketine yazılan marker ÖN EKİ (tam değer
 * `TAMBUR_MANUAL_ROLL: <sebep>`). `KURSUN_BYPASS_FINISHED` emsali; TEK KAYNAK
 * burada durur (audit `event` alanı da aynı sabiti kullanır → iki iz aynı
 * anahtarla aranır).
 */
export const TAMBUR_MANUAL_ROLL_MARKER = "TAMBUR_MANUAL_ROLL";

/** "Buraya al" audit olayı — MANUAL_MOVE'un saha varyantını ayırt eder. */
export const TAMBUR_MANUAL_BRING_EVENT = "TAMBUR_MANUAL_BRING";

/**
 * KARTSIZ BİTMİŞ ÜRÜN audit olayı — `TAMBUR_MANUAL_ROLL`dan AYRI tutulur.
 * İkisi farklı sorulara cevap verir ve karıştırılırsa denetim yanılır:
 *   • `TAMBUR_MANUAL_ROLL`    → "kart VAR, top ekranda yoktu" (iş emri adımına bağlandı, IN_PRODUCTION)
 *   • `TAMBUR_MANUAL_PRODUCE` → "kart YOK" (hiçbir iş emrine bağlanmadı, doğrudan Bitmiş Depo)
 */
export const TAMBUR_MANUAL_PRODUCE_EVENT = "TAMBUR_MANUAL_PRODUCE";

/**
 * "Boyahaneye Geri Gönder" audit olayı (2026-08-19) — `TAMBUR_MANUAL_BRING`den
 * ayrı: ikisi de taşımadır ama farklı soruların cevabıdır.
 *   • BRING        → "top buraya GELSİN" (operatör malı kendi kuyruğuna alır)
 *   • SEND_TO_DYE  → "bu mal yanlış renkte, GERİ gitsin" (plan-sapma kararının
 *                     rework kolu; hedefi operatör değil SUNUCU çözer)
 */
export const TAMBUR_SEND_TO_DYE_EVENT = "TAMBUR_SEND_TO_DYE";

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
      id: true,
      // stationId + kind: "Boyahaneye Geri Gönder" kaynak adımın Tambur olduğunu
      // ve oturumun O istasyonda açıldığını doğrular (bring'de hedef adımdan
      // okunuyordu; geri gönderimde hedefi SUNUCU çözdüğü için kaynak taraf).
      stationId: true,
      workOrderId: true,
      station: { select: { name: true, kind: true } },
      workOrder: { select: { workOrderNumber: true, status: true } },
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
            // EN: elle eklenen top bunu miras alir (operatore sorulmaz).
            width: true,
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
    // Topu Buraya Al / Manuel Top Ekle tamamlanmış iş emrini artık yeniden AÇMAZ (D8, 4b kararı A).
    if (step.workOrder.status === WorkOrderStatus.COMPLETED) throw completedNoAddError();
    return step;
  }

  /** Barkod (okutma) ya da ID ile topu çöz. Barkod TAM eşleşme (unique index seek). */
  private async resolveRoll(ref: RollRef): Promise<ResolvedRoll> {
    const barcode = ref.barcode ? normalizeScanCode(ref.barcode) : undefined;
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
   * yeni parti doğacak mı) panel taşıma
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
  // 1c) BOYAHANEYE GERİ GÖNDER (2026-08-19) — plan-sapma kararının REWORK kolu
  // ===========================================================================
  //
  // Saha senaryosu: tamburdaki top MAVİ, iş emri GRİ istiyor. Plan kapısı sorar;
  // operatörün önünde bugüne kadar iki cevap vardı ("yine de bitir" / "vazgeç").
  // Gerçek karar çoğu zaman üçüncüsüdür: mal geri gitsin, yeniden boyansın.
  //
  // ⚠️ HEDEFİ İSTEMCİ SEÇMEZ, SUNUCU ÇÖZER. Tablette rota bilgisi yok
  // (`GET /work-orders/:id` izni `mobile:tambur`u kapsamıyor) ve olsaydı bile
  // "hangi adım boya veriyor" sorusunu istemciye çözdürmek yüklemin ikinci bir
  // kopyasını doğururdu (F221 dersi). Bu yüzden `bring`den farklı olarak
  // `targetStepId` PARAMETRE DEĞİL.

  /**
   * Topun bulunduğu Tambur adımından GERİYE, en yakın "renk veren" adımı çözer.
   *
   * ⚠️ Yüklem KANONİK olanıdır (`stepCanApplyColor` — istasyon bayrağı VEYA adımda
   * seçilmiş fason hizmeti). `WorkOrderManualMoveService`in kendi `colorStep`
   * çözümü YALNIZ `requiredCategory.appliesColor` okur, yani İÇ boyahane adımını
   * GÖRMEZ; buradan o kullanılsaydı iç boyahaneli rotalarda tuş "rotada boya adımı
   * yok" derdi. Bekçi: `test_tambur_send_to_dye.ts` (iç boyahane senaryosu).
   *
   * ÇOKLU BOYA ADIMI: mevcut adımdan ÖNCEKİLERİN en yakını (max `stepSequence`).
   * Gerekçe: niyet "bu malın boyası yanlış, yeniden boyansın" — en yakın boya
   * adımına dönmek yalnız onu ve arasını yeniden açar; daha erkene dönmek aradaki
   * adımları (yıkama/ram) gereksiz diriltir ve kalite VOID kapsamını büyütür.
   * Tambur'dan SONRAKİ boya adımı hedef DEĞİLDİR (ileri atlama "geri gönderme"
   * değil; o iş panel taşımasının).
   */
  private async resolveDyeStepForRoll(ref: RollRef, ctx: TamburFieldContext) {
    const roll = await this.resolveRoll(ref);
    const current = roll.currentStep;
    if (
      roll.status !== RollStatus.IN_PRODUCTION ||
      !current ||
      current.station.kind !== StationKind.TAMBUR
    ) {
      throw AppError.badRequest(
        `Bu top Tambur'da üretimde değil (${this.locationLabel(roll)}) — geri gönderme yalnız Tambur'daki toplar için yapılır.`,
        { code: "ROLL_NOT_AT_TAMBUR", status: roll.status },
      );
    }
    // Oturum istasyonu KAYNAK adımla eşleşmeli (bring'de hedefle eşleşiyordu —
    // burada hedefi sunucu çözdüğü için tek doğrulanabilir taraf kaynaktır).
    if (ctx.stationId && ctx.stationId !== current.stationId) {
      throw AppError.conflict(
        `Bu cihazın çalışma oturumu başka bir istasyonda — "${current.station.name}" adımındaki topa buradan müdahale edilemez.`,
        { code: "STATION_MISMATCH", sessionStationId: ctx.stationId, stepStationId: current.stationId },
      );
    }
    const woBlock = manualMoveWoBlockReason(current.workOrder.status);
    if (woBlock) {
      throw AppError.conflict(woBlock, {
        code: "WORKORDER_DEAD",
        workOrderStatus: current.workOrder.status,
        workOrderNumber: current.workOrder.workOrderNumber,
      });
    }

    const steps = await prisma.workOrderStep.findMany({
      where: { workOrderId: current.workOrderId },
      orderBy: { stepSequence: "asc" },
      select: {
        id: true,
        stepSequence: true,
        requiredCategoryId: true,
        station: { select: { name: true, ...STEP_CAPABILITY_SELECT } },
        requiredCategory: { select: { ...STEP_CAPABILITY_SELECT } },
      },
    });
    const currentSeq = steps.find((st) => st.id === current.id)?.stepSequence ?? null;
    if (currentSeq === null) {
      throw AppError.badRequest("Topun adımı bu iş emrinin rotasında bulunamadı — ekranı yenileyin", {
        code: "STEP_NOT_IN_ROUTE",
      });
    }
    const dyeStep = steps
      .filter((st) => st.stepSequence < currentSeq && stepCanApplyColor(st.station, st.requiredCategory))
      .sort((a, b) => b.stepSequence - a.stepSequence)[0];
    if (!dyeStep) {
      throw AppError.badRequest(
        "Bu iş emrinin rotasında topun bulunduğu adımdan ÖNCE renk veren bir adım yok — geri gönderme yapılamaz. Panelden süpervizör taşıması gerekir.",
        { code: "NO_DYE_STEP_IN_ROUTE" },
      );
    }
    return {
      roll,
      workOrderId: current.workOrderId,
      workOrderNumber: current.workOrder.workOrderNumber,
      fromStepName: current.station.name,
      dyeStep: {
        id: dyeStep.id,
        stationName: dyeStep.station.name,
        /** Fason mu — `WorkOrderStep`te tip alanı YOK, fasonluk kategoriden okunur.
         *  Toast ayrımı buna bağlı: fasonda mal ayrıca SEVK edilmeli. */
        isExternal: dyeStep.requiredCategoryId != null,
      },
    };
  }

  /** Geri gönderme ÖNİZLEMESİ — hiçbir şeyi değiştirmez (önizlemesiz uygulama yok). */
  async getSendToDyePreview(
    input: RollRef,
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const { roll, workOrderId, workOrderNumber, fromStepName, dyeStep } =
      await this.resolveDyeStepForRoll(input, ctx);
    const summary = this.toSummary(roll);
    const target = { id: dyeStep.id, stationName: dyeStep.stationName, isExternal: dyeStep.isExternal, workOrderId, workOrderNumber };

    // Saha engelleri `bring` ile ORTAK (çuval/sevk/fason/ölü statü/başka İE) —
    // ikinci bir kural kümesi kurulmaz.
    const block = this.bringBlockReason(roll, workOrderId, dyeStep.id);
    if (block) {
      return {
        success: true,
        data: { roll: summary, targetStep: target, fromStepName, canApply: false, blockCode: block.code, blockReason: block.reason, warnings: [], effects: null },
      };
    }

    const preview = (
      await this.moveService.getManualMovePreview(workOrderId, {
        rollIds: [roll.id],
        targetStepId: dyeStep.id,
      })
    ).data as ManualMovePreviewShape;
    const row = preview.rolls.find((r) => r.id === roll.id);
    if (!row) {
      return {
        success: true,
        data: { roll: summary, targetStep: target, fromStepName, canApply: false, blockCode: "ROLL_STATE_CHANGED", blockReason: "Top bu sırada başka bir işleme girdi — ekranı yenileyin.", warnings: [], effects: null },
      };
    }

    const warnings = [...preview.warnings];
    const newParty = !preview.isWholeParty;
    if (newParty) warnings.push("Bu top için yeni bir parti numarası oluşturulacak.");
    if (row.qcWillVoid) {
      warnings.push("Kalite/kurşun kararı geri alınacak — topun kalitesi Belirsiz olur.");
    }
    if (dyeStep.isExternal) {
      warnings.push(`Mal ${dyeStep.stationName} adımında ÜRETİMDE bekler — boyahaneye çıkışı ayrıca Fason Sevk ile yapılır.`);
    }

    // CUT hard-stop (hedef sonrası doğmuş çocuk top) buradan `movable=false`
    // olarak gelir — saha ekranı ayrı bir tahmin yürütmez.
    const canApply = row.movable && !preview.woBlocked;
    return {
      success: true,
      data: {
        roll: summary,
        targetStep: target,
        fromStepName,
        canApply,
        blockCode: canApply ? null : !row.movable ? "ROLL_NOT_MOVABLE" : "WORKORDER_DEAD",
        blockReason: canApply ? null : !row.movable ? row.blockReason : preview.woBlockReason,
        warnings,
        effects: {
          direction: preview.backflush.direction,
          fromStepName: row.currentStepName,
          reopenedStepNames: preview.backflush.skippedStepNames,
          qualityWillVoid: row.qcWillVoid,
          newParty,
        },
      },
    };
  }

  /** Geri gönderimi UYGULAR — taşımanın tamamı `manualMove`de (QC VOID, adım/WO recompute). */
  async sendToDye(
    input: RollRef & { reason: string },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni zorunlu (en az 3 karakter)", { code: "REASON_REQUIRED" });
    }
    const { roll, workOrderId, workOrderNumber, dyeStep } = await this.resolveDyeStepForRoll(input, ctx);
    const block = this.bringBlockReason(roll, workOrderId, dyeStep.id);
    if (block) throw AppError.conflict(block.reason, { code: block.code });

    let moved: ApiResponse<unknown>;
    try {
      moved = await this.moveService.manualMove(
        workOrderId,
        { rollIds: [roll.id], targetStepId: dyeStep.id, reason },
        ctx.userId,
      );
    } catch (err) {
      if (err instanceof AppError) {
        throw new AppError(err.message, err.statusCode, err.isOperational, {
          ...(err.details ?? {}),
          code: (err.details?.code as string | undefined) ?? "MOVE_REJECTED",
        });
      }
      throw err;
    }

    await AuditService.log({
      userId: ctx.userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: TAMBUR_SEND_TO_DYE_EVENT,
        reason,
        rollBarcode: roll.barcode,
        fromStepId: roll.currentStepId,
        fromLocation: this.locationLabel(roll),
        targetStepId: dyeStep.id,
        targetStationName: dyeStep.stationName,
        targetIsExternal: dyeStep.isExternal,
        workOrderId,
        workOrderNumber,
        machineId: ctx.machineId ?? null,
        sessionStationId: ctx.stationId ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        targetStep: { id: dyeStep.id, stationName: dyeStep.stationName, isExternal: dyeStep.isExternal },
        workOrderNumber,
        move: moved.data,
      },
      // ⚠️ Mesaj hedef istasyon adını MUTLAKA taşır: top Tambur listesinden düşer,
      // operatör nereye gittiğini görmezse "top kayboldu" der.
      message: dyeStep.isExternal
        ? `Top "${dyeStep.stationName}" adımına alındı — boyahaneye çıkışı Fason Sevk ekranından yapın.`
        : `Top "${dyeStep.stationName}" kuyruğuna alındı.`,
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
   *     SUNUCUDA `generateRollBarcodeTx` ile, `entrySource=MANUAL_ENTRY`, mükerrer
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
      /**
       * Sebebin KATALOG KODU (ReasonPreset ROLL_MANUAL_ENTRY) — OPSİYONEL. Verilirse
       * katalogda doğrulanır; verilmezse sunucu `reason` metninden türetir
       * (`resolveReasonCode`). Satıra `Roll.entryReasonCode` olarak yazılır.
       */
      reasonCode?: string | null;
      clientToken: string;
      itemId?: string;
      colorId?: string | null;
      width?: number | null;
      qualityGrade?: string;
      weightKg?: number;
      /**
       * Topun bağlanacağı PARTİ (2026-08-04 saha bulgusu).
       *
       * Parti izlenebilirliğin birimidir ("üretime aynı anda giren top grubu");
       * partisiz top, "bu top hangi partiden geldi / şu partide sorun çıktı,
       * hangi toplar etkilendi" sorularını cevapsız bırakır ve ekranlarda
       * PARTİSİZ grubuna düşüp iş emri detayında görünmez.
       *
       * Verilmezse: o adımda TEK açık parti varsa ona bağlanır (sessiz doğru
       * cevap), birden fazlaysa 400 + `BATCH_REQUIRED` (operatör seçmeli),
       * hiç yoksa NULL kalır (parti kavramı işlememiş iş emri).
       */
      batchId?: string | null;
      /**
       * KAT (2-KAT / 4-KAT / TÜP…) — topun KALICI özelliği (Roll.foldType).
       * Verilmezse NULL kalır; miras ALINMAZ, operatörün o an seçtiği değerdir.
       */
      foldType?: string | null;
    },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    // (a′) Kapılardan ÖNCE: bu token'ın topu bu adıma ZATEN bağlandıysa cevap token'dan (iş emri arada tamamlansa da).
    // Bağlanmamışsa (kendini onarma) ya da yoksa bugünkü akış: kapılar → createInitialEntry (boğaz R) → bağlama (idempotent).
    const early = await this.manualRollAttachedReplay(input).replayIfAny(input.clientToken);
    if (early) return early;
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni zorunlu (en az 3 karakter)", {
        code: "REASON_REQUIRED",
      });
    }
    // Sebep KODU (2026-08-21) — tx DIŞINDA çözülür: açık kod doğrulanır, yoksa
    // metin kataloğun label/fullText'iyle eşlenir; serbest metin → NULL.
    const { code: reasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_MANUAL_ENTRY, {
      reasonCode: input.reasonCode,
      reasonText: reason,
    });
    if (!(input.initialQty > 0)) {
      throw AppError.badRequest("Metraj pozitif olmalı", { code: "QTY_REQUIRED" });
    }
    // Kat katalog doğrulaması. SIRA: payload'ın KENDİ tutarlılığı bağlam
    // çözümünden (adım/parti) ÖNCE — yoksa geçersiz kat gönderen istemci önce
    // BATCH_REQUIRED alır, partiyi seçer, asıl hatasını iki tur sonra öğrenir.
    const foldType = await resolveFoldTypeForWrite(input.foldType);

    const step = await this.resolveTamburStep(input.targetStepId, ctx.stationId);

    // ─────────────────────────────────────────────────────────────────────────
    // ÜRÜN + RENK İŞ EMRİNDEN GELİR — OPERATÖR DEĞİŞTİREMEZ (2026-08-04 kararı)
    //
    // Bu uç topu ŞU iş emrinin Tambur adımına BAĞLAR. Dolayısıyla eklenen top
    // tanım gereği o iş emrinin malıdır: başka bir ürün ya da başka bir renk
    // seçilebilmesi, o iş emrine ait OLMAYAN bir topu onun çıktısına yazmak
    // demekti — üretim muhasebesini (ÇIKAN metriği, `producedOutputWhere` kümesi)
    // sessizce kaydırırdı. Eskiden hiçbir doğrulama YOKTU: katalogdaki her ürün
    // ve her renk kabul ediliyordu.
    //
    // Mobil form bu alanları artık HİÇ SORMUYOR (operatör zaten iş emrinin malını
    // ekliyor, ekranda göstermeye de gerek yok). Buradaki guard ikinci savunma
    // hattıdır: eski APK'lı tablet ya da doğrudan API çağrısı kuralı delemesin.
    const targetItemId = step.workOrder.targetItemId;
    if (input.itemId && targetItemId && input.itemId !== targetItemId) {
      throw AppError.badRequest(
        "Bu iş emrine farklı ürünle top eklenemez — eklenen top iş emrinin hedef ürünü olmalıdır. " +
          "Gerçekten başka bir ürün eklenecekse o topu ayrı bir iş emrine bağlayın.",
        { code: "ITEM_MISMATCH", expectedItemId: targetItemId, receivedItemId: input.itemId },
      );
    }
    const itemId = targetItemId ?? input.itemId;
    if (!itemId) {
      throw AppError.badRequest(
        "Ürün seçilmeli — bu iş emrinin hedef ürünü tanımlı değil, elle top eklerken ürün zorunlu.",
        { code: "ITEM_REQUIRED" },
      );
    }

    // Renk: hedef renk TANIMLIYSA kilitlidir — "renksiz" (explicit null) dahil
    // hiçbir sapmaya izin verilmez (ürün kararı: iş emri kırmızı hedefliyorsa o
    // adımda doğan top kırmızıdır). Hedef renk YOKSA operatörün verdiği değer
    // (renk ya da renksiz) aynen geçer.
    const targetColorId = step.workOrder.targetColorId ?? null;
    if (targetColorId && input.colorId !== undefined && input.colorId !== targetColorId) {
      throw AppError.badRequest(
        "Bu iş emrine farklı renkte (ya da renksiz) top eklenemez — renk iş emrinin hedef renginden gelir.",
        { code: "COLOR_MISMATCH", expectedColorId: targetColorId, receivedColorId: input.colorId },
      );
    }
    const colorId = targetColorId ?? (input.colorId === undefined ? null : input.colorId);
    const colorSource: "OPERATOR" | "WORKORDER" | "NONE" = targetColorId
      ? "WORKORDER"
      : colorId
        ? "OPERATOR"
        : "NONE";

    // ── PARTİ ÇÖZÜMÜ — ÜRÜN/RENK DOĞRULAMASINDAN SONRA ──────────────────────
    // Sıra önemli: parti kontrolü öne alınırsa yanlış ürün gönderen istemci
    // ITEM_MISMATCH yerine BATCH_REQUIRED alır ve asıl hatasını göremez.
    // Genel kural: payload'ın KENDİ tutarlılığı önce, bağlam çözümü sonra.
    // ── PARTİ ÇÖZÜMÜ ────────────────────────────────────────────────────────
    // Adımdaki AÇIK partiler: bu iş emrine ait ve hâlâ canlı topu olanlar.
    // "Açık" tanımı listeye değil VERİYE dayanır — kapalı/tüketilmiş partiye
    // yeni top eklemek partinin metraj muhasebesini geriye dönük bozar.
    const openBatches = await prisma.batch.findMany({
      where: {
        workOrderId: step.workOrderId,
        rolls: { some: { status: { notIn: K18_DEAD_STATUSES } } },
      },
      select: { id: true, batchNumber: true },
      orderBy: { createdAt: "asc" },
    });
    let resolvedBatchId: string | null = null;
    let resolvedBatchNumber: string | null = null;
    if (input.batchId) {
      // Operatörün seçtiği parti GERÇEKTEN bu iş emrinin mi? Aksi halde top
      // başka bir iş emrinin partisine yazılır ve iki iş emrinin muhasebesi karışır.
      const chosen = openBatches.find((b) => b.id === input.batchId);
      if (!chosen) {
        throw AppError.badRequest(
          "Seçilen parti bu iş emrine ait değil (ya da kapanmış) — listeyi yenileyip tekrar seçin.",
          { code: "BATCH_INVALID", batchId: input.batchId },
        );
      }
      resolvedBatchId = chosen.id;
      resolvedBatchNumber = chosen.batchNumber;
    } else if (openBatches.length === 1) {
      // TEK parti → sessizce ona bağla. Operatöre tek seçenekli soru sormak
      // sürtünmedir; mobil onay ekranı hangi partiye gittiğini ZATEN yazar.
      resolvedBatchId = openBatches[0].id;
      resolvedBatchNumber = openBatches[0].batchNumber;
    } else if (openBatches.length > 1) {
      throw AppError.badRequest(
        "Bu iş emrinde birden fazla açık parti var — topun hangi partiye ekleneceğini seçin.",
        {
          code: "BATCH_REQUIRED",
          batches: openBatches.map((b) => ({ id: b.id, batchNumber: b.batchNumber })),
        },
      );
    }
    // openBatches.length === 0 → parti hiç kullanılmamış; NULL meşrudur.
    //
    // ── OTOMATİK PARTİ (D7, `batch.autoCreateEnabled`) ─────────────────────
    // Bayrak AÇIKKEN bu dal artık NULL bırakmaz: sunucu partiyi KENDİSİ açar.
    // ⚠️ ADI "otomatik", "zorunlu" DEĞİL — burada 400 vermek ÇIKIŞSIZ bir kapı
    // olurdu: sistemde sıfırdan parti YARATAN bir uç yok (`batch.routes` yalnız
    // move/merge/split taşır) ve operatörün kapıyı açacak hiçbir yolu olmazdı.
    // Bayrak KAPALIYKEN (varsayılan) davranış bayt-bayt bugünküdür.
    //
    // ⚠️ Karar burada VERİLİR, parti aşağıda FAZ 2 TX'İNDE doğar. Sebep: parti
    // burada doğsaydı ve top bağlaması sonra düşseydi (claim çakışması, ölü
    // WO…) her denemede BOŞ bir parti kalır ve kısa numara sayacını (P01…P99)
    // boşuna yakardı — 99 numaralık dönen sayaçta bu ucuz bir hata değil.
    const autoCreateBatch =
      !input.batchId && openBatches.length === 0
        ? await readBatchAutoCreateEnabled()
        : false;


    // 4. durum ve gövde kapısı faz 1'in boğazında (`createInitialEntry` R).

    // FAZ 1 — topun kendisi. `isMobileOrigin=false` BİLİNÇLİ: istek Tambur
    // tabletinden (eşleşmiş cihaz) gelse de bu bir KK1 istasyon taraması DEĞİL,
    // elle girilen bir kayıttır → `entrySource` zincir-dışı doğumun makine-okunur
    // işaretini taşımalı. `Boolean(req.device)` mantığı burada geçersiz.
    //
    // ⚠️ Değer TAMBUR_MANUAL'dir, MANUAL_ENTRY DEĞİL (aşağıda `forcedEntrySource`).
    // Bu yorum bir süre tersini söyledi ve okuyanı yanılttı: MANUAL_ENTRY,
    // Electron panelinden elle top girişine ait; Tambur'un iki manuel yolu
    // (adıma bağlı + kartsız) TAMBUR_MANUAL yazar.
    const created = await this.inventoryService.createInitialEntry(
      {
        itemId,
        colorId,
        initialQty: input.initialQty,
        weightKg: input.weightKg,
        qualityGrade: input.qualityGrade,
        // EN: operatöre SORULMAZ, iş emrinden MİRAS alınır (2026-08-04 kararı).
        // Gerekçe ürün/renkle aynı: bu top ŞU iş emrinin malı ve o iş emrinin eni
        // sabittir; operatöre tekrar sordurmak hem gereksiz sürtünme hem de
        // iş emriyle çelişen bir değer girme riski. Operatör açıkça bir değer
        // gönderirse (eski istemci) o kullanılır; hiçbiri yoksa NULL kalır.
        width: input.width ?? (step.workOrder.width != null ? Number(step.workOrder.width) : null),
        clientToken: input.clientToken,
      },
      ctx.userId,
      ctx.machineId ?? null,
      // isMobileOrigin cevabı bu yolda ANLAMSIZ — giriş yeri aşağıda AÇIKÇA
      // veriliyor; sezgi hiç danışılmıyor.
      false,
      {
        // GİRİŞ YERİ: TAMBUR_MANUAL (2026-08-04 saha bulgusu).
        //
        // Eskiden sezgiye bırakılıyordu ve `MANUAL_ENTRY` yazılıyordu — yani
        // Electron admin panelinden elle girilmiş gibi. Oysa bu top TAMBUR
        // TABLETİNDEN, bir iş emrinin adımına eklendi. Envanter detayında
        // "Manuel Giriş" yazması operatörü yanlış yere bakmaya iterdi.
        //
        // Kartsız üretimle (`produceFinishedRoll`) AYNI değer bilinçli: ikisi de
        // "Tambur'da elle yaratıldı" demek. Aralarındaki fark (iş emrine bağlı mı
        // değil mi) topun `currentStep`/iş emri bağından ZATEN okunuyor, ayrıca
        // audit olayları da ayrı (`TAMBUR_MANUAL_ROLL` ↔ `TAMBUR_MANUAL_PRODUCE`).
        forcedEntrySource: RollEntrySource.TAMBUR_MANUAL,
        // Açık iş emrinin ürettiği top — mevcut malı yürütür (E): "Tükenene kadar" kartta da akar.
        itemUsage: "EXISTING_GOODS",
        // Sebep artık TOPUN ÜZERİNDE kalıcı kolonda (audit'e ek olarak): audit
        // 6 ayda bir arşivleniyor, oradan okumak sebebi zamanla kaybettiriyordu.
        entryReason: reason,
        // Katalog KODU — rapor anahtarı (metin görünen kayıt). Yukarıda çözüldü.
        entryReasonCode: reasonCode,
        // KAT — operatörün o an seçtiği değer (miras DEĞİL).
        foldType: foldType ?? null,
        // GİRİŞ İSTASYONU — adım kazanır. Oturum da elde ama ikisinin eşit
        // olduğu yukarıdaki STATION_MISMATCH guard'ıyla zaten garanti.
        entryStationId: resolveEntryStationId({
          stepStationId: step.stationId,
          sessionStationId: ctx.stationId,
        }),
      },
    );
    const roll = created.data;

    // FAZ 2 — Tambur adımına bağla. İLK iş iş emri satır kilidi + taze durum (parti numarası
    // kilidi 8022 bundan SONRA — Parti Ekle boğazı ve diğer parti doğuranlarla aynı sıra).
    const attach = await prisma.$transaction(async (tx) => {
      await touchWorkOrderTx(tx, step.workOrderId);
      const woNow = await tx.workOrder.findUnique({ where: { id: step.workOrderId }, select: { status: true } });
      if (woNow?.status === WorkOrderStatus.COMPLETED) throw completedNoAddError();
      if (!woNow || manualMoveWoBlockReason(woNow.status)) {
        throw AppError.conflict("İş emri bu sırada kapandı ya da iptal edildi — listeyi yenileyin.", { code: "WORKORDER_DEAD" });
      }
      const fresh = await tx.roll.findUnique({
        where: { id: roll.id },
        select: {
          status: true,
          currentStepId: true,
          currentQty: true,
          weightKg: true,
          sackId: true,
          shipmentId: true,
          warehouseId: true,
        },
      });
      if (!fresh) throw AppError.notFound("Top bulunamadı", { code: "ROLL_NOT_FOUND" });

      // İdempotent tekrar: top zaten bu adımda üretimde → hareketi garanti et, çık.
      if (fresh.status === RollStatus.IN_PRODUCTION && fresh.currentStepId === step.id) {
        const open = await tx.rollMovement.findFirst({
          where: { ...ACTIVE_MOVEMENT, rollId: roll.id, workOrderStepId: step.id, exitedAt: null },
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
        return { alreadyAttached: true };
      }

      // Atomik claim — createInitialEntry topu renkliyse WAREHOUSE, renksizse
      // STOCK yaratır; ikisi de serbest olmalı (çuval/sevk yok, adımsız).
      // OTOMATİK PARTİ (D7) — TX İÇİNDE doğar ki claim düşerse parti de geri
      // sarılsın (boş parti + yanan numara kalmaz). İdempotent dal yukarıda
      // ERKEN döndüğü için replay ikinci bir parti açmaz.
      if (autoCreateBatch && !resolvedBatchId) {
        const { batch } = await createBatchTx(tx, {
          workOrderId: step.workOrderId,
          rollIds: [],
          userId: ctx.userId,
        });
        resolvedBatchId = batch.id;
        resolvedBatchNumber = batch.batchNumber;
      }

      const claim = await tx.roll.updateMany({
        where: {
          id: roll.id,
          status: { in: [RollStatus.STOCK, RollStatus.WAREHOUSE] },
          sackId: null,
          shipmentId: null,
          currentStepId: null,
        },
        data: {
          currentStepId: step.id,
          status: RollStatus.IN_PRODUCTION,
          // PARTİ — yukarıda çözüldü. FAZ 1 (createInitialEntry) partiyi bilmez
          // (genel envanter girişidir); bağlama FAZ 2'nin işidir.
          ...(resolvedBatchId ? { batchId: resolvedBatchId } : {}),
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işleme girdi — ekranı yenileyip tekrar deneyin.",
          { code: "ROLL_STATE_CHANGED", rollId: roll.id, status: fresh.status },
        );
      }

      // DEPO DEFTERİ — Faz 1 topu rafa yazdı (`ENTRY_RECEIPT`), Faz 2 üretime alıyor:
      // çıkış satırı yazılmazsa top hem üretimde hem defterde rafta kalır (ölçüldü
      // 2026-09-13). Görüntü claim ÖNCESİ `fresh`ten; `attachRolls` ile aynı yazıcı.
      await postProductionIssuesTx(tx, [{ id: roll.id, ...fresh }], { workOrderStepId: step.id, userId: ctx.userId ?? null });

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

      // Adım/WO durumu: yeni açık hareket adımı ACTIVE'e çeker; PLANNED WO üretime girer.
      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, step.workOrderId);
      return { alreadyAttached: false };
    });

    // GERÇEKÇİLİK EŞİĞİ — UYARI, blok DEĞİL (ağırlık tarafıyla aynı gerekçe:
    // metraj elle de cihazdan da girebiliyor, sert tavan meşru yükü reddeder).
    // Audit'ten ÖNCE hesaplanır: uyarı yalnız yanıta değil kalıcı ize de girer (çuval tartısı emsali).
    const thresholdWarning = lengthWarning(input.initialQty);

    // Zincir-dışı doğumun KALICI sebep izi (dosya başlığı, madde 2).
    await AuditService.log({
      userId: ctx.userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: TAMBUR_MANUAL_ROLL_MARKER,
        reason,
        reasonCode,
        ...(thresholdWarning ? { thresholdWarning } : {}),
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
        batchId: resolvedBatchId,
        batchNumber: resolvedBatchNumber,
        // Parti OPERATÖRÜN seçimi mi, sistemin tek-seçenekten türettiği mi?
        // Sonradan "yanlış partiye yazılmış" denirse cevabı bu ayrım verir.
        batchSource: input.batchId
          ? "OPERATOR"
          : autoCreateBatch
            ? "AUTO_CREATED"
            : resolvedBatchId
              ? "AUTO_SINGLE"
              : "NONE",
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
        reopenedWorkOrder: false,
        // Parti operatöre GERİ SÖYLENİR. Tek açık parti varsa backend onu
        // SORMADAN bağlar (sürtünmesiz doğru cevap) — ama sessiz kalırsa
        // operatör topun partisiz gittiğini sanır; ekranda PARTİSİZ grubunu
        // görene kadar da fark etmez. Bu alan o boşluğu kapatır.
        batchId: resolvedBatchId,
        batchNumber: resolvedBatchNumber,
      },
      ...(thresholdWarning ? { warnings: [thresholdWarning] } : {}),
      message: `Top elle eklendi ve "${step.station.name}" adımına alındı${
        resolvedBatchNumber ? ` (parti: ${resolvedBatchNumber})` : ""
      }. Barkod: ${roll.barcode}`,
    };
  }

  // ===========================================================================
  // 3) KARTSIZ BİTMİŞ ÜRÜN ("Manuel Mod") — iş emri YOK
  // ===========================================================================

  /**
   * Tambur ekranını **refakat kartı olmadan** kullandırır: operatör ekrandaki
   * kumaş/metraj/müşteri seçimini yapar, çıkan top DOĞRUDAN **Bitmiş Depo**'ya
   * (`WAREHOUSE`) yazılır. Hiçbir iş emrine, adıma, partiye ya da harekete
   * bağlanmaz.
   *
   * ---------------------------------------------------------------------------
   * NEDEN `POST /manual/roll` (createManualRoll) BU İŞE YARAMAZ
   * ---------------------------------------------------------------------------
   * O uçta `targetStepId` ZORUNLUDUR ve çıktıyı bir iş emri adımına bağlar
   * (`IN_PRODUCTION` + açık hareket). Cevapladığı soru: *"kart var ama top ekranda
   * görünmüyor"*. Buradaki soru bambaşka: *"kart YOK"* — top bir yerde takıldı ya
   * da elde kalan bitmiş mal acilen sisteme alınacak. Aynı uca opsiyonel bir
   * `targetStepId` eklemek iki niyeti tek gövdede birleştirirdi ve kapsam yine
   * "alan dolu mu" gibi örtük bir şeye bağlanırdı (top-düzeltme ucunun
   * `Boolean(reason)` hatasının aynısı — bkz. kök CLAUDE.md "Top düzeltme = TEK
   * sözleşme"). Ayrı uç = ayrı niyet = ayrı audit olayı.
   *
   * ---------------------------------------------------------------------------
   * BU KK1'İN KOPYASI DEĞİL
   * ---------------------------------------------------------------------------
   * KK1 = **ham top girişi**, işin OLAĞAN parçası (üretime girecek mal). Bu uç =
   * **bitmiş ürün**, ACİL DURUM. Ayrım tek bir alanda somutlaşır: statü
   * `WAREHOUSE` olarak AÇIKÇA verilir, `createInitialEntry`in renk sezgisine
   * BIRAKILMAZ. Sezgi (`colorId != null ? WAREHOUSE : STOCK`) KK1'de doğrudur ama
   * burada sessizce yanlıştır — ham beyaz (renksiz) bitmiş bir top Ham Stok'a
   * düşer, operatör onu Bitmiş Depo'da arar, bulamaz ve "sistem kaydetmedi" der.
   *
   * İZ (şemaya kolon EKLENMEDİ — WO kapanış dispozisyonu deseni):
   *   1. `Roll.entrySource = TAMBUR_MANUAL` (indeksli kolon) — cihaz sezgisi
   *      BYPASS edilir (`forcedEntrySource`). Sezginin iki cevabı da yanlış olurdu:
   *      istek Tambur tabletinden gelir ama KK1 istasyon taraması DEĞİL
   *      (`SUPPLIER_RECEIPT` → envanterde "tedarikçi girişi" görünürdü), Electron
   *      admin panelinden de gelmiyor (`MANUAL_ENTRY` → giriş YERİ yanlış olurdu).
   *      Kendi değeri var ki topun detay panelinde "Tambur (Manuel)" yazsın —
   *      "her top bir kaynağa dayanır" zincirinde bilinçli açılan bu tek delik
   *      envanterde AYIRT EDİLEBİLİR kalsın.
   *   2. Audit `event = TAMBUR_MANUAL_PRODUCE` → sebep + operatör + makine + istasyon.
   *   3. `form = TOP` — Tambur bitmiş TOP üretir (şema varsayılanı da TOP; açık
   *      kumaş yalnız istasyon finalize'ında doğar). Bilinçli olarak yazılmıyor.
   *
   * Hareket (`RollMovement`) AÇILMAZ: hareket bir istasyondan geçişi anlatır,
   * burada geçilen istasyon yok. `currentStepId` null kalır → top serbest depoda.
   */
  /**
   * (a′) Elle top replay'i — YALNIZ bu adıma zaten bağlanmış top (adımda AKTİF hareketi olan; geri alınmış bağlama
   * sayılmaz) için; bulunmazsa null → bugünkü
   * akış. Kimlik: metre + (gönderildiyse) ürün/renk. 4. durum: iptal/fire → `ENTRY_CANCELLED`. Yanıt ilk başarının
   * biçiminde, `alreadyAttached: true`. Kalan dar pencere: ilk deneme doğdu ama bağlanamadı + arada iş emri kapandı.
   */
  private manualRollAttachedReplay(input: { targetStepId: string; initialQty: number; itemId?: string; colorId?: string | null }) {
    const select = {
      id: true, barcode: true, status: true, itemId: true, colorId: true, initialQty: true, currentQty: true,
      batch: { select: { id: true, batchNumber: true } },
    } as const;
    type Prior = Prisma.RollGetPayload<{ select: typeof select }> & {
      step: { id: string; station: { name: string }; workOrder: { workOrderNumber: string; targetColorId: string | null } };
    };
    return tokenReplay<Prior, ApiResponse<unknown>>({
      find: async (db, clientToken) => {
        const roll = await db.roll.findFirst({ where: { clientToken, movements: { some: { ...ACTIVE_MOVEMENT, workOrderStepId: input.targetStepId } } }, select });
        if (!roll) return null;
        const step = await db.workOrderStep.findUniqueOrThrow({
          where: { id: input.targetStepId },
          select: { id: true, station: { select: { name: true } }, workOrder: { select: { workOrderNumber: true, targetColorId: true } } },
        });
        return { ...roll, step };
      },
      alive: (r) => assertRollReplayAlive(r),
      identity: (r) => [
        { ad: "initialQty", mevcut: r.initialQty, gelen: input.initialQty },
        ...(input.itemId ? [{ ad: "itemId", mevcut: r.itemId, gelen: input.itemId }] : []),
        ...(input.colorId !== undefined ? [{ ad: "colorId", mevcut: r.colorId, gelen: input.colorId }] : []),
      ],
      collision: "Bu istemci anahtarı farklı bir topla kullanılmış. Formu yeniden açıp tekrar deneyin.",
      collisionEk: (r) => ({ barcode: r.barcode }),
      respond: (r) => ({
        success: true,
        data: {
          rollId: r.id, barcode: r.barcode, itemId: r.itemId, colorId: r.colorId,
          colorSource: r.step.workOrder.targetColorId ? "WORKORDER" : r.colorId ? "OPERATOR" : "NONE",
          currentQty: Number(r.currentQty), targetStepId: r.step.id, workOrderNumber: r.step.workOrder.workOrderNumber,
          alreadyAttached: true, reopenedWorkOrder: false, batchId: r.batch?.id ?? null, batchNumber: r.batch?.batchNumber ?? null,
        },
        message: `Top elle eklendi ve "${r.step.station.name}" adımına alındı${r.batch ? ` (parti: ${r.batch.batchNumber})` : ""}. Barkod: ${r.barcode}`,
      }),
    });
  }

  /**
   * Kartsız bitmiş top — token replay'i tek boğazdan (R, TEPEDE): ön-okuma sebep/kat/etiket niyeti kapılarından ÖNCE.
   * Replay yanıtı saklı etiket görüntüsünü yankılar (yeni gövdenin niyetini değil); ikinci CREATE audit yazılmaz.
   */
  async produceFinishedRoll(...args: Parameters<TamburManualService["produceFinishedRollFresh"]>): Promise<ApiResponse<unknown>> {
    const [input] = args;
    return this.finishedRollReplay(input).run(input.clientToken, () => this.produceFinishedRollFresh(...args));
  }

  private finishedRollReplay(input: { itemId: string; colorId?: string | null; initialQty: number }) {
    const select = {
      id: true, barcode: true, status: true, form: true, itemId: true, colorId: true, initialQty: true, currentQty: true,
      qualityGrade: true, markedForKartela: true, lastLabelSnapshot: true,
    } as const;
    return tokenReplay<Prisma.RollGetPayload<{ select: typeof select }>, ApiResponse<unknown>>({
      find: (db, clientToken) => db.roll.findUnique({ where: { clientToken }, select }),
      alive: (r) => assertRollReplayAlive(r),
      identity: (r) => [
        { ad: "itemId", mevcut: r.itemId, gelen: input.itemId?.trim() },
        { ad: "colorId", mevcut: r.colorId, gelen: input.colorId ?? null },
        { ad: "initialQty", mevcut: r.initialQty, gelen: input.initialQty },
      ],
      collision: "Bu istemci anahtarı farklı bir topla kullanılmış. Formu yeniden açıp tekrar deneyin.",
      collisionEk: (r) => ({ barcode: r.barcode }),
      respond: (r) => ({
        success: true,
        data: {
          rollId: r.id, barcode: r.barcode, status: r.status, form: r.form, itemId: r.itemId, colorId: r.colorId,
          currentQty: Number(r.currentQty), qualityGrade: r.qualityGrade, markedForKartela: r.markedForKartela,
          labelIntent: r.lastLabelSnapshot, idempotentReplay: true,
        },
        message: `Bu top zaten kayıtlıydı (tekrar deneme). Barkod: ${r.barcode}`,
      }),
    });
  }

  private async produceFinishedRollFresh(
    input: {
      itemId: string;
      colorId?: string | null;
      initialQty: number;
      qualityGrade?: string;
      width?: number | null;
      weightKg?: number;
      /** Etiket niyeti — "Kime?" bölümü. İkisi de boşsa stok (müşterisiz). */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      markedForKartela?: boolean;
      reason: string;
      /** Sebebin KATALOG KODU — opsiyonel; `createManualRoll` ile aynı sözleşme. */
      reasonCode?: string | null;
      clientToken: string;
      /**
       * KAT (2-KAT / 4-KAT / TÜP…) — topun KALICI özelliği (Roll.foldType).
       * Verilmezse NULL kalır; miras ALINMAZ, operatörün o an seçtiği değerdir.
       */
      foldType?: string | null;
    },
    ctx: TamburFieldContext = {},
  ): Promise<ApiResponse<unknown>> {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni zorunlu (en az 3 karakter)", {
        code: "REASON_REQUIRED",
      });
    }
    // Sebep KODU (2026-08-21) — tx DIŞINDA; `createManualRoll` ile aynı kapı.
    const { code: reasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_MANUAL_ENTRY, {
      reasonCode: input.reasonCode,
      reasonText: reason,
    });
    if (!(input.initialQty > 0)) {
      throw AppError.badRequest("Metraj pozitif olmalı", { code: "QTY_REQUIRED" });
    }
    // Kat katalog doğrulaması — payload tutarlılığı, bağlam çözümünden önce.
    const foldType = await resolveFoldTypeForWrite(input.foldType);

    // Ürün ZORUNLU: miras alınacak bir iş emri YOK (createManualRoll'un
    // `targetItemId` mirası burada yok — kart olmadığı için hedef de yok).
    const itemId = input.itemId?.trim();
    if (!itemId) {
      throw AppError.badRequest(
        "Ürün seçilmeli — kartsız üretimde miras alınacak iş emri yok.",
        { code: "ITEM_REQUIRED" },
      );
    }

    // Etiket niyeti pre-tx çözülür (müşteri var-mı + isActive) — Tambur kesim
    // siteleriyle AYNI yardımcı; kopya çözümleyici yok.
    const intent = await resolveLabelIntent({
      targetOrderLineId: input.targetOrderLineId,
      targetCustomerId: input.targetCustomerId,
    });

    // İdempotent tekrar mı? (`clientToken @unique` — asıl koruma create'te; bu
    // okuma yalnız CEVABI dürüst etiketlemek için. Yarışta iki eşzamanlı istek de
    // "yeni" der; zararsız — top yine TEK doğar, `createInitialEntry` P2002'yi
    // yakalayıp mevcut kaydı döner.)

    let created;
    try {
      created = await this.inventoryService.createInitialEntry(
        {
          itemId,
          colorId: input.colorId ?? null,
          initialQty: input.initialQty,
          weightKg: input.weightKg,
          qualityGrade: input.qualityGrade,
          width: input.width ?? null,
          clientToken: input.clientToken,
        },
        ctx.userId,
        ctx.machineId ?? null,
        // isMobileOrigin cevabı bu yolda ANLAMSIZ — giriş yeri aşağıda AÇIKÇA
        // veriliyor (`forcedEntrySource`), sezgi hiç danışılmıyor.
        false,
        {
          // ⚠️ Statü RENKTEN, giriş yeri CİHAZDAN çıkarılmaz — kararın tamamı
          // bu iki satırda (yukarıdaki iz #1).
          forcedStatus: RollStatus.WAREHOUSE,
          forcedEntrySource: RollEntrySource.TAMBUR_MANUAL,
          // Açık iş emrinin ürettiği top — mevcut malı yürütür (E): "Tükenene kadar" kartta da akar.
          itemUsage: "EXISTING_GOODS",
          // Sebep kalıcı kolonda (audit'e EK olarak — audit arşivleniyor).
          entryReason: reason,
          entryReasonCode: reasonCode,
          // KAT — Manuel Mod bunu operatöre ZORUNLU soruyor; Zod eksikken
          // veri buraya hiç ulaşmıyordu.
          foldType: foldType ?? null,
          // Bu yolda ADIM YOK (kartsız üretim) → tek kaynak oturum.
          entryStationId: resolveEntryStationId({ sessionStationId: ctx.stationId }),
          markedForKartela: input.markedForKartela,
          labelIntentSnapshot: buildIntentSnapshot(intent),
        },
      );
    } catch (err) {
      // Alt katman (ürün pasif / kalite kodu geçersiz / kg girişi kapalı) kod
      // TAŞIMAZ; mesajı koru, makine-okunur kod ekle (mobil onu okur).
      if (err instanceof AppError) {
        throw new AppError(err.message, err.statusCode, err.isOperational, {
          ...(err.details ?? {}),
          code: (err.details?.code as string | undefined) ?? "ENTRY_REJECTED",
        });
      }
      throw err;
    }
    const roll = created.data;
    // Yarışın kaybedeni de replay'dir: faz 1'in boğazı `idempotent: true` döndü → ikinci CREATE audit yazılmaz.
    const idempotentReplay = created.idempotent === true;

    // Zincir-dışı doğumun KALICI sebep izi (iz #2). Tekrar denemede de yazılır —
    // "operatör bunu iki kez denedi" saha teşhisinde bilgidir; `idempotentReplay`
    // bayrağı satırı ayırt eder.
    if (!idempotentReplay) await AuditService.log({
      userId: ctx.userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: TAMBUR_MANUAL_PRODUCE_EVENT,
        reason,
        reasonCode,
        barcode: roll.barcode,
        itemId,
        colorId: roll.colorId,
        initialQty: Number(roll.initialQty),
        weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
        width: roll.width !== null ? Number(roll.width) : null,
        qualityGrade: roll.qualityGrade,
        status: roll.status,
        form: roll.form,
        entrySource: roll.entrySource,
        markedForKartela: roll.markedForKartela,
        labelIntent: intent,
        clientToken: input.clientToken,
        machineId: ctx.machineId ?? null,
        sessionStationId: ctx.stationId ?? null,
        idempotentReplay,
      },
    });

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        form: roll.form,
        itemId: roll.itemId,
        colorId: roll.colorId,
        currentQty: Number(roll.currentQty),
        qualityGrade: roll.qualityGrade,
        markedForKartela: roll.markedForKartela,
        labelIntent: intent,
        idempotentReplay,
      },
      message: idempotentReplay
        ? `Bu top zaten kayıtlıydı (tekrar deneme). Barkod: ${roll.barcode}`
        : `Bitmiş top depoya eklendi. Barkod: ${roll.barcode}`,
    };
  }
}
