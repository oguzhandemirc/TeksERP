// =============================================================================
// TeksERP - Tambur Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TamburService } from "../services/tambur.service";
import { TamburUndoService } from "../services/tambur-undo.service";
import { KursunBypassService } from "../services/kursun-bypass.service";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { getStampContext } from "../services/helpers/work-session.helper";
import { FOLD_TYPES, foldTypeSchema } from "../services/helpers/fold-type";
import "../types/express-augment";

// Tambur finalize — yeni model (cumulative length-based):
//   cuts[]: operatörün tambur makinesinde yaptığı kesim sıralı listesi.
//   Her kesim → yeni child Roll. `length` = o kesimin uzunluğu (sayaç
//   sıfırdan başladığı için cumulative değil her cut bağımsız uzunluk).
//   `relatedErrorIds` opsiyonel — operatör hangi defect için kestiğini
//   belirtir (audit zinciri). Toplam(lengths) ≤ parent.currentQty; kalan
//   kısım otomatik son top olur (parent.qualityGrade ile).
//
//   cuts boş gönderilirse: kesim yok, parent'ın tüm metrajı tek child top
//   olarak depoya geçer (parent.qualityGrade).
//
//   decisions[]: defect lifecycle marker (NO_CUT veya CUT). Defect'ler
//   `cuts[].relatedErrorIds`'da geçtiyse CUT işaretlenir; geçmediyse
//   operatör defect'i bilerek bırakmış (NO_CUT, top içinde defect kalır).
const finalizeSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  cuts: z
    .array(
      z.object({
        length: z.number().positive("Kesim uzunluğu pozitif olmalı").max(100_000, "Kesim uzunluğu gerçekçi değil (max 100.000 m)"),
        qualityGrade: z.string().min(1, "Kalite seçilmelidir"),
        relatedErrorIds: z.array(z.string().uuid()).default([]),
      })
    )
    // Cap: her segment tx içinde ayrı roll.create+property+op üretir. Cömert üst
    // sınır — pathological girdinin 5s tx timeout'una/uzun kilide yol açmasını önler.
    .max(200, "Tek seferde en fazla 200 kesim girilebilir")
    .default([]),
  decisions: z
    .array(
      z.object({
        errorId: z.string().uuid("Geçersiz hata ID"),
        decision: z.enum(["CUT", "NO_CUT"], { message: "Karar CUT veya NO_CUT olmalı" }),
      })
    )
    .default([]),
  foldType: z.enum(FOLD_TYPES).optional(),
  markedForKartela: z.boolean().optional(),
});

// Hata sadece NOKTA olarak girilir (startMeter); endMeter artık tutulmuyor.
const reportErrorSchema = z.object({
  rollId: z.string().uuid(),
  stepId: z.string().uuid(),
  startMeter: z.number().min(0).max(100_000, "Metre değeri gerçekçi değil"),
  defectTypeId: z.string().uuid(),
});

const cutOpenFabricSchema = z.object({
  lengthMeters: z.number().positive("Kesim metresi pozitif olmalı").max(100_000, "Kesim metresi gerçekçi değil (max 100.000 m)"),
  status: z.enum(["WAREHOUSE", "SCRAP", "A1_STOCK"], {
    message: "Status WAREHOUSE | SCRAP | A1_STOCK olmalı",
  }),
  qualityGrade: z.string().max(50).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  markedForKartela: z.boolean().optional(),
  // Etiket NİYETİ (gevşek model: BAĞ değil, baskı-anı müşteri/sipariş bağlamı).
  // Kesim anında child'ın lastLabelSnapshot'ına yazılır → yazıcı/ekran bağımsız
  // kalıcı. İkisi de boş = stok (müşterisiz). Var-mı/isActive servis katmanında.
  targetOrderLineId: z.string().uuid().optional().nullable(),
  targetCustomerId: z.string().uuid().optional().nullable(),
  // KAT — bu kesimde doğan ÇOCUĞUN kalıcı özelliği (2026-08-04).
  // Kesim anında seçilen değer kazanır: aynı topun iki parçası farklı kat
  // taşıyabilir ("top kesilerek yeni bir kat değeri kazanabilir"). Alan
  // GÖNDERİLMEZSE servis parent → iş emri planı sırasıyla fallback uygular
  // (eski APK'lar kırılmasın); bu MİRAS değil geri-uyumluluk fallback'idir.
  foldType: foldTypeSchema,
  // Offline/ağ-retry idempotency anahtarı (UUID) — barkod sunucuda sıralı atanır.
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});

