// =============================================================================
// TeksERP - Subcontractor (Fason) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { SubcontractorService } from "../services/subcontractor.service";
import "../types/express-augment";

const dispatchSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  subcontractorId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz").max(500, "Tek seferde en fazla 500 top sevk edilebilir"),
  plateNumber: z.string().max(32).optional(),
  driverName: z.string().max(128).optional(),
  notes: z.string().max(1000).optional(),
  /** Fason talimatı — genel sevk notundan ayrı (opsiyonel; boşsa adımın notu). */
  instruction: z.string().max(1000).optional(),
  /** Operatör WO ürünü vs rulo ürünü uyuşmazlığını bilinçli onayladı. */
  allowItemOverride: z.boolean().optional(),
  /** Operatör rota-atlama uyarısını bilinçli onayladı (ROUTE_SKIP geçişi). */
  allowRouteSkip: z.boolean().optional(),
});

/** Masaüstü toplu sevk — top okutmadan adımdaki bekleyen tüm topları sevk eder. */
const bulkDispatchSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
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

const directShipSchema = z.object({
  reason: z.string().trim().min(3, "Doğrudan sevk sebebi en az 3 karakter").max(500),
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
      })
    )
    .min(1, "En az bir dönüş kaydı girin")
    .max(300, "Tek seferde en fazla 300 dönüş kaydı girilebilir"),
  notes: z.string().max(1000).optional(),
  // Receipt seviyesinde uygulanan kimlik (boyahane gibi açık kumaş döndüren
  // fason için). Renk: appliesColor=true kategoride WO.targetColor otomatik;
  // özellik: appliesProperty=true kategoride WO.targetProperties otomatik.
  appliedColorId: z.string().uuid().nullish(),
  appliedPropertyIds: z.array(z.string().uuid()).optional(),
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
    this.receive = this.receive.bind(this);
    this.pendingReturns = this.pendingReturns.bind(this);
    this.pendingReturnDetail = this.pendingReturnDetail.bind(this);
    this.listDispatches = this.listDispatches.bind(this);
    this.getDispatch = this.getDispatch.bind(this);
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
      const result = await this.service.dispatch(body, req.user?.userId);
      res.status(201).json(result);
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

  /** POST /api/subcontractor/receive */
  async receive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = receiveSchema.parse(req.body);
      const result = await this.service.receive(
        {
          workOrderId: body.workOrderId,
          stepId: body.stepId,
          subcontractorId: body.subcontractorId,
          manifestNo: body.manifestNo,
          notes: body.notes,
          returns: body.returns.map((r) => ({
            rollId: r.rollId,
            notes: r.notes ?? null,
          })),
          appliedColorId: body.appliedColorId,
          appliedPropertyIds: body.appliedPropertyIds,
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
      const result = await this.service.getDispatch(req.params.id as string);
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
