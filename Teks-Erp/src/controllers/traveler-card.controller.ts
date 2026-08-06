// =============================================================================
// TeksERP - TravelerCard Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TravelerCardService } from "../services/traveler-card.service";
import { normalizeTravelerCardConfig } from "../services/system-setting.service";
import "../types/express-augment";

/**
 * Refakat kartı önizlemesi — panelin düzenlediği taslak içerik ayarı.
 *
 * ⚠️ ANAHTARLAR BURADA TEK TEK SAYILMAZ ve bu bilinçlidir. Eski hâli her alanı
 * elle listeliyordu; `showBatches`/`batchFields`/`batchTotal`/`sections` o listeye
 * hiç eklenmedi (backend'e sonradan geldiler) ve düz `z.object` bilinmeyen
 * anahtarı SESSİZCE ATTIĞI için önizleme onları hiç görmedi: kullanıcı Partiler
 * bölümünün puntosunu değiştiriyor, sağdaki önizleme kılını kıpırdatmıyor, hata
 * da çıkmıyordu. (2026-08-06 saha bulgusu — "punto değişince önizlemede
 * göremiyorum".)
 *
 * Şekil ham bırakıldı; TEK SÜZGEÇ `normalizeTravelerCardConfig`tir — kaydetme
 * yolu (`setFeatureFlags`) ve şablon yolu (`traveler-template.routes`) da onu
 * kullanıyor. Böylece "önizlemede var, kayıtta yok" (ya da tersi) sınıfı bir
 * daha doğamaz: yeni alan eklenince güncellenecek tek yer normalize'dır.
 */
const travelerCardConfigSchema = z.record(z.string(), z.unknown());

// Önizleme, Şablon Stüdyosu'nun KAYDEDİLMEMİŞ taslağını da alabilir — böylece
// uzman modundaki ham HTML kaydedilmeden görülür. `html` burada sanitize
// EDİLMEZ; render yolundaki `renderRawTemplate` her durumda temizler (tek nokta).
// `export` — mekanik bekçi (`scripts/test_traveler_card_fields.ts` §10) bu şemayı
// ÇALIŞMA ZAMANINDA çağırıp panelin gönderdiği hiçbir anahtarın düşmediğini
// doğrular. Şemanın kopyasını teste yazmak, tam da yakalanmak istenen drift'i
// görünmez yapardı.
export const sampleHtmlSchema = z.object({
  config: travelerCardConfigSchema.optional(),
  template: z
    .object({
      mode: z.enum(["BUILTIN", "SECTIONS", "RAW_HTML"]),
      html: z.string().max(200_000).nullable().optional(),
      name: z.string().max(80).optional(),
    })
    .optional(),
});

const reprintSchema = z.object({
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı").max(500),
});

const voidSchema = z.object({
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı").max(500),
});

const scanSchema = z.object({
  barcode:   z.string().trim().min(1),
  stationId: z.string().uuid(),
  scanType:  z.enum(["ARRIVAL", "DEPARTURE", "INFO"]),
  notes:     z.string().max(500).optional(),
  deviceId:  z.string().max(128).optional(),
});

export class TravelerCardController {
  private service: TravelerCardService;

  constructor() {
    this.service = new TravelerCardService();
    this.print        = this.print.bind(this);
    this.reprint      = this.reprint.bind(this);
    this.voidCard     = this.voidCard.bind(this);
    this.scan         = this.scan.bind(this);
    this.findByBarcode = this.findByBarcode.bind(this);
    this.getHistory   = this.getHistory.bind(this);
    this.getCardHtml  = this.getCardHtml.bind(this);
    // ⚠️ 2026-08-06: BU SATIR UNUTULMUŞTU ve uç eklendiğinden beri (2026-08-05)
    // HER ÇAĞRIDA 500 veriyordu — route `controller.recordPrintEvent`'i ÇIPLAK
    // referans olarak geçiyor, `this` undefined kalıyor, `this.service` patlıyor.
    // Sessiz kalmasının sebebi: baskı istemci tarafında (kâğıt çıkıyor), bildirim
    // best-effort yutuluyor ve bekçi testleri servisi DOĞRUDAN çağırıp controller'ı
    // hiç geçmiyor. Sonuç: `contentDirty` hiç temizlenmedi, otomatik revizyonun
    // `version++`'ı hiç yazılmadı. Yeni handler eklerken bu listeye de ekle —
    // mekanik bekçi: `scripts/test_controller_binds.ts`.
    this.recordPrintEvent = this.recordPrintEvent.bind(this);
    this.getSampleHtml = this.getSampleHtml.bind(this);
    this.list         = this.list.bind(this);
  }

  /** GET /api/traveler-cards */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.list(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/work-orders/:id/traveler-cards */
  async print(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.print(req.params.id as string, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/work-orders/:id/traveler-cards/reprint */
  async reprint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reprintSchema.parse(req.body);
      const result = await this.service.reprint(
        req.params.id as string,
        body.reason,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/:id/void */
  async voidCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = voidSchema.parse(req.body);
      const result = await this.service.voidCard(
        req.params.id as string,
        body.reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/scan */
  async scan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scan(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/traveler-cards/by-barcode/:barcode */
  async findByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findByBarcode(req.params.barcode as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/work-orders/:id/traveler-cards/history */
  async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getHistory(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/traveler-cards/:id/html — tek-kaynak refakat kartı HTML'i (text/html)
   * `?pageSize=A4|A5` TEK SEFERLİK ezmedir: kalıcı ayara/snapshot'a YAZILMAZ.
   * Geçersiz değer sessizce yok sayılır (kartın kendi boyutuyla basılır) — baskı
   * yolunu bir yazım hatası yüzünden 400'e düşürmek sahada kâğıtsız bırakır.
   */
  async getCardHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = req.query.pageSize;
      const pageSize = raw === "A4" || raw === "A5" ? raw : undefined;
      const html = await this.service.getCardHtml(req.params.id as string, { pageSize });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/:id/print-event — baskı gerçekleşti, bayat işaretini temizle */
  async recordPrintEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.recordPrintEvent(
        req.params.id as string,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/sample-html — Belge Şablonu önizlemesi (örnek veri + taslak config) */
  async getSampleHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { config, template } = sampleHtmlSchema.parse(req.body ?? {});
      // normalize → eksik/kısmi alanlar (margins/specFields) güvenli default'a çözülür.
      const html = await this.service.renderSampleHtml(
        normalizeTravelerCardConfig((config ?? {}) as Record<string, unknown>),
        template
          ? { id: null, name: template.name ?? "Taslak", mode: template.mode, html: template.html ?? null }
          : undefined,
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }
}