const finalizeOpenFabricSchema = z.object({
  // Yeni: kalan metre için operatör kararı. Verilmezse scrapRemaining'den türetilir.
  remainingAction: z
    .enum(["keep_1kalite", "keep_a1", "scrap", "discard"])
    .optional(),
  // Eski param — geri uyum (mobile geçince kaldırılabilir).
  scrapRemaining: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
  // Tambur kararı — WO planlaması override (verilmezse WO.foldType kullanılır).
  foldType: foldTypeSchema,
});

const cutWarehouseRollSchema = z.object({
  cutLength: z.number().positive("Kesim metresi pozitif olmalı").max(100_000, "Kesim metresi gerçekçi değil (max 100.000 m)"),
  qualityGrade: z.string().max(50).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  markedForKartela: z.boolean().optional(),
  // Ham (renksiz STOCK) kesiminde çıkan parçanın hedefi. Bitmiş depo topu
  // kesiminde yok sayılır.
  rawDestination: z.enum(["STOCK", "WAREHOUSE"]).optional(),
  // Parcanin kati — verilmezse parent devralinir (bu yolda is emri yok).
  foldType: foldTypeSchema,
  // Etiket NİYETİ — bkz. cutOpenFabricSchema. WAREHOUSE child'a yazılır; raw→STOCK
  // child (üretime devam) için stok'a düşülür (servis WAREHOUSE guard'ıyla).
  targetOrderLineId: z.string().uuid().optional().nullable(),
  targetCustomerId: z.string().uuid().optional().nullable(),
  // Offline/ağ-retry idempotency anahtarı (UUID) — barkod sunucuda sıralı atanır.
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});

// Kurşun Dağıtım (bypass) kapanışı — Tambur tabletinde refakat kartı okutulur,
// önizleme onaylanır. `rollIds` KAPSAM sözleşmesidir: önizlemede görülen toplar
// birebir gönderilir (servis kapsam paritesini doğrular, sessizce daha az iş
// yapmaz). Yıkıcı-onay ilkesi: kapsam UI'da somut listelenir.
const bypassCompleteSchema = z.object({
  cardBarcode: z.string().trim().min(1, "Refakat kartı barkodu gereklidir"),
  rollIds: z
    .array(z.string().uuid("Geçersiz top ID"))
    .min(1, "En az bir top seçilmelidir"),
});

