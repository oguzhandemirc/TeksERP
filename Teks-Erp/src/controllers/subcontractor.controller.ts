// =============================================================================
// TeksERP - Subcontractor (Fason) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { SubcontractorService } from "../services/subcontractor.service";
import { cancelWarpBeamReturn, returnWarpBeam } from "../services/subcontractor-beam.service";
import { cancelYarnReturn, returnYarn, yarnAtSubcontractor } from "../services/subcontractor-yarn.service";
import { readDevereEnabled, readIplikEnabled } from "../services/system-setting.service";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const dispatchSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  subcontractorId: z.string().uuid(),
  /** K11: seçim 2+ partiye yayılıyorsa — SEPARATE parti başına ayrı sevk (tek tx), MERGE en eski partide birleştir; yoksa 409 MULTI_BATCH. */
  multiBatchStrategy: z.enum(["MERGE", "SEPARATE"]).optional(),
  // F1: `rollIds` tek başına boş olabilir — levent-yalnız sevk; ikisi birden boşsa aşağıdaki refine (eski mesaj).
  rollIds: z.array(z.string().uuid()).max(500, "Tek seferde en fazla 500 top sevk edilebilir").default([]),
  /** F1: fasona verilen leventler (kalem `kind=WARP_BEAM`). Devere kapalıysa 403 (gövde kapısı). */
  warpBeamIds: z.array(z.string().uuid()).max(50, "Tek seferde en fazla 50 levent sevk edilebilir").optional(),
  /** G1: fasona verilen İPLİK satırları (kalem `kind=YARN`, kg). İplik kapalıysa 403 (gövde kapısı). */
  yarnLines: z.array(z.object({
    itemId: z.string().uuid("Geçersiz iplik kartı"),
    warehouseId: z.string().uuid("Geçersiz depo"),
    lotId: z.string().uuid("Geçersiz lot").nullish(),
    qtyKg: z.number().positive("İplik kg pozitif olmalı").max(100_000),
  }).strict()).max(50, "Tek seferde en fazla 50 iplik satırı").optional(),
  plateNumber: z.string().max(32).optional(),
  driverName: z.string().max(128).optional(),
  notes: z.string().max(1000).optional(),
  /** Fason talimatı — genel sevk notundan ayrı (opsiyonel; boşsa adımın notu). */
  instruction: z.string().max(1000).optional(),
  /** Operatör WO ürünü vs rulo ürünü uyuşmazlığını bilinçli onayladı. */
  allowItemOverride: z.boolean().optional(),
  /** Operatör rota-atlama uyarısını bilinçli onayladı (ROUTE_SKIP geçişi). */
  allowRouteSkip: z.boolean().optional(),
}).refine((b) => b.rollIds.length > 0 || (b.warpBeamIds?.length ?? 0) > 0 || (b.yarnLines?.length ?? 0) > 0, { message: "En az bir top seçmelisiniz", path: ["rollIds"] });

/** G1 iplik dönüşü — `qtyKg` dönen kg (Σ ≤ giden), `reasonCode` ZORUNLU (katalog `YARN_SUBCONTRACT_RETURN`), depo/lot opsiyonel (varsayılan çıkışınki). */
const yarnReturnSchema = z.object({
  qtyKg: z.number().positive("Dönen kg pozitif olmalı").max(100_000),
  reasonCode: z.string().trim().min(1, "Dönüş sebebi zorunlu").max(64),
  warehouseId: z.string().uuid("Geçersiz depo").nullish(),
  lotId: z.string().uuid("Geçersiz lot").nullish(),
}).strict();
const yarnReturnCancelSchema = z.object({ movementId: z.string().uuid("Geçersiz dönüş satırı"), reason: z.string().trim().min(3).max(300) }).strict();

