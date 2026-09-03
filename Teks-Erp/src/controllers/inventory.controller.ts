// =============================================================================
// TeksERP - Inventory Controller
// =============================================================================
// Handles HTTP layer for inventory/roll operations.
// Delegates business logic to InventoryService.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { InventoryService } from "../services/inventory.service";
import { DuplicateRollsService } from "../services/duplicate-rolls.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import { foldTypeSchema } from "../services/helpers/fold-type";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { RollEntrySource, RollStatus } from "@prisma/client";
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
  /** Mükerrer tuzağı 409 döndükten sonra operatörün açık onayı ("evet, ayrı bir
   *  top"). Yalnız bu uçta anlamlı — dahili çağrılar tuzağa hiç girmez. */
  confirmDuplicate: z.boolean().optional(),
  /** Operatörün "Kaydet"e BASTIĞI an (ISO-8601). Mükerrer tuzağının 90 sn'lik
   *  penceresi bununla ölçülür — sunucu `createdAt`'i offline flush'ta girişin
   *  anı DEĞİLDİR. Sunucu doğrular (makul aralık) ve güvenilmezse yok sayar. */
  clientEnteredAt: z.coerce.date().optional(),
  /**
   * DIŞARIDAN ALINAN YARI MAMUL (2026-08-17, madde 9). Kumaş boyalı/işlenmiş
   * gelir ama bitmiş DEĞİLDİR — fabrikada kurşun + tambur görecek.
   *
   * İki şeyi birden değiştirir ve İKİSİ DE gerekli:
   *   · `entrySource = SEMI_FINISHED` → envanterde ham girişten ayrılır.
   *   · `forcedStatus = STOCK` → **statü sezgisi BYPASS edilir.** KK1 yolunda
   *     statü renkten çıkarılıyor (`colorId != null ? WAREHOUSE : STOCK`) ve
   *     yarı mamul tanımı gereği RENKLİ. Zorlanmasaydı mal doğrudan Bitmiş
   *     Depo'ya düşer, üretime hiç girmez ve operatör onu ham stokta arardı.
   */
  semiFinished: z.boolean().optional(),
});
// ⚠️ Bu şema BİLEREK düz `z.object` (strict DEĞİL): bilinmeyen alan sessizce
// atılır. `feature-flag.routes.ts`'te strict doğru karardı (panel ↔ backend, tek
// sürüm), ama BURASI istemci ucudur — sahada eski APK'lar var ve strict'e
// çevirmek yeni bir alan eklendiğinde ters yönü (yeni APK ↔ eski backend) 400'e
// düşürür, yani ham giriş durur. Bu asimetri bilinçlidir.

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
  // KAT — yalnız BİÇİM normalleştirilir; geçerlilik serviste katalogla ölçülür
  // (`resolveFoldTypeForWrite`). Alan gönderilmezse kata DOKUNULMAZ.
  foldType:     foldTypeSchema,
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
    // .max(12) — her kalem KENDİ `roll.aggregate`'ini paralel koşar, yani bu sayı
    // doğrudan eşzamanlı havuz checkout'u demek (havuz tavanı 30). Gerçek genişlik
    // 8: tek çağıran Electron envanter özeti ve `RollsPage.tsx` TABS'ın 9
    // kaleminden KANBAN'ı çıkarıp gönderiyor (`KARTELA_SENT` sanal anahtar, uca
    // hiç gelmiyor). Eski 50 cap'i meşru kullanımın 6,25 katıydı ve bu uç
    // `requireAnyPermission("roll:read", ...MOBILE_ROLL_READ)` ile korunuyor —
    // yani 9 mobil saha izninden herhangi biri fan-out genişliğini kontrol
    // ediyordu. 12 = 8 + pay. (Aynı gerekçe: createShipment sackIds .max(500).)
    .max(12),
});

