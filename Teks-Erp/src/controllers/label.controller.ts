// =============================================================================
// TeksERP - Label Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind } from "@prisma/client";
import { labelKindSchema } from "../config/label-kind.schema";
import { LabelService } from "../services/label.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import "../types/express-augment";

/**
 * TOPLU etiket hedefi (2026-08-09) — `bulkLabelsSchema` ile AYNI tavan (2000).
 * İstemci aynı seçimi önce buraya sonra baskıya gönderir; tavanlar ayrışırsa
 * yazılan ama basılamayan (ya da tersi) bir küme doğar.
 */
const seedBulkSchema = z.object({
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top").max(2000),
  orderLineId: z.string().uuid("Geçersiz sipariş kalemi ID").nullish(),
  customerId: z.string().uuid("Geçersiz müşteri ID").nullish(),
  stock: z.boolean().optional(),
});

/**
 * Ad önizlemesi (Tambur, top doğmadan). `orderLineId` VEYA `customerId` — ikisi
 * de yoksa stok baskısıdır ve zincir hiç koşmaz (bizdeki ad döner).
 */
const namePreviewSchema = z.object({
  // Kaynak top (Tambur kesim akışı) — ürün/renk ondan çözülür.
  rollId: z.string().uuid("Geçersiz top ID").nullish(),
  itemId: z.string().uuid("Geçersiz ürün ID").nullish(),
  colorId: z.string().uuid("Geçersiz renk ID").nullish(),
  orderLineId: z.string().uuid("Geçersiz sipariş kalemi ID").nullish(),
  customerId: z.string().uuid("Geçersiz müşteri ID").nullish(),
});

const bulkLabelsSchema = z.object({
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top").max(2000),
  copies: z.number().int().min(1).max(5).optional(),
  // Cihaz Kaydı yönlendirmesi — dil/profil/şablon bu cihazdan çözülür
  // (tekli /native'in ?peripheralId= analoğu; iş istasyonu global dile dokunmadan
  // kendi yazıcısının dilinde basar).
  peripheralId: z.string().uuid("Geçersiz cihaz ID").optional(),
  // "b64" → binary-safe base64 JSON yanıt (raster cihaz desteği). Yoksa ham text (eski istemci).
  encoding: z.enum(["b64"]).optional(),
  // TÜM topları BU müşteri bağlamıyla bas (çuval müşterisi değişti → yeni müşterinin
  // etiket şablonu/alias'ı). Verilmezse her top kendi lastLabelSnapshot'ıyla basılır
  // (mevcut davranış — eklemeli parametre, geriye uyumlu).
  customerId: z.string().uuid("Geçersiz müşteri ID").optional(),
});

const updateNamesSchema = z.object({
  customerItemName:  z.string().max(200).nullable().optional(),
  customerColorName: z.string().max(200).nullable().optional(),
});

const previewSchema = z.object({
  // NEDEN paylaşılan şema (2026-07-31 denetimi): burada eskiden elle yazılmış
  // ["ROLL_RAW", ...] listesi vardı ve aynı liste 3 yerde daha tekrarlanıyordu →
  // Prisma'ya yeni LabelKind eklenince biri unutuluyor, uç yeni türü SESSİZCE
  // reddediyordu. Tek kaynak: config/label-kind.schema.ts (TDZ kuralı da orada
  // açıklandı — deref yaprak modülde yapılır, burada değil).
  kind: labelKindSchema,
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    order: z.number().int().min(1),
    isVisible: z.boolean(),
    isBold: z.boolean().optional(),
    fontSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
  })),
});

// Test Et: örnek etiketi verilen yazıcıya gönder (Faz-2 doğrulama).
const testNativeSchema = z.object({
  /** Örnek baskıda medyası kullanılacak yazıcı cihazı (boş → sistem varsayılan medyası). */
  peripheralId: z.string().uuid().optional(),
  printerIp: z.string().trim().min(3, "Yazıcı IP gerekli").max(64),
  port: z.number().int().min(1).max(65535).optional(),
  language: z.enum(["RASTER_HTML", "PPLA", "PPLB", "ZPL"]).optional(),
});