/** F1 levent dönüşü — `lengthM` dönen metre (≤ giden), `clientToken` replay anahtarı. */
const beamReturnSchema = z.object({
  lengthM: z.union([z.number(), z.string()]),
  clientToken: z.string().uuid().optional(),
});
const beamReturnCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Masaüstü toplu sevk — top okutmadan adımdaki bekleyen tüm topları sevk eder. */
const bulkDispatchSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  /** K11: seçim 2+ partiye yayılıyorsa — SEPARATE parti başına ayrı sevk (tek tx), MERGE en eski partide birleştir; yoksa 409 MULTI_BATCH. */
  multiBatchStrategy: z.enum(["MERGE", "SEPARATE"]).optional(),
  /** Yoksa adımın plannedSubcontractorId'si kullanılır. */
  subcontractorId: z.string().uuid().optional(),
  /** Verilirse yalnız bu toplar sevk edilir; yoksa adımdaki bekleyen hepsi. */
  rollIds: z.array(z.string().uuid()).min(1).max(500, "Tek seferde en fazla 500 top seçilebilir").optional(),
  allowRouteSkip: z.boolean().optional(),
  instruction: z.string().max(1000).optional(),
  plateNumber: z.string().max(32).optional(),
  driverName: z.string().max(128).optional(),
});

/** Fasondan fasona doğrudan aktarım (zımpara→boyahane; fabrikaya uğramadan). */
const transferNextSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  /** Yoksa sonraki adımın plannedSubcontractorId'si kullanılır. */
  nextSubcontractorId: z.string().uuid().optional(),
  /** Verilirse yalnız bu (fasonda bekleyen) toplar aktarılır; yoksa hepsi. */
  rollIds: z.array(z.string().uuid()).min(1).max(500, "Tek seferde en fazla 500 top seçilebilir").optional(),
  instruction: z.string().max(1000).optional(),
});

/** Erken TASLAK fason çeki — bir sonraki fason adımı için (sevkten önce). */
const cekiDraftSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
});

const updateInstructionSchema = z.object({
  // Boş string / null → talimatı temizle.
  instruction: z.string().max(1000).trim().nullish(),
});

const cancelDispatchSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
});

const cancelDispatchBulkSchema = z.object({
  dispatchIds: z.array(z.string().uuid()).min(1, "İptal edilecek sevk seçilmedi").max(50),
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
});

const directShipSchema = z.object({
  reason: z.string().trim().min(3, "Fasondan sevk sebebi en az 3 karakter").max(500),
  /** Sevk edilecek topların alt-kümesi (yok/boş = sevkin tümü). */
  rollIds: z.array(z.string().uuid()).max(500).optional(),
  /** Kısmi metraj: topId → sevk edilecek metre. Kalan'dan azsa top bölünür
   *  (çocuk = sevk edilen, orijinal = kalan, fasonda kalır). */
  rollShipQtys: z.record(z.string().uuid(), z.number().positive()).optional(),
  /** Mal kime gitti — DirectShipment + irsaliye için zorunlu (serviste doğrulanır). */
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** true → fason son durak: kalan adımlar atlanır, WO tamamlanır. */
  completeWorkOrder: z.boolean().optional(),
  /** Opsiyonel karşılanma: mal hangi sipariş satır(lar)ına ne kadar gitti. */
  orderLineAllocations: z
    .array(z.object({ orderLineId: z.string().uuid(), qty: z.number().positive() }))
    .max(200)
    .optional(),
  /** "Siparişsiz devam et" beyanı — `shipping.orderRequirement=block` kaçış
   *  kapısı. Zod'a EKLENMEZSE alan sessizce düşer ve kaçış yolu hiç açılmaz
   *  (istemci kutuyu işaretler, uçta yine 400 yer). */
  orderless: z.boolean().optional(),
});

// "Kalan gelmeyecek" kapaması — fire kararı, sebep ZORUNLU (fire kataloğundan;
// DIGER seçildiyse servis reasonText'i zorlar — validateVarianceReason fail-closed).
const closeRemainderSchema = z.object({
  stepId: z.string().uuid(),
  rollId: z.string().uuid(),
  reasonCode: z.string().trim().min(1, "Sebep zorunlu").max(64),
  reasonText: z.string().trim().max(500).nullish(),
});

/** Kalan kapamasının GERİ ALINMASI (BULGU-T3-017) — sebep İSTENMEZ: bu bir
 *  düzeltmedir, yeni bir fire kararı değil. İz audit'te (SUBCONTRACTOR_REMAINDER_REOPENED). */
