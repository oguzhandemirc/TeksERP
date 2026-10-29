// =============================================================================
// TeksERP - Kurşun + QC2 Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KursunQcService } from "../services/kursun-qc.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import "../types/express-augment";

// Export: Zod katmanı bekçisi (`test_property_value_selection` §Zod) — şema
// `properties`/`valueCode`yi sessizce ELERSE (2026-08-05 "kat iki uçta Zod'da
// yoktu" vakasının ikizi) test kırmızı versin diye dışa açık.
/** Sayaç okuması gövdesi — tablet `meterOut` ile düzeltme ucu ortak. */
const meterReadingBodySchema = z.object({
  meters: z.number().min(0, "Metre 0 veya daha büyük olmalı").lt(1e9, "Metre çok büyük"),
  source: z.enum(["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED"]),
  peripheralId: z.string().uuid("Geçersiz cihaz ID").nullish(),
  rawCounter: z.number().min(0).lt(1e11, "Sayaç değeri çok büyük").nullish(),
  cardSampleId: z.string().uuid("Geçersiz örnek ID").nullish(),
  clientToken: z.string().uuid("Geçersiz okuma kimliği"),
  /** H2 OPERATOR_REASON imzası. Katı: PIN ya da başka alan bu gövdeye (çevrimdışı kuyruğa) giremez. */
  ack: z
    .strictObject({
      reasonCode: z.string().trim().max(64, "Sebep kodu en fazla 64 karakter").nullish(),
      reasonText: z.string().trim().max(300, "Sebep en fazla 300 karakter").nullish(),
    })
    .nullish(),
});

/** POST /kursun-qc/meter-readings/:id/pin-ack — süpervizör PIN'i (yalnız çevrimiçi; gövde log'a yazılmaz). */
export const meterPinAckSchema = z.strictObject({
  pin: z.string().regex(/^\d{6}$/, "PIN 6 haneli olmalı"),
  reasonCode: z.string().trim().max(64).nullish(),
  reasonText: z.string().trim().max(300).nullish(),
});

/** POST /kursun-qc/meter-readings/:id/office-ack — ofis onayı (H4 ekranı). */
export const meterOfficeAckSchema = z.strictObject({
  reasonCode: z.string().trim().max(64).nullish(),
  reasonText: z.string().trim().max(300).nullish(),
});

export const completeQc2Schema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
  notes: z.string().max(500).nullish(),
  // Operatörün cevapları (mod sözleşmesi 2026-08-10 + değer sözleşmesi
  // 2026-08-11). AUTO satırlar gönderilmese de uygulanır; eski APK bu alanı hiç
  // göndermez → yalnız AUTO yazılır (bugünkü davranış).
  //
  // ⚠️ `valueCode` SEÇİM tipli özellikte zorunlu, BAYRAK'ta yasak — ikisini de
  // servis doğrular (`assertPropertySelectionsValid`), burada yalnız BİÇİM.
  properties: z
    .array(
      z.object({
        propertyId: z.string().uuid(),
        valueCode: z.string().trim().max(32).nullish(),
      }),
    )
    .max(50)
    .nullish(),
  // H1 (karar belgesi §3-4): çıkış metresi. `kursun.meterCapture` OFF iken yok sayılır
  // (bugünkü davranış); eski APK göndermez.
  meterOut: meterReadingBodySchema.nullish(),
});

/** POST /kursun-qc/meter-readings — düzeltme / giriş okuması (H1). */
export const meterReadingSchema = meterReadingBodySchema.extend({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
  phase: z.enum(["IN", "OUT"]),
});

// Hata sadece NOKTA olarak girilir (startMeter); endMeter artık tutulmuyor.
// Tambur operatörü ekranda bu noktayı görüp fiziksel kesim kararı verir.
const reportErrorSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
  startMeter: z.number().min(0, "Hata metresi 0 veya daha büyük olmalı"),
  defectTypeId: z.string().uuid("Hata tipi seçilmelidir"),
  // Mobil offline kuyruğu için opsiyonel client-üretimi UUID (idempotency).
  clientErrorId: z.string().uuid("Geçersiz hata ID").optional(),
});

const deleteErrorSchema = z.object({
  errorId: z.string().uuid("Geçersiz hata ID"),
});

const finishStepSchema = z.object({
  stepId: z.string().uuid("Geçersiz adım ID"),
});

const reopenStepSchema = z.object({
  stepId: z.string().uuid("Geçersiz adım ID"),
});

const reorderQueueSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid("Geçersiz adım ID"),
        priority: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, "En az bir kayıt gönderilmelidir"),
});

const setUrgentSchema = z.object({
  isUrgent: z.boolean(),
});

export class KursunQcController {
  private service: KursunQcService;

  constructor() {
    this.service = new KursunQcService();
    this.getByCardBarcode = this.getByCardBarcode.bind(this);
    this.getStep = this.getStep.bind(this);
    this.listOpenCards = this.listOpenCards.bind(this);
    this.completeQc2 = this.completeQc2.bind(this);
    this.reportError = this.reportError.bind(this);
    this.deleteError = this.deleteError.bind(this);
    this.finishStep = this.finishStep.bind(this);
    this.reopenStep = this.reopenStep.bind(this);
    this.recordMeterReading = this.recordMeterReading.bind(this);
    this.pinAckMeterReading = this.pinAckMeterReading.bind(this);
    this.officeAckMeterReading = this.officeAckMeterReading.bind(this);
    this.listPendingMeterAcks = this.listPendingMeterAcks.bind(this);
    this.reopenPreview = this.reopenPreview.bind(this);
    this.listQueue = this.listQueue.bind(this);
    this.reorderQueue = this.reorderQueue.bind(this);
    this.setQueueUrgent = this.setQueueUrgent.bind(this);
  }

