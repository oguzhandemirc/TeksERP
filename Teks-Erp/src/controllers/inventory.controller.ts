// =============================================================================
// TeksERP - Inventory Controller
// =============================================================================
// Handles HTTP layer for inventory/roll operations.
// Delegates business logic to InventoryService.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { InventoryService } from "../services/inventory.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import { matchesPermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

// Zod validation schemas
const initialEntrySchema = z.object({
  itemId:       z.string().uuid("Geçersiz ürün ID"),
  colorId:      z.string().uuid("Geçersiz renk ID").optional().nullable(),
  initialQty:   z.number().positive("Miktar pozitif olmalı").max(999_999_999, "Miktar çok büyük"),
  weightKg:     z.number().positive("Ağırlık pozitif olmalı").max(999_999_999, "Ağırlık çok büyük").optional(),
  qualityGrade: z.string().optional(),
  width:        z.number().positive("En pozitif olmalı").max(999_999_999, "En çok büyük").optional().nullable(),
  propertyIds:  z.array(z.string().uuid("Geçersiz özellik ID")).optional().default([]),
  // Offline KK1 / ağ-retry idempotency anahtarı (UUID) — barkod artık sunucuda sıralı
  // atanır; aynı token'la 2. çağrı cached Roll döner (mükerrer-top önlenir).
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});

const openFabricSchema = z.object({
  receiptId: z.string().uuid("Geçersiz mal kabul ID"),
  stepId:    z.string().uuid("Geçersiz adım ID"),
  notes:     z.string().max(1000).optional().nullable(),
  // İdempotency anahtarı (initialEntry emsali) — çift çağrıda ikinci hayalet
  // açık-kumaş doğmasın; aynı token'la 2. çağrı cached Roll döner.
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});

// Süpervizör manuel nitelik düzeltme (renk/özellik/en/kalite) — applyManualProperties
// ile aynı motor ama ZORUNLU sebep (audit event=MANUAL_ATTRIBUTE). itemId/barcode YOK.
const manualAttributesSchema = z.object({
  colorId:      z.string().uuid("Geçersiz renk ID").optional().nullable(),
  propertyIds:  z.array(z.string().uuid("Geçersiz özellik ID")).optional(),
  width:        z.number().positive("En pozitif olmalı").max(999_999_999).optional().nullable(),
  qualityGrade: z.string().trim().max(50).optional(),
  reason:       z.string().trim().min(3, "İşlem nedeni (en az 3 karakter) zorunludur").max(500),
});

// Envanter özeti — N kategori filtresi (buildRollForceFilters) tek istekte sayılır.
const statsBatchSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        filters: z.record(z.string(), z.any()).optional(),
      }),
    )
    .min(1)
    .max(50),
});

// Süpervizör "İstasyondan Kurtar" — IN_PRODUCTION takılı topu depoya alır. Zorunlu sebep (audit).
const rescueSchema = z.object({
  reason: z.string().trim().min(3, "İşlem nedeni en az 3 karakter").max(500),
});

// Saha #4: top etiketi değiştir (renk/özellik/en/kalite). Tümü opsiyonel; renk
// null=renksiz. propertyIds verilirse TAM liste (replace).
const relabelSchema = z.object({
  colorId:      z.string().uuid("Geçersiz renk ID").optional().nullable(),
  propertyIds:  z.array(z.string().uuid("Geçersiz özellik ID")).optional(),
  width:        z.number().positive("En pozitif olmalı").max(999_999_999).optional().nullable(),
  qualityGrade: z.string().trim().max(50).optional(),
  // Metraj (currentQty) düzeltmesi — yanlış girilen ölçüm. Aynı guard'lara tabi
  // (hurda/iptal + commit'li sevkiyat reddi). Kısmen tüketilmiş topta servis reddeder.
  currentQty:   z.number().positive("Metraj pozitif olmalı").max(999_999).optional(),
  // İşlem nedeni. Serbest satılabilir stokta OPSİYONEL; top üretimdeyse (serbest
  // stok dışı) servis ZORUNLU kılar ve `roll:manual-adjust` yetkisi arar — böylece
  // eski `/manual-attributes` ucunun süpervizör kapsamı bu tek uçtan karşılanır.
  reason:       z.string().trim().min(3, "İşlem nedeni en az 3 karakter olmalı").max(500).optional(),
});