const reopenRemainderSchema = z.object({
  stepId: z.string().uuid(),
  rollId: z.string().uuid(),
});

const cancelReceiptSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
  /** Receipt'ten doğan açık kumaş roll'larını cascade iptal et. Liste backend
   *  preview'den alınıp aynen geri gönderilmeli; eksik/fazla id → 409. */
  cascadeRollIds: z.array(z.string().uuid()).optional(),
});

const receiveSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  subcontractorId: z.string().uuid(),
  manifestNo: z.string().trim().max(64).nullish(),
  returns: z
    .array(
      z.object({
        rollId: z.string().uuid(),
        notes: z.string().max(500).nullish(),
        // KISMİ KABUL: bu teslimatta bu toptan gelen metraj. Verilmez ya da
        // kalanı aşar/eşitler → TAM kabul (eski APK davranışı birebir). Kalanın
        // altındaysa top fasonda kalır, kalan ikinci teslimatla kapanır.
        receivedQty: z.number().positive("Gelen metraj pozitif olmalı").nullish(),
      })
    )
    .min(1, "En az bir dönüş kaydı girin")
    .max(300, "Tek seferde en fazla 300 dönüş kaydı girilebilir"),
  notes: z.string().max(1000).optional(),
  // Doğan topların partisi — kabulün açık sevklerinden biri; verilmezse en eski açık sevk (D8 R5b).
  batchId: z.string().uuid().nullish(),
  // İdempotency anahtarı — kısmi teslimatta replay'in tek kimliği (servis notu).
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  // Receipt seviyesinde uygulanan kimlik (boyahane gibi açık kumaş döndüren
  // fason için). Renk: appliesColor=true kategoride WO.targetColor otomatik;
  // özellik: appliesProperty=true kategoride WO.targetProperties otomatik.
  appliedColorId: z.string().uuid().nullish(),
  // Tabletin KABUL EKRANINI AÇARKEN gördüğü iş emri hedef rengi (null = hedefsiz).
  // Sunucu kilit altında taze hedefle karşılaştırır; farklıysa 409
  // `TARGET_COLOR_CHANGED` (planlamacı arada rengi değiştirdi → operatör yenilesin).
  // Gönderilmezse kontrol YOK — eski APK bozulmaz (fail-open, bilinçli).
  expectedTargetColorId: z.string().uuid().nullable().optional(),
  // Plandan FARKLI renk kabul edilirken operatörün kararı (2026-08-21):
  //   APPLY_TO_PLAN → kabulden sonra iş emrinin hedef rengi de bu renge çekilir
  //                   (en gibi; tek bekçiden geçer, olmazsa yanıt `warnings`)
  //   ROLLS_ONLY    → yalnız doğan toplar bu renkte; sapma KABULDE deftere düşer,
  //                   Tambur aynı topa tekrar sormaz.
  // Gönderilmezse eski davranış (karar yok, Tambur yakalar).
  planColorAction: z.enum(["APPLY_TO_PLAN", "ROLLS_ONLY"]).optional(),
  appliedPropertyIds: z.array(z.string().uuid()).optional(),
  // Bu kabulde ÖLÇÜLEN en (cm) — doğan tüm parçalara uygulanır ve makbuza yazılır.
  // Renkten farkı: renk yalnız "renk veren" kategoride sorulur, en HER fason
  // dönüşünde sorulur (topun enini ilk kez burada öğreniyoruz; ham girişte en
  // tasarım gereği yazılmıyor). OPSİYONEL kalması zorunlu — zorunlu yapmak
  // sahadaki, alanı göndermeyen eski APK'ların HER fason kabulünü 400'e düşürürdü.
  // Zorunluluk arayüzde yaşar (gönder butonu pasif).
  appliedWidth: z.number().positive("En pozitif olmalı").max(999_999_999, "En çok büyük").nullish(),
  // Fasondan gelen açık kumaş parçaları — ZORUNLU. Receipt anında her parça
  // için open-fabric Roll kaydı (barcode=null) doğar ve rotadaki bir sonraki
  // adıma (genelde Kurşun/KK2) bağlanır. Boş geçilirse KK2 ekranına ve stok
  // listelerine kart yansımaz; operatör/depo sorumluları açık kumaşı göremez.
  // İrsaliyede kaç parça/metre geldiği zaten yazıyor; receive sırasında girilir.
  newRolls: z
    .array(
      z.object({
        qty: z.number().positive("Metraj pozitif olmalı"),
        weightKg: z.number().positive().nullish(),
        notes: z.string().max(500).nullish(),
      })
    )
    // Cap: her parça tx içinde ayrı roll.create+rollMovement üretir (per-row).
    .min(1, "En az bir açık kumaş parçası girilmeli (metraj zorunlu)")
    .max(300, "Tek seferde en fazla 300 açık kumaş parçası girilebilir"),
});