  /** GET /api/kursun-qc/by-card/:barcode */
  async getByCardBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Okuma ucu: oturum varsa adım oturum istasyonundan çözülür (KQ-D2); enforce
      // YOK — bu uç bugün oturumsuz da çalışıyor (panel/web → bugünkü davranış).
      const stamp = await getStampContext(req);
      const result = await this.service.getByCardBarcode(
        req.params.barcode as string,
        stamp?.stationId ?? null,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/step/:stepId */
  async getStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stepId = z.string().uuid("Geçersiz adım ID").parse(req.params.stepId);
      // Tanınmayan değer 400 (fail-closed); eski istemci parametre göndermez → yalnız PROCESS.
      const includeInspection = z
        .enum(["0", "1"], { message: "includeInspection yalnız 0 ya da 1 olabilir" })
        .optional()
        .parse(req.query.includeInspection);
      const result = await this.service.getStep(stepId, { includeInspection: includeInspection === "1" });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/open-cards */
  async listOpenCards(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Oturum istasyonu varsa yalnız o istasyonun kartları (KQ-D2); enforce YOK.
      const stamp = await getStampContext(req);
      const result = await this.service.listOpenCards(stamp?.stationId ?? null);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/complete-qc2 */
  async completeQc2(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = completeQc2Schema.parse(req.body);
      // Makine atfı önce aktif çalışma oturumundan; oturum yoksa GEÇİŞ fallback'i
      // cihazın statik ataması (Faz 6'da sökülür — mobil oturum akışı gelince).
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const result = await this.service.completeQc2(
        {
          rollId: body.rollId,
          stepId: body.stepId,
          notes: body.notes ?? null,
          properties: body.properties ?? null,
          meterOut: body.meterOut ?? null,
        },
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/report-error */
  async reportError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reportErrorSchema.parse(req.body);
      const result = await this.service.reportError(
        {
          rollId: body.rollId,
          stepId: body.stepId,
          startMeter: body.startMeter,
          defectTypeId: body.defectTypeId,
          clientErrorId: body.clientErrorId,
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/kursun-qc/error */
  async deleteError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = deleteErrorSchema.parse(req.body);
      const result = await this.service.deleteError(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/finish-step */
  async finishStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = finishStepSchema.parse(req.body);
      // F165: kapanan KK2 movement'ına makine damgası — kursunFinish ile hizala.
      // Non-enforcing: oturum yoksa null döner (finishStep oturum zorunlu KILMAZ).
      const stamp = await getStampContext(req);
      const result = await this.service.finishStep(
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/reopen-step */
  async reopenStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reopenStepSchema.parse(req.body);
      const result = await this.service.reopenStep(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/meter-readings — H1 metre okuması (giriş ya da çıkış düzeltmesi). */
  async recordMeterReading(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = meterReadingSchema.parse(req.body);
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const { rollId, stepId, phase, ...input } = body;
      const result = await this.service.recordMeterReading(
        { rollId, stepId, phase, input },
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/meter-readings/:id/pin-ack — H2 süpervizör PIN'i (PIN yalnız burada; hata mesajı yankılamaz). */
  async pinAckMeterReading(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const readingId = z.string().uuid("Geçersiz okuma ID").parse(req.params.id);
      const body = meterPinAckSchema.parse(req.body);
      const result = await this.service.ackMeterReading(
        { readingId, mode: "SUPERVISOR_PIN", pin: body.pin, reason: { reasonCode: body.reasonCode, reasonText: body.reasonText } },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/meter-readings/:id/office-ack — H2 ofis onayı. */
  async officeAckMeterReading(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const readingId = z.string().uuid("Geçersiz okuma ID").parse(req.params.id);
      const body = meterOfficeAckSchema.parse(req.body ?? {});
      const result = await this.service.ackMeterReading(
        { readingId, mode: "OFFICE", reason: { reasonCode: body.reasonCode, reasonText: body.reasonText } },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/meter-deviations — imza bekleyen sapmalar (ofis listesi). */
  async listPendingMeterAcks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stepId = z.string().uuid("Geçersiz adım ID").optional().parse(req.query.stepId);
      res.status(200).json(await this.service.listPendingMeterAcks({ stepId }));
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/reopen-preview/:stepId */
  async reopenPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stepId = z.string().uuid("Geçersiz adım ID").parse(req.params.stepId);
      const result = await this.service.reopenPreview(stepId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/queue */
  async listQueue(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listQueue();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/kursun-qc/queue/reorder */
  async reorderQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reorderQueueSchema.parse(req.body);
      const result = await this.service.reorderQueue(body.items, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/kursun-qc/queue/:stepId/urgent */
  async setQueueUrgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stepId = z.string().uuid("Geçersiz adım ID").parse(req.params.stepId);
      const body = setUrgentSchema.parse(req.body);
      const result = await this.service.setQueueUrgent(
        stepId,
        body.isUrgent,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
