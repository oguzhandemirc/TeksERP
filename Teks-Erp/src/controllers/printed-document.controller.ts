// =============================================================================
// TeksERP - Printed Document Controller (resmi belge defteri)
// =============================================================================
// Versiyonlu irsaliye/çeki belgeleri: güncel belge + versiyon listesi + tek
// versiyon + gerekçeli revizyon (reissue). docType path paramı PrintedDocType
// enum'una zod ile doğrulanır; izinler route katmanında docType'a göre eşlenir.

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../services/printed-document.service";
import "../types/express-augment";

const docTypeSchema = z.nativeEnum(PrintedDocType);
const sourceIdSchema = z.string().uuid("Geçersiz kaynak ID");
const versionSchema = z.coerce.number().int().positive("Geçersiz versiyon");

const reissueSchema = z.object({
  reason: z.string().trim().min(3, "Revizyon gerekçesi en az 3 karakter").max(500),
});

/** Görünüm ayarı — değerler render'da resolveDocStyle ile ayrıca clamp'lenir. */
const docStyleSchema = z.object({
  pageSize: z.enum(["A4", "A5"]).optional(),
  margins: z
    .object({
      top: z.number().optional(),
      right: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional(),
    })
    .optional(),
  fontScale: z.number().optional(),
  fontWeight: z.enum(["light", "normal", "bold"]).optional(),
  tableDensity: z.enum(["compact", "normal", "relaxed"]).optional(),
  tableStyle: z.enum(["grid", "zebra", "plain"]).optional(),
});