// Yeni model: KK2 ölçüm yapmaz; totalMeters opsiyonel — verilmezse roll'un
// mevcut currentQty'si (fason kabulden gelen irsaliye değeri) kullanılır.
// Hata aralık değil nokta (endMeter kaldırıldı). Hatalar genelde "Hata Ekle"
// (reportError) ile tek tek girilir; bu endpoint sadece roll'u ilerletir.
const kursunFinishSchema = z.object({
  totalMeters: z.number().positive("Toplam metraj pozitif olmalı").max(999_999, "Toplam metraj çok büyük").optional(),
  errors: z
    .array(
      z.object({
        startMeter:   z.number().nonnegative("startMeter negatif olamaz"),
        defectTypeId: z.string().uuid().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
  notes: z.string().max(1000).optional().nullable(),
});

export class InventoryController {
  private service: InventoryService;

  constructor() {
    this.service = new InventoryService();
    // Bind methods for Express route handler usage
    this.createInitialEntry = this.createInitialEntry.bind(this);
    this.findAllRolls = this.findAllRolls.bind(this);
    this.getProductionFlow = this.getProductionFlow.bind(this);
    this.getRollStats = this.getRollStats.bind(this);
    this.getRollStatsBatch = this.getRollStatsBatch.bind(this);
    this.getWarehouseScope = this.getWarehouseScope.bind(this);
    this.getSubcontractorSummary = this.getSubcontractorSummary.bind(this);
    this.findRollById = this.findRollById.bind(this);
    this.findRollByBarcode = this.findRollByBarcode.bind(this);
    this.getRelabelContext = this.getRelabelContext.bind(this);
    this.getRelabelContextById = this.getRelabelContextById.bind(this);
    this.getRollHistory = this.getRollHistory.bind(this);
    this.cancelPreview = this.cancelPreview.bind(this);
    this.softDelete = this.softDelete.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
    this.createOpenFabric = this.createOpenFabric.bind(this);
    this.kursunFinish = this.kursunFinish.bind(this);
    this.relabel = this.relabel.bind(this);
    this.prepareForSale = this.prepareForSale.bind(this);
    this.manualAttributes = this.manualAttributes.bind(this);
    this.rescuePreview = this.rescuePreview.bind(this);
    this.rescueStuck = this.rescueStuck.bind(this);
  }

  /**
   * POST /api/rolls/open-fabric
   * Kurşun/KK2'de açık kumaş Roll oluştur (boyahane fason kabul sonrası).
   */
  async createOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = openFabricSchema.parse(req.body);
      const result = await this.service.createOpenFabric(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/kursun-finish
   * Açık kumaş Roll'unun Kurşun/KK2 sonunu işle: metraj + hata + Tambur'a ilerlet.
   */
  async kursunFinish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = kursunFinishSchema.parse(req.body);
      // Makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      const stamp = await getStampContext(req, { enforceForMobile: true });
      const result = await this.service.kursunFinish(
        id,
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/:id/history
   */
  async getRollHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getRollHistory(id);
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
   * POST /api/rolls/initial-entry
   * Create a new roll via goods receipt (Mal Kabul / QC1).
   */
  async createInitialEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = initialEntrySchema.parse(req.body);
      // KK1 makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      const stamp = await getStampContext(req, { enforceForMobile: true });
      // entrySource ayrımı: Electron ASLA x-device-id göndermez (bkz. Electron
      // apiClient.ts) → req.device yalnız eşleşmiş mobil cihazda dolu olur.
      const result = await this.service.createInitialEntry(
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
        Boolean(req.device),
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls
   * List rolls with dynamic filtering, sorting, pagination.
   */
  async findAllRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findAllRolls(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/production-flow
   * Üretim Akışı (Kanban) panosu — 6 kolon TEK istekte (her kolon 10 önizleme +
   * gerçek toplam). Uç `roll:read` ile korunur; kolon-bazlı ince yetki burada:
   * `quality:read` yoksa Kurşun/Tambur, `shipping:read/write` yoksa Sevk boş döner.
   */
  async getProductionFlow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const perms = req.user?.permissions ?? [];
      const includeQueues = matchesPermission(perms, "quality:read");
      const includeSevk =
        matchesPermission(perms, "shipping:read") || matchesPermission(perms, "shipping:write");
      const result = await this.service.getProductionFlow({ includeQueues, includeSevk });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/stats
   * Liste ile aynı filtre setini paylaşan özet (toplam adet/metraj/kg + status & kalite dağılımı).
   */
  async getRollStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRollStats(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/stats-batch
   * Envanter özeti — N kategori filtresi için toplu sayım (top + metre), tek istekte.
   */
  async getRollStatsBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = statsBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: "Geçersiz istek gövdesi (items)" });
        return;
      }
      const result = await this.service.getRollStatsBatch(parsed.data.items);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getWarehouseScope(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getWarehouseScope();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/subcontractor-summary
   * Fasonda sekmesi özet şeridi — firma + işlem (kategori) bazlı açık fason dağılımı.
   */
  async getSubcontractorSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Şerit, liste "Fire kaliteyi de göster" toggle'ıyla aynı FIRE evrenini
      // kullansın diye filter[includeFire] okunur (varsayılan: FIRE-hariç).
      const includeFire = req.query["filter[includeFire]"] === "true";
      const result = await this.service.getRollSubcontractorSummary(includeFire);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/:id
   * Get roll by ID with all relations.
   */
  async findRollById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.findRollById(id);
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
   * GET /api/rolls/barcode/:barcode
   * Get roll by barcode (for hand-held scanner use).
   */
  async findRollByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // `/barcode/` (trailing slash, boş) Express'te `:barcode` param'ını
      // hiç route etmiyor; başka bir route'a düşüp (örn. `/:id`) yanıltıcı
      // "Top bulunamadı" mesajı veriyordu. Şu kontrol explicit 400 verir.
      // (Bu method'a giriyorsak param zaten matched ama yine de güvenlik
      // ağı — whitespace-only veya bekleneneden farklı bir string).
      const rawBarcode = req.params.barcode;
      if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
        res.status(400).json({
          success: false,
          message: "Barkod parametresi gerekli",
        });
        return;
      }
      const result = await this.service.findRollByBarcode(rawBarcode.trim());
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
   * GET /api/rolls/barcode/:barcode/relabel-context
   * Yeniden-Etiketleme istasyonu — barkod okut, topun tüm spec'i + konum/guard +
   * son basıldığı yer + "B" müşteri adayları. Salt-okunur.
   */
  async getRelabelContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawBarcode = req.params.barcode;
      if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
        res.status(400).json({ success: false, message: "Barkod parametresi gerekli" });
        return;
      }
      const result = await this.service.getRelabelContext({ barcode: rawBarcode.trim() });
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
   * GET /api/rolls/:id/relabel-context — aynı bağlam, rollId ile.
   * Barkodsuz açık kumaş (fason dönüşü / istasyonda bekleyen top) barkodla
   * bulunamaz; tek "Düzelt" diyaloğu onu da açabilmek için bu ucu kullanır.
   */
  async getRelabelContextById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRelabelContext({ rollId: req.params.id as string });
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
   * DELETE /api/rolls/:id
   * Soft-delete (operatör iptali): topu CANCELLED yapar (fire/SCRAP değil).
   */
  /**
   * GET /api/rolls/:id/cancel-preview
   * Top iptal önizlemesi — silmeden önce somut etki (hangi istasyon/iş emri).
   */
  async cancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // İstasyonda aktif top için bilinçli onay: ?confirmActive=true.
      const confirmActive = req.query.confirmActive === "true";
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId,
        { confirmActive }
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/rolls/:id/permanent
   * Arşivle (soft): STOCK/SCRAP/CANCELLED topu CANCELLED'e çeker — fiziksel DELETE yok.
   */
  async hardDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.hardDelete(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/rolls/:id/label — TEK düzeltme ucu (renk/özellik/en/kalite/metraj).
   *
   * Kapsam topun durumundan çözülür (servis): serbest satılabilir stokta sebep
   * opsiyoneldir; top üretimdeyse sebep ZORUNLU + `roll:manual-adjust` aranır.
   * `permissions` HER ZAMAN geçirilir — güvenlik sınırı burasıdır (F221 deseni).
   */
  async relabel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = relabelSchema.parse(req.body);
      const result = await this.service.applyManualProperties(
        req.params.id as string,
        {
          colorId: body.colorId ?? null,
          propertyIds: body.propertyIds ?? [],
          width: body.width,
          qualityGrade: body.qualityGrade,
          currentQty: body.currentQty,
          reason: body.reason,
        },
        req.user?.userId,
        { permissions: req.user?.permissions ?? [] },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/prepare-for-sale — Saha #10: ham/stok topu satışa hazırla
   * (STOCK → WAREHOUSE). Sevk akışı (scan + kapsama + dispatch) bundan sonra çalışır.
   */
  async prepareForSale(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.prepareRawForSale(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/rolls/:id/manual-attributes — süpervizör manuel nitelik düzeltme
   * (renk/özellik/en/kalite) + zorunlu sebep. applyManualProperties motorunu kullanır.
   */
  async manualAttributes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = manualAttributesSchema.parse(req.body);
      const result = await this.service.applyManualProperties(
        req.params.id as string,
        {
          colorId: body.colorId ?? null,
          propertyIds: body.propertyIds ?? [],
          width: body.width,
          qualityGrade: body.qualityGrade,
          reason: body.reason,
        },
        req.user?.userId,
        { permissions: req.user?.permissions ?? [] },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/:id/rescue-preview — istasyonda takılı (IN_PRODUCTION) top kurtarma önizlemesi.
   */
  async rescuePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRescuePreview(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/rescue-stuck — istasyonda takılı topu depoya kurtar (roll:manual-adjust).
   */
  async rescueStuck(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = rescueSchema.parse(req.body);
      const result = await this.service.rescueStuckRoll(
        req.params.id as string,
        { reason: body.reason },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