const finalizeWarehouseCutSchema = z.object({
  remainingAction: z
    .enum(["keep_1kalite", "keep_a1", "scrap", "discard"])
    .optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export class TamburController {
  private service: TamburService;
  private undoService: TamburUndoService;
  /** Kurşun Dağıtım kapanışı Tambur'dan tetiklenir — servis DOĞRUDAN çağrılır. */
  private bypassService: KursunBypassService;

  constructor() {
    this.service = new TamburService();
    this.undoService = new TamburUndoService();
    this.bypassService = new KursunBypassService();
    this.getUndoPreview = this.getUndoPreview.bind(this);
    this.applyUndo = this.applyUndo.bind(this);
    this.getPendingRolls = this.getPendingRolls.bind(this);
    this.getRollForDecision = this.getRollForDecision.bind(this);
    this.getByCardBarcode = this.getByCardBarcode.bind(this);
    this.getStep = this.getStep.bind(this);
    this.finalize = this.finalize.bind(this);
    this.listSwatches = this.listSwatches.bind(this);
    this.getSwatchStats = this.getSwatchStats.bind(this);
    this.reportError = this.reportError.bind(this);
    this.listOpenCards = this.listOpenCards.bind(this);
    this.getSwatchByBarcode = this.getSwatchByBarcode.bind(this);
    this.listRecentOutputRolls = this.listRecentOutputRolls.bind(this);
    this.cutOpenFabric = this.cutOpenFabric.bind(this);
    this.finalizeOpenFabric = this.finalizeOpenFabric.bind(this);
    this.cutWarehouseRoll = this.cutWarehouseRoll.bind(this);
    this.finalizeWarehouseCut = this.finalizeWarehouseCut.bind(this);
    this.getTamburContext = this.getTamburContext.bind(this);
    this.completeKursunBypass = this.completeKursunBypass.bind(this);
  }

  /** GET /api/tambur/rolls/:rollId/undo-preview — geri alma önizlemesi (salt-okunur) */
  async getUndoPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rollId = z.string().uuid("Geçersiz top ID").parse(req.params.rollId);
      res.status(200).json(await this.undoService.getUndoPreview(rollId));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/rolls/:rollId/undo — kesim/finalize geri al (önizleme onaylı akış) */
  async applyUndo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rollId = z.string().uuid("Geçersiz top ID").parse(req.params.rollId);
      res.status(200).json(await this.undoService.applyUndo(rollId, req.user?.userId));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/:id/cut-warehouse */
  async cutWarehouseRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cutWarehouseRollSchema.parse(req.body);
      // Oturum bağlamı — çıkan parçanın GİRİŞ İSTASYONU damgası için.
      // ⚠️ `enforceForMobile` KOYULMADI: bu uç bugüne kadar oturum ZORUNLU
      // kılmıyordu; enforce eklemek oturumsuz tablette 409 üretir ve çalışan
      // Top Kesme akışını durdururdu. Damga "varsa yazılır" sözleşmesidir.
      const stamp = await getStampContext(req);
      const result = await this.service.cutWarehouseRoll(
        id,
        body,
        req.user?.userId,
        stamp?.stationId ?? null,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/tambur/:id/finalize-warehouse-cut */
  async finalizeWarehouseCut(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = finalizeWarehouseCutSchema.parse(req.body);
      // Kesilen parçayla AYNI damga — biri yapılıp diğeri unutulursa aynı kesimin
      // parçası dolu, kalanı boş doğar.
      const stamp = await getStampContext(req);
      const result = await this.service.finalizeWarehouseCut(
        id,
        body,
        req.user?.userId,
        stamp?.stationId ?? null,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/tambur/:id/cut */
  async cutOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cutOpenFabricSchema.parse(req.body);
      const result = await this.service.cutOpenFabric(id, body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/tambur/:id/finalize-open-fabric */
  async finalizeOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = finalizeOpenFabricSchema.parse(req.body);
      // Makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const result = await this.service.finalizeOpenFabric(
        id,
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/tambur/context/:cardBarcode */
  async getTamburContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cardBarcode = req.params.cardBarcode as string;
      // Saha düzeltmesi yetkisi olan operatör, adımda AÇIK TOP OLMASA DA kartı
      // açabilir (boş bağlam + `emptyStep: true`). Aksi halde "Topu Buraya Al /
      // Manuel Top Ekle" tam da gerektikleri anda ulaşılamaz kalıyordu: iki aksiyon
      // da açık karta bağlı, kart ise adım boşken hiç açılmıyordu.
      // Yetkisiz operatörde davranış DEĞİŞMEZ — boş kart kafa karıştırır, hata
      // doğru cevaptır.
      const allowEmptyStep = matchesPermission(req.user?.permissions ?? [], "mobile:tambur-duzelt")
        || matchesPermission(req.user?.permissions ?? [], "roll:manual-adjust");
      const result = await this.service.getTamburContext(cardBarcode, { allowEmptyStep });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/tambur/bypass-complete — kurşun dağıtımını Tambur okutmasıyla kapat */
  async completeKursunBypass(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bypassCompleteSchema.parse(req.body);
      // Makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      // (Makine damgası kapanan kurşun movement'ına YAZILMAZ — iş takipli makinede
      // yapılmadı; yalnız denetim izine düşer.)
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const result = await this.bypassService.completeFromTambur(
        { cardBarcode: body.cardBarcode, rollIds: body.rollIds },
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/tambur/recent-output-rolls?workOrderId=&limit= */
  async listRecentOutputRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workOrderId =
        typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined;
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const result = await this.service.listRecentOutputRolls({
        workOrderId,
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        mode: typeof req.query.mode === "string" ? req.query.mode : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        withTotal: req.query.withTotal === "true",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/swatches/by-barcode/:barcode */
  async getSwatchByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getSwatchByBarcode(
        (req.params.barcode as string).trim()
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/tambur/step/:stepId */
  async getStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getStep(req.params.stepId as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/report-error */
  async reportError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reportErrorSchema.parse(req.body);
      const result = await this.service.reportError(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/tambur/open-cards */
  async listOpenCards(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listOpenCards();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tambur/pending-rolls
   */
  async getPendingRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getPendingRolls();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tambur/by-card/:barcode
   */
  async getByCardBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = (req.params.barcode as string).trim();
      const result = await this.service.getByCardBarcode(barcode);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tambur/rolls/:rollId
   */
  async getRollForDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRollForDecision(req.params.rollId as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/tambur/finalize
   */
  async finalize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = finalizeSchema.parse(req.body);
      // Makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const result = await this.service.finalize(
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/swatches */
  async listSwatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listSwatches({
        itemId:      typeof req.query.itemId === "string" ? req.query.itemId : undefined,
        limit:       typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
        cursor:      typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        mode:        typeof req.query.mode === "string" ? req.query.mode : undefined,
        search:      typeof req.query.search === "string" ? req.query.search : undefined,
        withTotal:   req.query.withTotal === "true",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/swatches/stats */
  async getSwatchStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getSwatchStats({
        itemId:      typeof req.query.itemId === "string" ? req.query.itemId : undefined,
        search:      typeof req.query.search === "string" ? req.query.search : undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