/** Belge Şablonu önizlemesi — admin'in düzenlediği taslak içerik ayarı (ResolvedDocConfig). */
// export: `scripts/test_blank_grid.ts` §5 bu şemayı GERÇEK parse ile sınar — Zod
// tanımadığı anahtarı hata vermeden ATAR, yani yeni bir DocumentConfig alanı
// buraya eklenmezse ayar canlı önizlemede SESSİZCE kaybolur.
export const docConfigSchema = z
  .object({
    titleOverride: z.string().optional(),
    showLetterhead: z.boolean().optional(),
    sections: z.record(z.string(), z.boolean()).optional(),
    signatureLabels: z.array(z.string()).optional(),
    showSignatures: z.boolean().optional(),
    footerNote: z.string().optional(),
    style: docStyleSchema.optional(),
    showLogo: z.boolean().optional(),
    logoPosition: z.enum(["left", "right"]).optional(),
    columns: z
      .record(
        z.string(),
        z.object({
          hidden: z.array(z.string()).optional(),
          order: z.array(z.string()).optional(),
          // OPT-IN kolon allowlist'i (çuval notu gibi iç veri). Eksikti: panelde
          // açılan opt-in kolon ÖNİZLEMEDE görünmüyordu — bkz. aşağıdaki uyarı.
          shown: z.array(z.string()).optional(),
          // KOLON BAŞLIĞI override'ı (2026-09-04) — aynı sessiz-ayrışma kapısı:
          // yazılmazsa fabrika başlığı düzenler, GERÇEK baskıda görür, canlı
          // önizlemede GÖREMEZ ("önizleme = baskı" sözleşmesi tam ayarı yapan
          // kişinin gözü önünde bozulur).
          labels: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional(),
    qr: z.boolean().optional(),
    stamps: z
      .object({
        printedAt: z.boolean().optional(),
        printedBy: z.boolean().optional(),
        copyLabel: z.string().max(20).optional(),
      })
      .optional(),
    blocks: z
      .array(
        z.object({
          position: z.enum(["afterHeader", "beforeSignatures"]),
          text: z.string().max(500),
        }),
      )
      .max(4)
      .optional(),
    language: z.enum(["tr", "en", "auto"]).optional(),
    blankWidths: z.boolean().optional(),
    footerNotePlacement: z.enum(["top", "bottom"]).optional(),
    // Alan bazlı punto/kalınlık + konum + grid grup sayısı (fason çeki).
    fields: z
      .record(
        z.string(),
        z.object({
          size: z.number().optional(),
          weight: z.enum(["light", "normal", "medium", "bold", "black"]).optional(),
        }),
      )
      .optional(),
    placements: z.record(z.string(), z.enum(["left", "right"])).optional(),
    gridGroups: z.number().optional(),
    gridRows: z.number().optional(),
    // AYARLANABİLİR BOŞ GRID (2026-08-09) — üçüncü kapı. Buraya yazılmazsa grid
    // kaydedilir ve GERÇEK BASKIDA görünür, ama canlı önizlemede GÖRÜNMEZ:
    // "önizleme = gerçek baskı" sözleşmesi tam da ayarı yapan kişinin gözü
    // önünde bozulur.
    blankGrid: z
      .object({
        enabled: z.boolean().optional(),
        title: z.string().optional(),
        rows: z.number().optional(),
        columns: z.number().optional(),
        columnWidths: z.array(z.number()).optional(),
        headers: z.array(z.string()).optional(),
        position: z.enum(["afterHeader", "beforeSignatures"]).optional(),
      })
      .optional(),
  })
  .nullable();
// ⚠️ BU ŞEMA BİR SESSİZ AYRIŞMA KAPISI. `z.object` tanımadığı anahtarı hata
// vermeden ATAR (Zod varsayılanı). Yeni bir DocumentConfig alanı eklerken buraya
// da yazılmazsa: ayar KAYDEDİLİR, gerçek baskıda GÖRÜNÜR, ama Belge Şablonları
// ekranının canlı önizlemesinde GÖRÜNMEZ — yani "önizleme = gerçek baskı" tek
// kaynak sözleşmesi tam da ayarı yapan kişinin gözü önünde bozulur ve hiçbir
// yerde hata çıkmaz. Kayıt kapısı (`sanitizeDocumentsConfig`) ile BİRLİKTE
// güncellenir. (`columns.shown` 2026-07-30'da tam bu yüzden eksik kalmıştı.)

const sampleHtmlSchema = z.object({ config: docConfigSchema.optional() });

function parseParams(req: Request): { docType: PrintedDocType; sourceId: string } {
  return {
    docType: docTypeSchema.parse(req.params.docType),
    sourceId: sourceIdSchema.parse(req.params.sourceId),
  };
}

export class PrintedDocumentController {
  constructor() {
    this.getCurrent = this.getCurrent.bind(this);
    this.getHtml = this.getHtml.bind(this);
    this.getSampleHtml = this.getSampleHtml.bind(this);
    this.listVersions = this.listVersions.bind(this);
    this.getVersion = this.getVersion.bind(this);
    this.reissue = this.reissue.bind(this);
  }

  /** GET /api/printed-documents/:docType/:sourceId/current */
  async getCurrent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const result = await printedDocumentService.getCurrent(docType, sourceId, {
        computeTemplateStale: true,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/printed-documents/:docType/:sourceId/html
   * Baskı-hazır HTML (TEK KAYNAK) — mobil expo-print + Electron printHtmlString
   * aynı HTML'i basar. Kaynak henüz taslaksa 409.
   */
  async getHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const version =
        req.query.version != null
          ? versionSchema.parse(req.query.version)
          : undefined;
      // ?draft=1 → donmuş belge yoksa canlı TASLAK önizlemesi (sevk öncesi baskı).
      const allowDraft = req.query.draft === "1" || req.query.draft === "true";
      // ?currentTemplate=1 → içerik donuk kalır, görünüm (şablon+künye) güncel
      // ayardan çözülür (yeniden baskıda "güncel şablonla" seçeneği).
      const useCurrentConfig =
        req.query.currentTemplate === "1" || req.query.currentTemplate === "true";
      // ?printNote= → tek seferlik baskı notu (persist edilmez, yalnız bu render).
      const printNote =
        typeof req.query.printNote === "string" ? req.query.printNote.slice(0, 300) : null;
      // ?rowNotes=1 → satır notlarını (çuval yorumu) BU baskıda göster. Kalıcı kolon
      // ayarını EZER (OR); ayara da snapshot'a da YAZILMAZ, yeni versiyon doğurmaz.
      const forceRowNotes = req.query.rowNotes === "1" || req.query.rowNotes === "true";
      // ?rowTags=1 → çuval İZLERİNİ (etiket) BU baskıda göster. Aynı sözleşme, AYRI
      // bayrak: `?rowNotes=1`e BİNDİRİLMEZ — iz ile yorum farklı hassasiyette veridir
      // ve tek bayrak, "notu bas" diyene sessizce izleri de bastırırdı (ve tersi).
      const forceRowTags = req.query.rowTags === "1" || req.query.rowTags === "true";
      // ?sections=urun,cuval → yalnız seçili listeleri bas (tek seferlik; kalıcı
      // bölüm ayarını EZER, hiçbir yere yazılmaz). Boş/geçersiz → yok sayılır ve
      // kalıcı ayar geçerli kalır; "hiçbirini basma" bilinçli olarak MÜMKÜN DEĞİL
      // (gövdesiz belge üretmesin — renderer da aynı kuralı uygular).
      const listSections =
        typeof req.query.sections === "string" && req.query.sections.trim()
          ? req.query.sections
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 10)
          : undefined;
      // ?merge=1 → listeleri aynı sayfada akıt. Varsayılan AYRI sayfa.
      const mergeSections = req.query.merge === "1" || req.query.merge === "true";
      // ?pageSize=A4|A5 → TEK SEFERLİK kâğıt boyu ezmesi (2026-08-09).
      // Refakat kartındaki (`traveler-card.controller`) sözleşmenin AYNISI:
      // kalıcı ayara da donmuş snapshot'a da YAZILMAZ, yeni versiyon DOĞURMAZ.
      // Meşruiyeti: kâğıt boyu SUNUM kararıdır, belgenin içeriği değil — aynı
      // belge A4 yazıcıdan da A5 yazıcıdan da çıkabilmeli.
      // ⚠️ Geçersiz değer SESSİZCE yok sayılır, 400'e düşülmez: yazım hatası
      // yüzünden sahayı kâğıtsız bırakmak, kalıcı ayarla basmaktan kötüdür.
      const rawPageSize = req.query.pageSize;
      const pageSize =
        rawPageSize === "A4" || rawPageSize === "A5" ? rawPageSize : undefined;
      const result = await printedDocumentService.getHtml(docType, sourceId, version, {
        allowDraft,
        useCurrentConfig,
        printedBy: req.user?.username ?? null,
        printNote,
        forceRowNotes,
        forceRowTags,
        listSections,
        mergeSections,
        pageSize,
      });
      const data = result.data as { html: string } | null;
      if (!data) {
        res
          .status(409)
          .json({ success: false, message: "Belge henüz hazır değil (taslak)." });
        return;
      }
      res.type("html").send(data.html);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/printed-documents/:docType/sample-html
   * Belge Şablonu canlı önizlemesi — örnek veri + gönderilen taslak config ile
   * gerçek renderHtml çıktısı (TASLAK filigranlı). Persist edilmez.
   */
  async getSampleHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const docType = docTypeSchema.parse(req.params.docType);
      const { config } = sampleHtmlSchema.parse(req.body ?? {});
      const html = await printedDocumentService.renderSampleHtml(docType, config ?? null);
      res.type("html").send(html);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/printed-documents/:docType/:sourceId/versions */
  async listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const result = await printedDocumentService.listVersions(docType, sourceId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/printed-documents/:docType/:sourceId/versions/:version */
  async getVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const version = versionSchema.parse(req.params.version);
      const result = await printedDocumentService.getVersion(docType, sourceId, version);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/printed-documents/:docType/:sourceId/reissue */
  async reissue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docType, sourceId } = parseParams(req);
      const { reason } = reissueSchema.parse(req.body);
      const result = await printedDocumentService.reissue(
        docType,
        sourceId,
        reason,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
}