export class SubcontractorController {
  private service: SubcontractorService;

  constructor() {
    this.service = new SubcontractorService();
    this.dispatch = this.dispatch.bind(this);
    this.bulkDispatch = this.bulkDispatch.bind(this);
    this.transferToNextFason = this.transferToNextFason.bind(this);
    this.fasonCekiDraft = this.fasonCekiDraft.bind(this);
    this.updateInstruction = this.updateInstruction.bind(this);
    this.cancelDispatch = this.cancelDispatch.bind(this);
    this.cancelDispatchBulk = this.cancelDispatchBulk.bind(this);
    this.receive = this.receive.bind(this);
    this.closeRemainder = this.closeRemainder.bind(this);
    this.reopenRemainder = this.reopenRemainder.bind(this);
    this.pendingReturns = this.pendingReturns.bind(this);
    this.pendingReturnDetail = this.pendingReturnDetail.bind(this);
    this.listDispatches = this.listDispatches.bind(this);
    this.getDispatch = this.getDispatch.bind(this);
    this.returnWarpBeam = this.returnWarpBeam.bind(this);
    this.cancelWarpBeamReturn = this.cancelWarpBeamReturn.bind(this);
    this.returnYarn = this.returnYarn.bind(this);
    this.cancelYarnReturn = this.cancelYarnReturn.bind(this);
    this.yarnAtSubcontractor = this.yarnAtSubcontractor.bind(this);
    this.getDispatchDyeOverlay = this.getDispatchDyeOverlay.bind(this);
    this.listReceipts = this.listReceipts.bind(this);
    this.getReceiptPrint = this.getReceiptPrint.bind(this);
    this.getReceipt = this.getReceipt.bind(this);
    this.cancelReceipt = this.cancelReceipt.bind(this);
    this.getCancelPreview = this.getCancelPreview.bind(this);
    this.getDirectShipPreview = this.getDirectShipPreview.bind(this);
    this.directShip = this.directShip.bind(this);
    this.getUndoTransferPreview = this.getUndoTransferPreview.bind(this);
    this.undoTransfer = this.undoTransfer.bind(this);
  }