// F180: recordPrintEvent + seedRollLabelSnapshot gövdesi (eskiden ham `as` cast; malformed
// UUID Prisma'da 500'e düşerdi). nullish → mobil {customerId:null} yükleri geçerli kalır.
const printEventSchema = z.object({
  orderLineId: z.string().uuid("Geçersiz sipariş kalemi ID").nullish(),
  customerId: z.string().uuid("Geçersiz müşteri ID").nullish(),
  stock: z.boolean().optional(),
  peripheralId: z.string().uuid("Geçersiz cihaz ID").nullish(),
});

/**
 * Fiziksel medya çözümü girdisi: explicit ?peripheralId= (cihaz medyası) veya makine
 * bağlamı. machineId önceliği: AKTİF ÇALIŞMA OTURUMU (mobil baskı oturumun makinesinin
 * yazıcısına gider) → GEÇİŞ fallback'i cihazın statik ataması (req.device.machineId,
 * Faz 6'da sökülür) → opsiyonel ?machineId= query (Electron). Yoksa sistem-varsayılan medya.
 */
async function resolveFormatOpts(req: Request): Promise<{
  machineId?: string;
  peripheralId?: string;
  deviceId?: string;
  templateId?: string;
}> {
  const stamp = await getStampContext(req);
  const machineId =
    stamp?.machineId ??
    req.device?.machineId ??
    (typeof req.query.machineId === "string" ? req.query.machineId : undefined);
  return {
    machineId: machineId ?? undefined,
    // Cihaz kaydı yönlendirmesi: explicit ?peripheralId= veya tablete-bağlı yazıcı
    // için req.device.id (device.middleware). ?templateId= explicit şablon override.
    peripheralId: typeof req.query.peripheralId === "string" ? req.query.peripheralId : undefined,
    deviceId: req.device?.id ?? undefined,
    templateId: typeof req.query.templateId === "string" ? req.query.templateId : undefined,
  };
}

export class LabelController {
  private service = new LabelService();

  getRollLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getRollLabel(req.params.id as string, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Roll etiketinin tam HTML'i. Mobil expo-print bunu basar, Electron iframe
   * srcDoc ile preview gösterir. Kind otomatik (renksiz STOCK SUPPLIER → RAW,
   * aksi FINISHED); `?kind=ROLL_RAW|ROLL_FINISHED` ile override.
   *
   * Response: text/html (raw), JSON sarmalama yok — iframe ve Print için direkt.
   */
  /**
   * "Bu hedefe basarsam etikette hangi ad çıkar?" — Tambur kesim ekranı, top
   * DOĞMADAN önce sorar. Salt-okunur; hiçbir şey yazmaz.
   */
  previewCustomerNames = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = namePreviewSchema.parse(req.query);
      res.status(200).json(await this.service.previewCustomerNames(q));
    } catch (e) { next(e); }
  };

  /**
   * Şablon düzenleme önizlemesi için HTML. Body: { kind, fields[] }. Henüz
   * kaydedilmemiş değişiklikleri preview için backend render eder; Electron
   * iframe srcDoc ile gösterir. text/html döner.
   */
  getPreviewHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewSchema.parse(req.body);
      const result = await this.service.getPreviewHtml(body);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /** Editör native (PPLA/ZPL) metin-zone önizlemesi — sıralı satırlar (JSON). */
  getPreviewNativeText = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewSchema.parse(req.body);
      const result = await this.service.getPreviewNativeText(body);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getRollLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const result = await this.service.getRollLabelHtml(
        req.params.id as string,
        kindOverride,
        {
          orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
          customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
          stock: req.query.stock === "1" || req.query.stock === "true",
          // Saha #6: ?copies= override — verilmezse label.copies ayarı (default 2).
          copies:
            typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
              ? parseInt(req.query.copies, 10)
              : undefined,
          ...(await resolveFormatOpts(req)),
        },
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Rolün Argox PPLA native komut string'i (text/plain). `/html`'in native analoğu.
   * Faz-1: yalnız ÜRETİLİR (gönderim simüle). Format profili `/html` ile aynı resolver.
   */
  getRollLabelPpla = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const result = await this.service.getRollLabelPpla(req.params.id as string, kindOverride, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(result.data.ppla);
    } catch (e) { next(e); }
  };

  /**
   * Rolün etiketini SEÇİLİ dilde döner — dil cihaz kaydından (cihazsız → RASTER_HTML)
   * (default PPLA) veya istasyon yazıcı modelinin dili. RASTER_HTML → text/html;
   * PPLA/PPLB/ZPL → text/plain native komut. Dil X-Label-Language header'ında.
   */
  getRollLabelNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const wantB64 = req.query.encoding === "b64";
      const result = await this.service.getRollLabelNative(req.params.id as string, kindOverride, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        rasterCapable: wantB64,
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      // Tanılama izi (fail-open — client'lar yokluğunda da çalışır; cors
      // exposedHeaders'ta OLMALI, aksi halde Electron'da undefined görünür).
      if (result.data.meta.templateId) res.setHeader("X-Label-Template-Id", result.data.meta.templateId);
      if (result.data.meta.variantMatch) res.setHeader("X-Label-Variant-Match", result.data.meta.variantMatch);
      if (wantB64) {
        // Yeni istemci (Electron): binary-safe base64 JSON — komut da raster de TEK yoldan.
        res.status(200).json({
          success: true,
          data: {
            encoding: "base64",
            content: result.data.contentB64,
            language: result.data.language,
            contentType: result.data.contentType,
            kind: result.data.kind,
            meta: result.data.meta,
          },
        });
      } else {
        // Eski istemci (mobil): ham text (rasterCapable=false → komut üretildi, >0x7F yok).
        res.setHeader("Content-Type", result.data.contentType);
        res.status(200).send(result.data.content);
      }
    } catch (e) { next(e); }
  };

  /** WYSIWYG önizleme — gerçek topu aktif dilde ({ mode, language, content, kind }). */
  getRollPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const kindOverride =
        kindParam === LabelKind.ROLL_RAW || kindParam === LabelKind.ROLL_FINISHED
          ? (kindParam as LabelKind)
          : undefined;
      const result = await this.service.getRollPreview(req.params.id as string, kindOverride, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        ...(await resolveFormatOpts(req)),
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * FAZ-2 PRODUCTION: rolün etiketini istasyon yazıcısına native gönder
   * (label.nativeSendEnabled açıkken gerçek, kapalıyken simüle). JSON sonuç döner.
   */
  printRollNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.printRollNative(req.params.id as string, req.user?.userId, {
        orderLineId: typeof req.query.orderLineId === "string" ? req.query.orderLineId : undefined,
        customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
        stock: req.query.stock === "1" || req.query.stock === "true",
        ...(await resolveFormatOpts(req)),
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Test Et: seçili yazıcının medyasında örnek etiket HTML'i (boyut/pay önizleme). */
  getSampleLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const peripheralId =
        (req.params.id as string | undefined) ??
        (typeof req.query.peripheralId === "string" ? req.query.peripheralId : undefined);
      const result = await this.service.getSampleLabelHtml(peripheralId);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /** Test Et: örnek etiketi seçili dilde verilen yazıcı IP'sine gönder (gerçek/simüle). */
  testNativeSend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = testNativeSchema.parse(req.body);
      const result = await this.service.testNativeSend(body);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // Saha #7: toplu etiket HTML — { rollIds: [...], copies? } → tek birleşik belge.
  getBulkRollLabelsHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkLabelsSchema.parse(req.body);
      const result = await this.service.getBulkRollLabelsHtml(body.rollIds, {
        copies: body.copies,
        peripheralId: body.peripheralId, // F183: cihaz-yönlendirme (native handler paritesi)
        deviceId: req.device?.id ?? undefined,
        customerId: body.customerId ?? null,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /** N farklı topun native (PPLA) komutlarını TEK akışta — diyalogsuz toplu seri/BT baskı. */
  getBulkRollLabelsNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkLabelsSchema.parse(req.body);
      const wantB64 = body.encoding === "b64";
      const result = await this.service.getBulkRollLabelsNative(body.rollIds, {
        copies: body.copies,
        // Tekli /native ile aynı yönlendirme: explicit cihaz > tablete-bağlı yazıcı.
        peripheralId: body.peripheralId,
        deviceId: req.device?.id ?? undefined,
        rasterCapable: wantB64,
        customerId: body.customerId ?? null,
      });
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Count", String(result.data.count));
      if (wantB64) {
        res.status(200).json({
          success: true,
          data: {
            encoding: "base64",
            content: result.data.contentB64,
            language: result.data.language,
            contentType: result.data.contentType,
            count: result.data.count,
          },
        });
      } else {
        res.setHeader("Content-Type", result.data.contentType);
        res.status(200).send(result.data.content);
      }
    } catch (e) { next(e); }
  };

  getSwatchLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabel(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Kartela etiketinin tam HTML'i (text/html). `/rolls/:id/html`'in kartela analoğu.
   * Kartela hep 100×60 yatay düzende basılır; format `?peripheralId=`/`?machineId=` veya
   * sistem default ile çözülür.
   */
  getSwatchLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabelHtml(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Kartela etiketi SEÇİLİ yazıcı dilinde (RASTER_HTML → text/html; PPLA/PPLB/ZPL →
   * text/plain native komut). `/rolls/:id/native`'in kartela analoğu.
   */
  getSwatchLabelNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSwatchLabelNative(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("Content-Type", result.data.contentType);
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.content);
    } catch (e) { next(e); }
  };

  // ── ÇUVAL ETİKETİ — barkod/QR = Sack.sackNo (tek kod) ────────────────────────

  /** Çuval etiketi payload'ı (JSON) — önizleme/tanılama. */
  getSackLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSackLabel(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Çuval etiketinin tam HTML'i — `/rolls/:id/html`'in çuval analoğu. */
  getSackLabelHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSackLabelHtml(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Çuval etiketi SEÇİLİ yazıcı dilinde. `?encoding=b64` → binary-safe base64 JSON
   * (raster dahil); yoksa ham text komut (roll `/native` ile aynı sözleşme).
   */
  getSackLabelNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wantB64 = req.query.encoding === "b64";
      const result = await this.service.getSackLabelNative(req.params.id as string, {
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        ...(wantB64 ? { encoding: "b64" as const } : {}),
        ...(await resolveFormatOpts(req)),
      });
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      if (wantB64) {
        res.status(200).json({
          success: true,
          data: {
            encoding: "base64",
            content: result.data.contentB64,
            language: result.data.language,
            contentType: result.data.contentType,
            kind: result.data.kind,
            count: result.data.count,
          },
        });
      } else {
        res.setHeader("Content-Type", result.data.contentType);
        res.status(200).send(result.data.content);
      }
    } catch (e) { next(e); }
  };

  /** Çuval etiketi baskı izi (LABEL_PRINT_EVENT) — yalnız GERÇEK baskıda çağrılır. */
  recordSackPrintEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.recordSackPrintEvent(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  updateOrderLineCustomerNames = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateNamesSchema.parse(req.body);
      const result = await this.service.updateOrderLineCustomerNames(
        req.params.id as string,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  recordPrintEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = printEventSchema.parse(req.body ?? {});
      const result = await this.service.recordPrintEvent(
        req.params.id as string,
        req.user?.userId,
        {
          orderLineId: body.orderLineId ?? undefined,
          customerId: body.customerId ?? undefined,
          stock: body.stock === true,
          // Audit şablon izi için cihaz bağlamı (best-effort): explicit gövde
          // cihazı > tablete-bağlı yazıcı (x-device-id) > istasyon makinesi.
          peripheralId: typeof body.peripheralId === "string" ? body.peripheralId : undefined,
          deviceId: req.device?.id ?? undefined,
          machineId: req.device?.machineId ?? undefined,
        },
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * Etiket NİYETİNİ topa kalıcılaştırır (lastLabelSnapshot) — fiziksel baskıdan
   * VE LABEL_PRINTED audit'inden BAĞIMSIZ. Mobil LabelPrinter baskı-öncesi çağırır
   * (yazıcısız/iptal niyet kaybolmasın). `recordPrintEvent` ile aynı opts gövdesi.
   */
  seedRollLabelSnapshot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = printEventSchema.parse(req.body ?? {});
      const result = await this.service.seedRollLabelSnapshot(
        req.params.id as string,
        req.user?.userId,
        {
          orderLineId: body.orderLineId ?? undefined,
          customerId: body.customerId ?? undefined,
          stock: body.stock === true,
        },
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * POST /api/labels/rolls/seed-snapshot-bulk — N topun etiket hedefini TOPLU yaz.
   *
   * "Kuşağı değişen ürünlerin toplu etiket çıkarıp yenilenmesi" (saha isteği).
   * Akış: seç → "Kime?" sor → hepsine yaz (bu uç) → hepsini bas (`bulk-html`).
   *
   * ⚠️ Tavan `bulkLabelsSchema` ile AYNI olmalı — istemci aynı seçimi önce buraya,
   * sonra baskıya gönderiyor; tavanlar ayrışırsa yazılan ama basılamayan (ya da
   * tersi) bir küme doğar.
   */
  seedRollLabelSnapshotsBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = seedBulkSchema.parse(req.body ?? {});
      const result = await this.service.seedRollLabelSnapshotsBulk(
        body.rollIds,
        req.user?.userId,
        {
          orderLineId: body.orderLineId ?? undefined,
          customerId: body.customerId ?? undefined,
          stock: body.stock === true,
        },
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- Serbest (statik) etiket baskısı — rulo/kartela bağlamı olmadan ----

  /**
   * Serbest etiket seçicisi: aktif standalone şablonlar + basılabilir varyantlar.
   * `?customerId=<uuid>` → o müşteriye bağlı ∪ genel (bağsız) serbest etiketler.
   * Geçersiz/eksik customerId → filtresiz (tüm aktif standalone) — sessizce yok sayılır.
   */
  listStandaloneTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
      const parsed = raw ? z.string().uuid().safeParse(raw) : undefined;
      const customerId = parsed?.success ? parsed.data : undefined;
      res.status(200).json(await this.service.listStandaloneTemplates(customerId));
    } catch (e) { next(e); }
  };

  /** Serbest etiketin tam HTML'i (text/html). `/rolls/:id/html` analoğu. */
  getStandaloneTemplateHtml = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { machineId, peripheralId, deviceId } = await resolveFormatOpts(req);
      const result = await this.service.renderStandaloneTemplateHtml({
        templateId: req.params.id as string,
        variantId: typeof req.query.variantId === "string" ? req.query.variantId : undefined,
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        machineId,
        peripheralId,
        deviceId,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Label-Kind", result.data.kind);
      res.status(200).send(result.data.html);
    } catch (e) { next(e); }
  };

  /**
   * Serbest etiket SEÇİLİ yazıcı dilinde. `/rolls/:id/native` analoğu:
   * `?encoding=b64` → binary-safe base64 JSON zarfı; aksi → ham native/HTML.
   */
  getStandaloneTemplateNative = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wantB64 = req.query.encoding === "b64";
      const { machineId, peripheralId, deviceId } = await resolveFormatOpts(req);
      const result = await this.service.renderStandaloneTemplateNative({
        templateId: req.params.id as string,
        variantId: typeof req.query.variantId === "string" ? req.query.variantId : undefined,
        copies:
          typeof req.query.copies === "string" && /^\d+$/.test(req.query.copies)
            ? parseInt(req.query.copies, 10)
            : undefined,
        rasterCapable: wantB64,
        machineId,
        peripheralId,
        deviceId,
      });
      res.setHeader("X-Label-Language", result.data.language);
      res.setHeader("X-Label-Kind", result.data.kind);
      if (wantB64) {
        res.status(200).json({
          success: true,
          data: {
            encoding: "base64",
            content: result.data.contentB64,
            language: result.data.language,
            contentType: result.data.contentType,
            count: result.data.count,
          },
        });
      } else {
        res.setHeader("Content-Type", result.data.contentType);
        res.status(200).send(result.data.content);
      }
    } catch (e) { next(e); }
  };
}