// Süpervizör "İstasyondan Kurtar" — IN_PRODUCTION takılı topu depoya alır. Zorunlu sebep (audit).
const rescueSchema = z.object({
  reason: z.string().trim().min(3, "İşlem nedeni en az 3 karakter").max(500),
});

// G4 (2026-08-14, ticaret) — SAYIM metraj düzeltmesi: yalnız currentQty değişir
// (initialQty tarihsel giriş kaydı — relabelSchema'nın metraj dalıyla karıştırma:
// o, BÜTÜN topta ölçüm düzeltmesidir ve initialQty'yi de yazar). Sebep ZORUNLU.
const qtyAdjustSchema = z.object({
  newQty: z.number().positive("Yeni metraj pozitif olmalı").max(999_999, "Metraj çok büyük"),
  reason: z.string().trim().min(3, "İşlem nedeni (en az 3 karakter) zorunludur").max(500),
});

// İptali geri al. Sebep OPSİYONEL (iptalin kendisinden farklı, bilinçli): geri alma
// zaten düzeltici bir işlemdir ve önündeki tek engel kapsam guard'ıdır — sürtünme
// eklemek operatörü yine "yeniden giriş" doğaçlamasına iter, ki bu özelliğin tam
// olarak önlemek için var olduğu şeydir.
const restoreCancelSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

/**
 * "Mal vardı, fire" gövdesi. Sebep OPSİYONEL (iptalle aynı kural, 2026-08-06:
 * eldivenli operatörü rastgele kategori seçmeye itmek, cevapsızlıktan kötüdür).
 * `reasonCode` verilirse fire kataloğunda (`RollVarianceKind.SCRAP`) doğrulanır.
 */
const scrapRollSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  reasonCode: z.string().trim().max(64).optional(),
  /** İstasyonda/iş emrinde aktif top için bilinçli onay (iptaldeki ile aynı eksen). */
  confirmActive: z.boolean().optional(),
});