  /** POST /api/subcontractor/dispatch */
  async dispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = dispatchSchema.parse(req.body);
      // Kapalı modülün YAZMA yolu yoktur: levent kalemi yalnız devere açıkken kabul edilir
      // (E1 emsali `initial-entry doffEventId`; kapı `requireDevereEnabled` ile aynı gövde).
      if ((body.warpBeamIds?.length ?? 0) > 0 && !(await readDevereEnabled())) {
        throw AppError.forbidden("Devere modülü bu kurulumda kapalı; fason sevkine levent kalemi eklenemez. Sistem → Modüller bölümünden açılabilir.", {
          code: "MODULE_DISABLED",
          modul: "devere",
        });
      }
      // G1: iplik satırı yalnız iplik açıkken (aynı gövde kapısı; tek yazıcı `applyYarnMovementTx` ikinci hat).
      if ((body.yarnLines?.length ?? 0) > 0 && !(await readIplikEnabled())) {
        throw AppError.forbidden("İplik modülü bu kurulumda kapalı; fason sevkine iplik satırı eklenemez. Sistem → Modüller bölümünden açılabilir.", {
          code: "MODULE_DISABLED",
          modul: "iplik",
        });
      }
      const result = await this.service.dispatch(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/beams/:beamId/return — F1 levent fasondan döndü (RETURNED_IN) */
  async returnWarpBeam(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = beamReturnSchema.parse(req.body);
      const result = await returnWarpBeam(req.params.id as string, { warpBeamId: req.params.beamId as string, ...body }, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/yarn-items/:itemId/return — G1 iplik fasondan döndü (SUBCONTRACT_RETURN) */
  async returnYarn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = yarnReturnSchema.parse(req.body);
      const result = await returnYarn(req.params.id as string, { dispatchItemId: req.params.itemId as string, ...body }, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/yarn-items/:itemId/return-cancel — dönüş stornosu (SUBCONTRACT_RETURN_CANCEL) */
  async cancelYarnReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = yarnReturnCancelSchema.parse(req.body);
      const result = await cancelYarnReturn(req.params.id as string, { dispatchItemId: req.params.itemId as string, ...body }, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/:subcontractorId/yarn-balance — K1 (b) fasondaki iplik (türetilmiş, kalem × lot) */
  async yarnAtSubcontractor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await yarnAtSubcontractor(req.params.subcontractorId as string));
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/beams/:beamId/return-cancel — dönüş stornosu (RETURNED_IN_CANCEL) */
  async cancelWarpBeamReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = beamReturnCancelSchema.parse(req.body);
      const result = await cancelWarpBeamReturn(req.params.id as string, { warpBeamId: req.params.beamId as string, reason: body.reason }, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatch/bulk — masaüstü toplu sevk (okutmasız) */
  async bulkDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bulkDispatchSchema.parse(req.body);
      const result = await this.service.bulkDispatchStep(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/transfer-next — fasondan fasona doğrudan aktarım */
  async transferToNextFason(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = transferNextSchema.parse(req.body);
      const result = await this.service.transferToNextFason(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/fason-ceki-draft?workOrderId=&stepId= — erken TASLAK çeki */
  async fasonCekiDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workOrderId, stepId } = cekiDraftSchema.parse({
        workOrderId: req.query.workOrderId,
        stepId: req.query.stepId,
      });
      const result = await this.service.previewDownstreamFasonCeki(workOrderId, stepId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/subcontractor/dispatches/:id/instruction */
  async updateInstruction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = updateInstructionSchema.parse(req.body);
      const result = await this.service.updateInstruction(
        id,
        body.instruction ?? null,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/cancel */
  async cancelDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cancelDispatchSchema.parse(req.body);
      const result = await this.service.cancel(id, body.reason, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/cancel-bulk */
  async cancelDispatchBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = cancelDispatchBulkSchema.parse(req.body);
      const result = await this.service.cancelBulk(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/receive */
  async receive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = receiveSchema.parse(req.body);
      const result = await this.service.receive(
        {
          workOrderId: body.workOrderId,
          stepId: body.stepId,
          subcontractorId: body.subcontractorId,
          batchId: body.batchId,
          manifestNo: body.manifestNo,
          notes: body.notes,
          clientToken: body.clientToken ?? null,
          returns: body.returns.map((r) => ({
            rollId: r.rollId,
            notes: r.notes ?? null,
            receivedQty: r.receivedQty ?? null,
          })),
          appliedColorId: body.appliedColorId,
          expectedTargetColorId: body.expectedTargetColorId,
          planColorAction: body.planColorAction,
          appliedPropertyIds: body.appliedPropertyIds,
          appliedWidth: body.appliedWidth,
          newRolls: body.newRolls?.map((nr) => ({
            qty: nr.qty,
            weightKg: nr.weightKg ?? null,
            notes: nr.notes ?? null,
          })),
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/close-remainder — fasonda kalan "gelmeyecek" kapaması */
  async closeRemainder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = closeRemainderSchema.parse(req.body);
      const result = await this.service.closeRemainder(
        {
          stepId: body.stepId,
          rollId: body.rollId,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText ?? null,
        },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** Kalan kapamasını geri al — makbuz yeniden iptal edilebilir olsun (T3-017). */
  async reopenRemainder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reopenRemainderSchema.parse(req.body);
      const result = await this.service.reopenRemainder(
        { stepId: body.stepId, rollId: body.rollId },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/subcontractor/pending-returns?workOrderId=... */
  async pendingReturns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listPendingReturns({
        workOrderId:
          typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/pending-returns/step/:stepId */
  async pendingReturnDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getPendingReturnGroupDetail(req.params.stepId as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches */
  async listDispatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const qStr = (v: unknown): string | undefined =>
        typeof v === "string" && v.length > 0 ? v : undefined;

      const STATUSES = ["all", "active", "cancelled"] as const;
      type DStatus = (typeof STATUSES)[number];
      const statusRaw = qStr(req.query.status);
      const status: DStatus | undefined = (STATUSES as readonly string[]).includes(
        statusRaw ?? "",
      )
        ? (statusRaw as DStatus)
        : undefined;

      const dateFromStr = qStr(req.query.dateFrom);
      const dateToStr = qStr(req.query.dateTo);
      const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined;
      const dateTo = dateToStr ? new Date(dateToStr) : undefined;

      const result = await this.service.listDispatches({
        workOrderId:     qStr(req.query.workOrderId),
        subcontractorId: qStr(req.query.subcontractorId),
        status,
        search:          qStr(req.query.search),
        dateFrom:        dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
        dateTo:          dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
        // offset
        page:            qStr(req.query.page) ? Number(req.query.page) : undefined,
        pageSize:        qStr(req.query.pageSize) ? Number(req.query.pageSize) : undefined,
        // cursor
        cursor:          qStr(req.query.cursor),
        mode:            qStr(req.query.mode),
        limit:           qStr(req.query.limit) ? Number(req.query.limit) : undefined,
        withTotal:       req.query.withTotal === "true",
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches/:id */
  async getDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // F1: levent kalemi OPT-IN (`?includeBeams=1`) — eski istemci `roll` bekler, null bağ görmez.
      const result = await this.service.getDispatch(req.params.id as string, { includeBeams: req.query.includeBeams === "1" });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches/:id/dye-overlay */
  async getDispatchDyeOverlay(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getDispatchDyeOverlay(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts */
  async listReceipts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cancellableRaw = req.query.cancellable;
      const cancellable =
        cancellableRaw === "yes" || cancellableRaw === "no"
          ? (cancellableRaw as "yes" | "no")
          : undefined;
      const result = await this.service.listReceipts({
        workOrderId:     typeof req.query.workOrderId     === "string" ? req.query.workOrderId     : undefined,
        subcontractorId: typeof req.query.subcontractorId === "string" ? req.query.subcontractorId : undefined,
        page:            typeof req.query.page            === "string" ? Number(req.query.page)     : undefined,
        pageSize:        typeof req.query.pageSize        === "string" ? Number(req.query.pageSize) : undefined,
        mode:            typeof req.query.mode            === "string" ? req.query.mode            : undefined,
        limit:           typeof req.query.limit           === "string" ? Number(req.query.limit)   : undefined,
        cursor:          typeof req.query.cursor          === "string" ? req.query.cursor          : undefined,
        withTotal:       req.query.withTotal === "true",
        cancellable,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts/:id/print */
  async getReceiptPrint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceiptPrintSnapshot(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts/:id */
  async getReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceipt(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts/:id/cancel-preview */
  async getCancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getCancelPreview(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches/:id/direct-ship-preview */
  async getDirectShipPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.previewDirectShip(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/direct-ship */
  async directShip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = directShipSchema.parse(req.body);
      const result = await this.service.executeDirectShip(
        {
          dispatchId: id,
          reason: body.reason,
          rollIds: body.rollIds,
          rollShipQtys: body.rollShipQtys,
          customerId: body.customerId,
          branchId: body.branchId,
          completeWorkOrder: body.completeWorkOrder,
          orderLineAllocations: body.orderLineAllocations,
          orderless: body.orderless,
        },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches/:id/undo-transfer-preview */
  async getUndoTransferPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getUndoTransferPreview(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/dispatches/:id/undo-transfer */
  async undoTransfer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cancelDispatchSchema.parse(req.body);
      const result = await this.service.undoTransfer(id, body.reason, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/receipts/:id/cancel */
  async cancelReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cancelReceiptSchema.parse(req.body);
      const result = await this.service.cancelReceipt(
        id,
        body.reason,
        req.user?.userId,
        body.cascadeRollIds ?? [],
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

}