// Saha #4: top etiketi değiştir (renk/özellik/en/kalite). Tümü opsiyonel; renk
// null=renksiz. propertyIds verilirse TAM liste (replace).
const relabelSchema = z.object({
  colorId:      z.string().uuid("Geçersiz renk ID").optional().nullable(),
  propertyIds:  z.array(z.string().uuid("Geçersiz özellik ID")).optional(),
  width:        z.number().positive("En pozitif olmalı").max(999_999_999).optional().nullable(),
  qualityGrade: z.string().trim().max(50).optional(),
  // KAT düzeltmesi (2026-08-13) — kesim yolunda istemci alanı düşürdüğü için katsız
  // doğmuş topların tek düzeltme kapısı. Yalnız BİÇİM burada; katalog doğrulaması
  // serviste (`resolveFoldTypeForWrite`). Gönderilmezse kata dokunulmaz.
  foldType:     foldTypeSchema,
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
// Export: Zod katmanı bekçisi için (bkz. kursun-qc.controller.completeQc2Schema).
export const kursunFinishSchema = z.object({
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
  // Mod + değer sözleşmesi — `kursun-qc.completeQc2` ile BİREBİR aynı alan.
  // İki tablet yolu aynı istasyonun özelliklerini farklı kurallarla uygularsa
  // aynı top iki yoldan iki farklı özellik kümesi kazanır.
  properties: z
    .array(
      z.object({
        propertyId: z.string().uuid(),
        valueCode: z.string().trim().max(32).nullish(),
      }),
    )
    .max(50)
    .nullish(),
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
    this.listEntryUsers = this.listEntryUsers.bind(this);
    this.listEntryStations = this.listEntryStations.bind(this);
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
    this.scrap = this.scrap.bind(this);
    this.restoreCancelled = this.restoreCancelled.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
    this.createOpenFabric = this.createOpenFabric.bind(this);
    this.kursunFinish = this.kursunFinish.bind(this);
    this.relabel = this.relabel.bind(this);
    this.prepareForSale = this.prepareForSale.bind(this);
    this.manualAttributes = this.manualAttributes.bind(this);
    this.rescuePreview = this.rescuePreview.bind(this);
    this.rescueStuck = this.rescueStuck.bind(this);
    this.listDuplicateRolls = this.listDuplicateRolls.bind(this);
    // ⚠️ bind UNUTULMAZ — print-event vakası (2026-08): bind'sız handler her
    // istekte `this.service` undefined ile 500 verir ve servis-katmanı bekçileri
    // bunu göremez.
    this.adjustQty = this.adjustQty.bind(this);
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
      const { confirmDuplicate, semiFinished, ...body } = initialEntrySchema.parse(req.body);
      // Yarı mamul kabulü AYRI bir yetenek yetkisi ister (2026-08-17 kullanıcı
      // kararı): yetkisi olmayan operatörde ekran bugünkü gibi kalır ve renk
      // seçemez. Kapı BURADA — istemcinin kutuyu gizlemesine güvenilmez.
      if (semiFinished) {
        const perms = req.user?.permissions ?? [];
        // Web tarafındaki `roll:write` de kabul edilir: Electron "Manuel Top
        // Ekle" yolu aynı ucu kullanıyor ve büro personeline ikinci bir mobil
        // yetki atatmak gereksiz bir adım olurdu.
        const allowed =
          matchesPermission(perms, "mobile:kk1-yari-mamul") ||
          matchesPermission(perms, "roll:write");
        if (!allowed) {
          throw AppError.forbidden(
            "Yarı mamul kabulü için 'mobile:kk1-yari-mamul' yetkisi gerekli.",
          );
        }
        if (!body.colorId) {
          throw AppError.badRequest(
            "Yarı mamul girişinde renk zorunludur — mal boyalı/işlenmiş geliyor.",
          );
        }
      }
      // KK1 makine atfı: aktif çalışma oturumu → GEÇİŞ fallback'i cihazın statik ataması.
      const stamp = await getStampContext(req, { enforceForMobile: true });
      // entrySource ayrımı: Electron ASLA x-device-id göndermez (bkz. Electron
      // apiClient.ts) → req.device yalnız eşleşmiş mobil cihazda dolu olur.
      const result = await this.service.createInitialEntry(
        body,
        req.user?.userId,
        stamp?.machineId ?? req.device?.machineId ?? null,
        Boolean(req.device),
        // Mükerrer tuzağı YALNIZ bu HTTP yolunda çalışır — dahili çağıranlar
        // (tambur-manual) `opts` vermediği için etkilenmez (F221 deseni).
        {
          duplicateGuard: { confirmed: confirmDuplicate === true },
          // KALİTE ZORUNLU (D6) — mükerrer tuzağıyla AYNI F221 gerekçesi:
          // kural yalnız bu HTTP yolunda (KK1 tableti + Electron "Manuel Top
          // Ekle") koşar; dahili çağıranlar (tambur-manual, mal kabul, depo
          // transferi) `opts.gradeRequired` göndermediği için etkilenmez.
          gradeRequired: true,
          // GİRİŞ İSTASYONU — oturumdan. Bu yolda ADIM YOKTUR (top henüz hiçbir
          // iş emrine bağlı değil), dolayısıyla tek doğru kaynak oturumdur.
          //
          // ⚠️ `req.device.machineId` → `Machine.stationId` fallback'i BİLEREK
          // YOK: makine sonradan taşınırsa geçmiş toplar başka istasyonda
          // girilmiş görünür — kolonun var olma sebebi tam da bu. Oturum yoksa
          // damga NULL kalır ve bu dürüst cevaptır.
          entryStationId: stamp?.stationId ?? null,
          // Yarı mamulde İKİSİ BİRDEN — gerekçe şema notunda.
          ...(semiFinished
            ? {
                forcedEntrySource: RollEntrySource.SEMI_FINISHED,
                forcedStatus: RollStatus.STOCK,
              }
            : {}),
        },
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

  /** GET /api/rolls/entry-users — "Ekleyen" filtre seçenekleri (top girmiş kullanıcılar). */
  async listEntryUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await this.service.listEntryUsers());
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/rolls/entry-stations — "Giriş İstasyonu" filtre seçenekleri. */
  async listEntryStations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await this.service.listEntryStations());
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rolls/duplicates — hayalet top (mükerrer ham giriş) taraması.
   * SALT OKUNUR; temizlik `DELETE /api/rolls/:id` ile top top yapılır (o ucun
   * etiket/çuval/sevk guard'ları olduğu gibi kalsın diye toplu iptal ucu YOK).
   */
  async listDuplicateRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const num = (v: unknown): number | undefined => {
        const n = typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const data = await DuplicateRollsService.scan({
        days: num(req.query.days),
        windowSec: num(req.query.window),
      });
      res.status(200).json({ success: true, data });
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
      // ⚠️ `confirmLabelPrinted` ARTIK BİR KAPI DEĞİL (2026-08-25 kullanıcı kararı):
      // ölü etiket guard'ı kaldırıldı. Parametre okunmaya devam ediyor çünkü
      // sahadaki APK'lar gönderiyor ve sözleşmeyi kırmanın karşılığı yok; servis
      // onu görmezden gelir. Gerekçe: inventory.service.softDelete içindeki not.
      const confirmLabelPrinted = req.query.confirmLabelPrinted === "true";
      const reason = typeof req.query.reason === "string" ? req.query.reason : undefined;
      // Sebebin KATALOG KODU (2026-08-21) — opsiyonel, aynı sebeple query'de. Verilmezse
      // servis metinden türetir; verilirse katalogda doğrulanır (bilinmeyen → 400).
      const reasonCode =
        typeof req.query.reasonCode === "string" && req.query.reasonCode.trim()
          ? req.query.reasonCode.trim().slice(0, 64)
          : undefined;
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId,
        { confirmActive, confirmLabelPrinted, reason, reasonCode }
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/scrap — "MAL VARDI, FİRE".
   *
   * `softDelete`in kardeşi ve BİLİNÇLİ OLARAK AYRI bir uç: iptal ("bu kayıt hiç
   * olmamalıydı") ile fire ("mal vardı, artık yok") aynı tuşun arkasına konursa
   * fabrikanın fire oranı veri düzeltmeleriyle kirlenir. Ölçüm (2026-08-25, canlı
   * kopya): 230 iptale karşı 1 fire ve sebep yazılmış 24 iptalin hepsi kayıt hatası.
   *
   * Sebep OPSİYONEL; `reasonCode` verilirse fire kataloğunda doğrulanır.
   * Gövdeli POST — DELETE'in query kısıtı burada yok.
   */
  async scrap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = scrapRollSchema.parse(req.body ?? {});
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId,
        {
          mode: "SCRAP",
          confirmActive: body.confirmActive ?? false,
          reason: body.reason,
          reasonCode: body.reasonCode,
        },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/rolls/:id/restore-cancel
   * İptali geri al — `CANCELLED` → iptalden önceki raf. Kapsam dar (hareketsiz,
   * partisiz, çuvalsız top); engel varsa 409 + somut Türkçe sebep.
   */
  async restoreCancelled(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = restoreCancelSchema.parse(req.body ?? {});
      const result = await this.service.restoreCancelledRoll(
        req.params.id as string,
        req.user?.userId,
        { reason: body.reason }
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
          foldType: body.foldType,
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
          foldType: body.foldType,
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
   * PATCH /api/rolls/:id/qty — G4 sayım metraj düzeltmesi (roll:manual-adjust).
   * Yalnız FREE_STOCK + çuvalsız/sevksiz top; RollVariance + audit + labelDirty izi.
   */
  async adjustQty(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = qtyAdjustSchema.parse(req.body);
      const result = await this.service.adjustRollQty(
        req.params.id as string,
        { newQty: body.newQty, reason: body.reason },
        req.user?.userId,
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
