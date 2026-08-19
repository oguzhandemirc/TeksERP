// =============================================================================
// TeksERP - Label Template Service
// =============================================================================
// Etiket standardı yönetimi — Etiket Stüdyosu v2: şablonlar TEK HAVUZ.
// Bağlam (LabelKind) başına varsayılan artık LabelContextDefault tablosunda
// (kind @unique = DB seddi; eşzamanlı yarışta kaybeden P2002 → 409 aşağıda).
// GEÇİŞ: eski LabelTemplate.isDefault kolonu DEPRECATED ama ÇİFT-YAZIM ile
// senkron tutulur (mobil useLabelTemplate + eski client geri uyumu) — saha
// onayı sonrası kolonla birlikte kalkar.
//
// fields validation: src/config/label-fields.ts catalog'undan.
// - Sadece izinli key'ler kabul (whitelist)
// - required=true alanlar isVisible=true olmak zorunda
// - duplicate key yasak
// - order pozitif tamsayı
// - fontSize sadece "sm"|"md"|"lg"|"xl"
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import bwipjs from "bwip-js";
import {
  LabelTemplate,
  LabelKind,
  PrinterLanguage,
  Prisma,
  type LabelTemplateVariant,
} from "@prisma/client";
import {
  FIELD_CATALOG,
  FONT_SIZES,
  TemplateField,
  buildDefaultFields,
  findFieldDef,
  getAllowedKeys,
  getRequiredKeys,
  getUnifiedCatalog,
  getUnifiedKeys,
} from "../config/label-fields";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { renderLabel } from "./helpers/label-renderer.registry";
import { resolveLabelFormat } from "./helpers/label-format.resolver";
import { validateCanvasLayout, readCanvasLayout, CanvasValidationError } from "../config/label-elements";
import { assertContextRenderable } from "./helpers/label-context-fit";
import { LABEL_ICON_CATEGORIES, LABEL_ICONS, labelIconSvg } from "../config/label-icons";
import { mockPayload } from "./helpers/label-rawcode";
import { fieldDisplayValue } from "./helpers/label-field-values";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./helpers/native-preview";
import { mmToDots } from "./helpers/native-label.shared";
import { isRasterLanguage, renderCanvasRaster, type RasterLanguage } from "./helpers/raster/raster-render";
import { rasterPreviewHtml } from "./helpers/raster/raster-bmp";

const TABLE = "LABEL_TEMPLATE";

/**
 * "kind içinde tek default" partial unique index ihlalini (eşzamanlı setDefault/
 * create/update yarışı) 409'a çevirir. Diğer P2002'leri (örn. @@unique[kind,name]
 * isim çakışması) aynen geçirir — target'ta "default" geçip geçmediğine bakar.
 */
function rethrowDefaultConflict(e: unknown): never {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String((e.meta as { target?: unknown } | undefined)?.target ?? "")
      .toLowerCase()
      .includes("default")
  ) {
    throw AppError.conflict(
      "Bu tür için varsayılan az önce değişti — sayfayı yenileyip tekrar deneyin."
    );
  }
  throw e;
}

/**
 * ATAMA GUARD'ı (statik etiket kuralı) — bir şablon rulo/kartela bağlamına atanırken
 * (bağlam varsayılanı / müşteri şablon rotası / cihaz şablon rotası) çağrılır:
 * kanvas varyantı olan şablonun HER varyantında ≥1 taranabilir eleman (qr/code128)
 * olmalı. Taranabilirsiz "statik bakım etiketi" havuzda yaşayabilir ama atanamaz
 * (basılan rulo etiketi fiziksel iz ister). Varyantsız legacy akış şablonu aynen
 * geçer (akış modeli her zaman QR+barkod basar). Üç setter + set-default kullanır.
 */
export async function assertTemplateAssignable(
  templateId: string,
  /**
   * Atanacak BAĞLAM. Verilirse bağlam-uyum kontrolü de koşar (`label-context-fit`).
   * ⚠️ Bu bir *kind* kontrolü DEĞİL — "tek havuz" bozulmuyor: şablonun TÜRÜ hâlâ
   * önemsiz; sorulan tek şey "bu şablon bu bağlamın KİMLİĞİNİ basabiliyor mu".
   * Şu an yalnız ÇUVAL'da kimlik alanı tanımlı (`sackNo`); diğer bağlamlarda engel
   * yok. Baskı anında zaten 400 verecek bir atamayı atama anında kabul etmek
   * operatörü sonradan cezalandırmak olurdu.
   */
  targetKind?: LabelKind,
): Promise<void> {
  const t = await prisma.labelTemplate.findUnique({
    where: { id: templateId },
    // `id`/`variants.id` gerekli: label-context-fit TemplateLike bekliyor.
    // `kind` BİLİNÇLİ olarak seçilmiyor — deprecated kolonu canlandırmıyoruz.
    select: { id: true, name: true, standalone: true, variants: true },
  });
  // Yok → çağıran setter kendi 404/400'ünü verir.
  if (!t) return;
  // Serbest (statik) etiket: barkod içerse BİLE hiçbir bağlama atanamaz — talep
  // üzerine (şablon+kopya seç) basılır, fiziksel rulo/kartela izi taşımaz.
  if (t.standalone) {
    throw AppError.badRequest("Serbest (statik) etiket rulo/kartela bağlamına atanamaz");
  }
  // Bağlam uyumu — kimlik alanı tanımlı bağlamlarda (şu an yalnız SACK) ENGELLER;
  // diğerlerinde `ok` döner (gerekirse `warning` ile, çağıran onu yansıtabilir).
  // Varyantsızlık kontrolünden ÖNCE: çuval etiketi kanvas modelinde yaşar, varyantsız
  // şablon o bağlamda ROLL düzeni basar — "legacy akış geç" muafiyeti burada geçersiz.
  if (targetKind) assertContextRenderable(t, targetKind);
  // Varyantsız → legacy akış, geç (akış modeli her zaman QR+barkod basar).
  if (t.variants.length === 0) return;
  for (const v of t.variants) {
    const layout = readCanvasLayout(v.elements);
    if (!layout) continue; // okunamayan varyant baskıda akış-modeline düşer (taranabilir)
    const scannable = layout.elements.some((e) => e.type === "qr" || e.type === "code128");
    if (!scannable) {
      throw AppError.badRequest(
        `『${t.name}』 şablonunda barkod/QR yok — rulo/kartela atamasında kullanılamaz (statik etiket)`,
      );
    }
  }
}

/** Uzman raw-code override (dil→kod). Boş string'ler temizlenir = o dilde otomatik. */
export type RawCodeMap = Partial<Record<"PPLA" | "PPLB" | "ZPL" | "RASTER_HTML", string>>;

export interface LabelTemplateInput {
  name: string;
  /** Türlü şablonda zorunlu; serbest (statik) şablonda verilmez/null → kind null doğar. */
  kind?: LabelKind | null;
  isDefault?: boolean;
  isActive?: boolean;
  /** Serbest (statik) etiket — atanamaz + barkodsuz kaydedilebilir (baskı seçicisinde görünür). */
  standalone?: boolean;
  /** Boş geçilirse catalog'dan default field listesi üretilir. */
  fields?: TemplateField[];
  rawCode?: RawCodeMap;
  /** Yerleşim (şablon-başına, opsiyonel; null = varsayılana dön). */
  lineStepMm?: number | null;
  qrScale?: number | null;
  lengthBanner?: boolean | null;
}

export interface LabelTemplateUpdateInput {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  standalone?: boolean;
  fields?: TemplateField[];
  rawCode?: RawCodeMap;
  lineStepMm?: number | null;
  qrScale?: number | null;
  lengthBanner?: boolean | null;
}

/**
 * Taşınabilir şablon zarfı — dışa/içe aktar + çoğaltma ortak biçimi. id/timestamp/
 * isDefault taşınmaz (import edilen şablon asla default doğmaz; atama bağları kopmaz).
 */
export interface TemplateEnvelope {
  template: {
    name: string;
    kind?: LabelKind | null;
    standalone?: boolean;
    fields?: TemplateField[];
    rawCode?: RawCodeMap;
    lineStepMm?: number | null;
    qrScale?: number | null;
    lengthBanner?: boolean | null;
  };
  variants: Array<{
    name?: string;
    widthMm: number;
    heightMm: number;
    isPrimary?: boolean;
    elements: unknown;
  }>;
}

/** Boş/whitespace dil değerlerini at → { } = tüm diller otomatik üretim. */
function normalizeRawCode(rc: RawCodeMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rc)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export class LabelTemplateService {
  // ---------------------------------------------------------------------------
  // READS
  // ---------------------------------------------------------------------------

  async findAll(opts?: {
    kind?: LabelKind;
    includeInactive?: boolean;
    /** true → yalnız serbest (statik) şablonlar (baskı seçicisi). */
    standalone?: boolean;
    /** true → yalnız atanabilir şablonlar (serbest OLMAYAN — atama seçicileri). */
    assignable?: boolean;
  }): Promise<ApiResponse<LabelTemplate[]>> {
    const rows = await prisma.labelTemplate.findMany({
      where: {
        deletedAt: null, // KALICI silinenler hiçbir listede görünmez (pasifler görünür)
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(opts?.includeInactive ? {} : { isActive: true }),
        // standalone önceliklidir; ikisi birlikte gelirse (beklenmez) serbest filtresi kazanır.
        ...(opts?.standalone === true
          ? { standalone: true }
          : opts?.assignable === true
            ? { NOT: { standalone: true } } // null-safe "serbest değil"
            : {}),
      },
      // Havuz listesi varyant boyutlarını rozet olarak gösterir — minimal select.
      include: {
        variants: {
          select: { id: true, name: true, widthMm: true, heightMm: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    });
    return { success: true, data: rows };
  }

  async findById(id: string): Promise<ApiResponse<LabelTemplate>> {
    const row = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw AppError.notFound("Template bulunamadı");
    return { success: true, data: row };
  }

  /**
   * Bir bağlam (LabelKind) için varsayılan şablon — tek doğru kaynak
   * LabelContextDefault. Yoksa/pasifse null döner — etiket önizleme endpoint'i
   * bunu görüp catalog default'una düşer.
   */
  async findDefault(kind: LabelKind): Promise<LabelTemplate | null> {
    const def = await prisma.labelContextDefault.findUnique({
      where: { kind },
      include: { template: true },
    });
    if (!def) return null;
    const t = def.template;
    return t.isActive && t.deletedAt == null ? t : null;
  }

  /**
   * Frontend için: hangi alanlar var + tipleri + default başlıkları.
   * Template oluştururken UI'nın gösterdiği "alan kataloğu".
   */
  getCatalog(kind: LabelKind): ApiResponse<{ kind: LabelKind; fields: typeof FIELD_CATALOG[LabelKind] }> {
    const fields = FIELD_CATALOG[kind];
    if (!fields) throw AppError.badRequest("Bilinmeyen LabelKind");
    return { success: true, data: { kind, fields } };
  }

  /** BİRLEŞİK katalog (tek havuz) — her alan + değer ürettiği bağlamlar. Kanvas
   *  editörünün eleman paleti buradan beslenir. */
  getUnifiedCatalogResponse(): ApiResponse<{ fields: ReturnType<typeof getUnifiedCatalog> }> {
    return { success: true, data: { fields: getUnifiedCatalog() } };
  }

  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Ad-mükerrer ön kontrolü (Türkçe-duyarsız) — DB @@unique([name]) yalnız EXACT
   * eşleşmeyi yakalar ('Standart' vs 'standart' ikisi de girebilirdi). Tombstone
   * (deletedAt dolu, adı DEL- ile serbest bırakılmış) aday sayılmaz.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const target = foldNameForCompare(name);
    const hit = await prisma.labelTemplate.findFirst({
      where: { deletedAt: null, nameFold: target, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { name: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    if (!hit) return;
    throw AppError.conflict(
      hit.isActive
        ? `'${name}' adında bir etiket şablonu zaten var. Aynı şablon ikinci kez eklenemez.`
        : `'${name}' adında PASİF bir etiket şablonu zaten var. Yenisini eklemek yerine mevcut şablonu aktifleştirin.`,
    );
  }

  async create(input: LabelTemplateInput, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const name = input.name.trim();
    if (name.length === 0) throw AppError.badRequest("Template adı boş olamaz");
    const standalone = input.standalone ?? false;
    // Serbest (statik) etiket bağlama atanamaz — açılışta varsayılan da yapılamaz
    // (update/setDefault/setContextDefault assertTemplateAssignable ile bunu zaten
    // reddeder; create isDefault→LabelContextDefault yazımını burada kapatır).
    if (standalone && input.isDefault) {
      throw AppError.badRequest("Serbest (statik) etiket varsayılan yapılamaz");
    }
    // Serbest şablon TÜRSÜZ (kind null) doğar — baskı bağlamı yoktur, talep üzerine
    // basılır. Normal şablonda kind zorunlu (bağlam varsayılanı/rota türe göre çözülür).
    if (!standalone && !input.kind) {
      throw AppError.badRequest("Etiket türü (kind) zorunlu");
    }
    const kind: LabelKind | null = standalone ? null : input.kind ?? null;
    await this.assertNameAvailable(name);

    // Serbest şablon kanvas-tabanlıdır (alan bind'i yok) → fields boş; türlü şablonda
    // katalog doğrulaması sürer.
    const fields = input.fields ?? (kind ? buildDefaultFields(kind) : []);
    if (kind) validateFields(kind, fields);

    const created = await prisma.$transaction(async (tx) => {
      // isDefault=true geliyorsa eski kolonda diğerlerini düşür (çift-yazım geri uyumu).
      if (input.isDefault && kind) {
        await tx.labelTemplate.updateMany({
          where: { kind, isDefault: true },
          data: { isDefault: false },
        });
      }
      const row = await tx.labelTemplate.create({
        data: {
          // Kayıt künyesi (2026-08-19)
          createdById: userId ?? null,
          updatedById: userId ?? null,
          name,
          kind,
          isDefault: input.isDefault ?? false,
          isActive: input.isActive ?? true,
          standalone,
          fields: fields as unknown as Prisma.InputJsonValue,
          ...(input.rawCode ? { rawCode: normalizeRawCode(input.rawCode) as Prisma.InputJsonValue } : {}),
          lineStepMm: input.lineStepMm ?? null,
          qrScale: input.qrScale ?? null,
          lengthBanner: input.lengthBanner ?? null,
        },
      });
      // Tek doğru kaynak: bağlam varsayılanını LabelContextDefault'a yaz.
      if (input.isDefault && kind) {
        await tx.labelContextDefault.upsert({
          where: { kind },
          create: { kind, templateId: row.id },
          update: { templateId: row.id },
        });
      }
      return row;
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: {
        name: created.name,
        kind: created.kind,
        isDefault: created.isDefault,
        fieldCount: fields.length,
      },
    });

    return { success: true, data: created, message: "Template oluşturuldu" };
  }

  async update(id: string, input: LabelTemplateUpdateInput, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon düzenlenemez veya geri getirilemez");

    // kind null (havuz şablonu, F3+) → kind-whitelist'i yok; birleşik katalog
    // doğrulaması kanvas/varyant katmanında yapılır (validateElements).
    if (input.fields && existing.kind) {
      validateFields(existing.kind, input.fields);
    }

    const data: Prisma.LabelTemplateUpdateInput = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) throw AppError.badRequest("Template adı boş olamaz");
      // Kontrol yalnız ad gerçekten değişirken — mevcut kayıt aynen düzenlenebilir.
      if (foldNameForCompare(trimmed) !== foldNameForCompare(existing.name)) {
        await this.assertNameAvailable(trimmed, id);
      }
      data.name = trimmed;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.standalone !== undefined) data.standalone = input.standalone;
    if (input.fields) data.fields = input.fields as unknown as Prisma.InputJsonValue;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    if (input.rawCode !== undefined) data.rawCode = normalizeRawCode(input.rawCode) as Prisma.InputJsonValue;
    if (input.lineStepMm !== undefined) data.lineStepMm = input.lineStepMm;
    if (input.qrScale !== undefined) data.qrScale = input.qrScale;
    if (input.lengthBanner !== undefined) data.lengthBanner = input.lengthBanner;

    if (input.isDefault === true && !existing.kind) {
      throw AppError.badRequest(
        "Türsüz (havuz) şablonda varsayılan bu uçtan atanamaz — bağlam varsayılanları ekranını kullanın"
      );
    }

    // Serbest (statik) etiket varsayılan/atanabilir olamaz — aynı çağrıda hem
    // standalone:true hem isDefault:true gelirse (assertTemplateAssignable eski
    // DB değerini okuduğundan yakalayamaz) burada kes.
    if (input.isDefault === true && (input.standalone ?? existing.standalone)) {
      throw AppError.badRequest("Serbest (statik) etiket varsayılan yapılamaz");
    }

    // Zaten bir bağlama ATANMIŞ (ya da default olan) şablon serbeste çevrilemez:
    // aksi halde atama korunurken varyant barkodsuza düşürülebilir → gerçek rulo
    // için izsiz etiket basılır (assertTemplateAssignable atama ANINDA çalışır,
    // burada şablonu atamanın altından çekiyoruz). Önce atamalar kaldırılmalı.
    if (input.standalone === true && !existing.standalone &&
        (existing.isDefault || (await this.templateHasAssignments(id)))) {
      throw AppError.badRequest(
        "Atanmış şablon serbest (statik) yapılamaz — önce bağlam/müşteri/cihaz atamalarını kaldırın",
      );
    }

    // Bu uçtan da default atanabildiği için statik-etiket guard'ı burada da şart
    // (setDefault/setContextDefault ile aynı kural — barkodsuz şablon rulo/kartela
    // bağlamına atanamaz). Varyantsız legacy şablonda no-op.
    if (input.isDefault === true) {
      await assertTemplateAssignable(id);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // isDefault=true'ya çekiliyorsa eski kolonda diğerlerini düşür (çift-yazım).
      if (input.isDefault === true && !existing.isDefault && existing.kind) {
        await tx.labelTemplate.updateMany({
          where: { kind: existing.kind, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      const row = await tx.labelTemplate.update({ where: { id }, data });
      // Tek doğru kaynak senkronu: LabelContextDefault.
      if (input.isDefault === true && existing.kind) {
        await tx.labelContextDefault.upsert({
          where: { kind: existing.kind },
          create: { kind: existing.kind, templateId: id },
          update: { templateId: id },
        });
      } else if (input.isDefault === false && existing.kind) {
        // Bu şablon bağlamın default'uysa kaydı kaldır (bağlam default'suz kalabilir
        // — operatör bilinçli düşürebilir, UI uyarır; eski davranışla birebir).
        await tx.labelContextDefault.deleteMany({
          where: { kind: existing.kind, templateId: id },
        });
      }
      return row;
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: {
        name: existing.name,
        isDefault: existing.isDefault,
        isActive: existing.isActive,
      },
      newData: {
        name: updated.name,
        isDefault: updated.isDefault,
        isActive: updated.isActive,
        fieldsChanged: !!input.fields,
      },
    });

    return { success: true, data: updated, message: "Template güncellendi" };
  }

  /**
   * Şablonu bağlamın (kind) varsayılanı yapar. Idempotent. Tek doğru kaynak
   * LabelContextDefault; eski isDefault kolonu çift-yazımla senkron tutulur.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon default yapılamaz");
    if (!existing.isActive) throw AppError.badRequest("Pasif template default yapılamaz");
    if (!existing.kind) {
      throw AppError.badRequest(
        "Türsüz (havuz) şablonda varsayılan bu uçtan atanamaz — bağlam varsayılanları ekranını kullanın"
      );
    }
    const kind = existing.kind;
    const current = await prisma.labelContextDefault.findUnique({ where: { kind } });
    if (existing.isDefault && current?.templateId === id) {
      return { success: true, data: existing, message: "Zaten default" };
    }
    // Statik etiket kuralı: barkodsuz varyantlı şablon bağlam varsayılanı olamaz.
    await assertTemplateAssignable(id);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.labelTemplate.updateMany({
        where: { kind, isDefault: true },
        data: { isDefault: false },
      });
      await tx.labelContextDefault.upsert({
        where: { kind },
        create: { kind, templateId: id },
        update: { templateId: id },
      });
      return tx.labelTemplate.update({
        where: { id },
        data: { isDefault: true },
      });
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isDefault: false },
      newData: { isDefault: true, event: "SET_DEFAULT" },
    });

    return { success: true, data: updated, message: `${updated.name} artık default` };
  }

  /**
   * Soft delete: isActive=false. Default template silinemez (önce başka birini
   * default yapmak gerekir).
   */
  async deactivate(id: string, userId?: string): Promise<ApiResponse<{ deactivated: true }>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon pasifleştirilemez");
    const asDefault = await prisma.labelContextDefault.findFirst({ where: { templateId: id } });
    if (asDefault || existing.isDefault) {
      throw AppError.badRequest(
        "Default template pasifleştirilemez — önce başka bir template'i default yapın"
      );
    }
    if (!existing.isActive) {
      return { success: true, data: { deactivated: true }, message: "Zaten pasif" };
    }

    await prisma.labelTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isActive: true },
      newData: { isActive: false, event: "DEACTIVATE" },
    });

    return { success: true, data: { deactivated: true }, message: "Template pasifleştirildi" };
  }

  /**
   * KALICI silme — fiziksel DELETE DEĞİL (deletedAt kalıbı): satır veri bütünlüğü
   * için durur, hiçbir listede görünmez, geri getirilemez. Ad DEL- önekiyle serbest
   * kalır (kind+name unique); cihaz şablon yönlendirmeleri silinir (pivot istisnası).
   * Default şablon silinemez — önce başka şablon default yapılmalı.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<{ deleted: true }>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) {
      return { success: true, data: { deleted: true }, message: "Zaten silinmiş" }; // idempotent
    }
    const asDefault = await prisma.labelContextDefault.findFirst({ where: { templateId: id } });
    if (asDefault || existing.isDefault) {
      throw AppError.badRequest(
        "Default template kalıcı silinemez — önce başka bir template'i default yapın"
      );
    }
    const freedName = `DEL-${Date.now().toString(36).toUpperCase()} ${existing.name}`.slice(0, 100);
    await prisma.$transaction(async (tx) => {
      await tx.peripheralTemplateRoute.deleteMany({ where: { templateId: id } });
      // Müşteri atamaları da temizlenir — öksüz atama müşteriyi sessizce default'a
      // düşürmesin (cihaz route temizliğiyle simetrik).
      await tx.customerTemplateRoute.deleteMany({ where: { templateId: id } });
      await tx.labelTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, name: freedName },
      });
    });
    await AuditService.log({
      userId, action: "DELETE", tableName: TABLE, recordId: id,
      oldData: existing as unknown as Record<string, unknown>,
      newData: { deletedAt: new Date().toISOString(), freedName },
    }).catch(() => undefined);
    return { success: true, data: { deleted: true }, message: "Şablon kalıcı olarak silindi (kayıt veri bütünlüğü için saklanır)" };
  }

  // ---------------------------------------------------------------------------
  // DIŞA / İÇE AKTAR + ÇOĞALT (JSON zarf)
  // ---------------------------------------------------------------------------

  /** İstenen ada en yakın SERBEST adı bul (Türkçe-duyarsız). Doluysa " 2", " 3"…
   *  ekler (VarChar(100) sınırı). Import/duplicate ad çakışmasını sessizce çözer. */
  private async findAvailableName(desired: string): Promise<string> {
    const base = (desired.trim() || "Etiket").slice(0, 100);
    const rows = await prisma.labelTemplate.findMany({ where: { deletedAt: null }, select: { name: true } });
    const taken = new Set(rows.map((r) => foldNameForCompare(r.name)));
    if (!taken.has(foldNameForCompare(base))) return base;
    // Sayısal son-eke (" 999", i<1000) YER AYIR: base'i 95'e kısalt ki `${stem} ${i}`
    // 100 karakteri taşmasın. Yoksa 100-karakterlik adda ekleme kırpılıp sonsuz çakışır.
    const stem = base.slice(0, 95);
    for (let i = 2; i < 1000; i++) {
      const candidate = `${stem} ${i}`;
      if (!taken.has(foldNameForCompare(candidate))) return candidate;
    }
    throw AppError.conflict("Uygun bir şablon adı bulunamadı");
  }

  /**
   * Bir zarftan (import/duplicate ORTAK yolu) yeni şablon + varyantlar üret — TEK
   * transaction, tek audit. Ad-dedup (findAvailableName), her varyant parseCanvas ile
   * doğrulanır (tx DIŞINDA → hata atomik kalır), isDefault ASLA taşınmaz (fresh şablon
   * atanmamış → requireScannable=false; yapı yine doğrulanır). Tam bir primary garanti.
   */
  private async createFromEnvelope(
    env: TemplateEnvelope,
    opts: { desiredName?: string; event: string },
    userId?: string,
  ): Promise<LabelTemplate> {
    const t = env.template;
    const standalone = t.standalone ?? false;
    const kind: LabelKind | null = standalone ? null : (t.kind ?? null);
    if (!standalone && !kind) throw AppError.badRequest("Şablon türü (kind) eksik — geçersiz zarf");
    const name = await this.findAvailableName(opts.desiredName ?? t.name);
    const fields = t.fields ?? (kind ? buildDefaultFields(kind) : []);
    if (kind) validateFields(kind, fields);

    // Varyantları ÖNCE doğrula (parseCanvas AppError fırlatabilir → tx'e girmeden kes).
    const parsed = (env.variants ?? []).map((v) => ({
      name: (v.name?.trim() || `${v.widthMm}×${v.heightMm}`).slice(0, 60),
      widthMm: v.widthMm,
      heightMm: v.heightMm,
      isPrimary: v.isPrimary ?? false,
      layout: this.parseCanvas(v.elements, v.widthMm, v.heightMm, false),
    }));
    // Tam bir primary: hiç yoksa ilk, birden çoksa yalnız ilk.
    let primarySeen = false;
    for (const p of parsed) {
      if (p.isPrimary && !primarySeen) primarySeen = true;
      else p.isPrimary = false;
    }
    if (!primarySeen && parsed.length > 0) parsed[0]!.isPrimary = true;

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.labelTemplate.create({
        data: {
          name,
          kind,
          isDefault: false,
          isActive: true,
          standalone,
          fields: fields as unknown as Prisma.InputJsonValue,
          ...(t.rawCode ? { rawCode: normalizeRawCode(t.rawCode) as Prisma.InputJsonValue } : {}),
          lineStepMm: t.lineStepMm ?? null,
          qrScale: t.qrScale ?? null,
          lengthBanner: t.lengthBanner ?? null,
        },
      });
      // tx.* seri (pg adapter) — Promise.all YASAK; sıralı for-await.
      for (const p of parsed) {
        await tx.labelTemplateVariant.create({
          data: {
            templateId: row.id,
            name: p.name,
            widthMm: p.widthMm,
            heightMm: p.heightMm,
            isPrimary: p.isPrimary,
            elements: p.layout as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return row;
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw AppError.conflict("Ad veya boyut çakışması oluştu — tekrar deneyin");
      }
      throw e;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: { event: opts.event, name: created.name, kind: created.kind, variantCount: parsed.length },
    }).catch(() => undefined);
    return created;
  }

  /** Şablon + varyantlarını taşınabilir JSON zarfına çevir (id/timestamp HARİÇ). */
  async exportTemplate(id: string): Promise<ApiResponse<TemplateEnvelope>> {
    const t = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!t || t.deletedAt) throw AppError.notFound("Template bulunamadı");
    const variants = await prisma.labelTemplateVariant.findMany({
      where: { templateId: id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    const env: TemplateEnvelope = {
      template: {
        name: t.name,
        kind: t.kind,
        standalone: t.standalone,
        fields: t.fields as unknown as TemplateField[],
        rawCode: (t.rawCode as RawCodeMap) ?? undefined,
        lineStepMm: t.lineStepMm != null ? Number(t.lineStepMm) : null,
        qrScale: t.qrScale,
        lengthBanner: t.lengthBanner,
      },
      variants: variants.map((v) => ({
        name: v.name,
        widthMm: Number(v.widthMm),
        heightMm: Number(v.heightMm),
        isPrimary: v.isPrimary,
        elements: v.elements,
      })),
    };
    return { success: true, data: env };
  }

  /** JSON zarfını yeni şablon olarak içe aktar (ad çakışması → dedup). */
  async importTemplate(env: TemplateEnvelope, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    if (!env?.template?.name?.trim()) throw AppError.badRequest("Geçersiz şablon dosyası (ad yok)");
    if (!Array.isArray(env.variants)) throw AppError.badRequest("Geçersiz şablon dosyası (varyant listesi yok)");
    const created = await this.createFromEnvelope(env, { event: "IMPORT" }, userId);
    return { success: true, data: created, message: "Şablon içe aktarıldı" };
  }

  /** Şablonu komple çoğalt — "… (kopya)" adıyla; isDefault/atamalar taşınmaz. */
  async duplicateTemplate(id: string, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const { data: env } = await this.exportTemplate(id);
    const created = await this.createFromEnvelope(env, { desiredName: `${env.template.name} (kopya)`, event: "DUPLICATE" }, userId);
    return { success: true, data: created, message: "Şablon çoğaltıldı" };
  }

  // ---------------------------------------------------------------------------
  // BOYUT VARYANTLARI (Etiket Stüdyosu v2 — kanvas yerleşimi varyantta yaşar)
  // ---------------------------------------------------------------------------

  async listVariants(templateId: string): Promise<ApiResponse<LabelTemplateVariant[]>> {
    const t = await prisma.labelTemplate.findUnique({ where: { id: templateId }, select: { id: true, deletedAt: true } });
    if (!t || t.deletedAt) throw AppError.notFound("Template bulunamadı");
    const rows = await prisma.labelTemplateVariant.findMany({
      where: { templateId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return { success: true, data: rows };
  }

  /**
   * Yeni boyut varyantı. İKİ kaynak: `copyFromVariantId` (mevcut bir varyantın
   * yerleşimini KOPYALA — kullanıcı akışı: "100×60'ı tasarladım, 100×50'yi onun
   * üstünden yapayım"; BAŞKA şablonun varyantından da kopyalanabilir) veya
   * doğrudan `elements`. Otomatik ölçekleme YOK — kopyalanan yerleşim elle
   * düzeltilir/teyit edilir. Şablonun İLK varyantı otomatik primary olur.
   */
  async createVariant(
    templateId: string,
    input: {
      name?: string;
      widthMm: number;
      heightMm: number;
      copyFromVariantId?: string | null;
      elements?: unknown;
    },
    userId?: string,
  ): Promise<ApiResponse<LabelTemplateVariant>> {
    const template = await prisma.labelTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, deletedAt: true, standalone: true, variants: { select: { id: true } } },
    });
    if (!template || template.deletedAt) throw AppError.notFound("Template bulunamadı");

    let elementsRaw: unknown = input.elements;
    if (input.copyFromVariantId) {
      const src = await prisma.labelTemplateVariant.findUnique({
        where: { id: input.copyFromVariantId },
        select: { elements: true, template: { select: { deletedAt: true } } },
      });
      if (!src || src.template.deletedAt) throw AppError.badRequest("Kopyalanacak varyant bulunamadı");
      elementsRaw = src.elements;
    }
    if (elementsRaw == null) {
      throw AppError.badRequest("elements veya copyFromVariantId zorunlu");
    }
    // Statik etiket kuralı: atanmamış havuz şablonuna barkodsuz yerleşim kaydedilebilir;
    // atanmış (bağlam/müşteri/cihaz rotalı) şablonda taranabilir alan zorunlu kalır.
    // Serbest (statik) etiket HER ZAMAN barkod-muaf (atanamadığından atama da yok).
    const requireScannable = !template.standalone && (await this.templateHasAssignments(templateId));
    const layout = this.parseCanvas(elementsRaw, input.widthMm, input.heightMm, requireScannable);

    const created = await prisma.labelTemplateVariant
      .create({
        data: {
          templateId,
          name: (input.name?.trim() || `${input.widthMm}×${input.heightMm}`).slice(0, 60),
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          isPrimary: template.variants.length === 0,
          elements: layout as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict("Bu şablonda bu boyutta bir varyant zaten var");
        }
        throw e;
      });

    await AuditService.log({
      userId, action: "CREATE", tableName: "LABEL_TEMPLATE_VARIANT", recordId: created.id,
      newData: { templateId, templateName: template.name, name: created.name, widthMm: input.widthMm, heightMm: input.heightMm, copiedFrom: input.copyFromVariantId ?? null },
    });
    return { success: true, data: created, message: "Varyant oluşturuldu" };
  }

  async updateVariant(
    variantId: string,
    input: { name?: string; widthMm?: number; heightMm?: number; elements?: unknown },
    userId?: string,
  ): Promise<ApiResponse<LabelTemplateVariant>> {
    const existing = await prisma.labelTemplateVariant.findUnique({
      where: { id: variantId },
      include: { template: { select: { deletedAt: true, name: true, standalone: true } } },
    });
    if (!existing || existing.template.deletedAt) throw AppError.notFound("Varyant bulunamadı");

    const widthMm = input.widthMm ?? Number(existing.widthMm);
    const heightMm = input.heightMm ?? Number(existing.heightMm);
    const data: Prisma.LabelTemplateVariantUpdateInput = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw AppError.badRequest("Varyant adı boş olamaz");
      data.name = trimmed.slice(0, 60);
    }
    if (input.widthMm !== undefined) data.widthMm = input.widthMm;
    if (input.heightMm !== undefined) data.heightMm = input.heightMm;
    // Boyut değişiyorsa mevcut yerleşim de yeni tuvale göre doğrulanmalı.
    const elementsRaw = input.elements !== undefined ? input.elements : (input.widthMm !== undefined || input.heightMm !== undefined) ? existing.elements : undefined;
    if (elementsRaw !== undefined) {
      // Statik etiket kuralı — createVariant ile aynı: atanmışsa taranabilir zorunlu,
      // serbest (statik) etiket her zaman barkod-muaf.
      const requireScannable = !existing.template.standalone && (await this.templateHasAssignments(existing.templateId));
      const layout = this.parseCanvas(elementsRaw, widthMm, heightMm, requireScannable);
      data.elements = layout as unknown as Prisma.InputJsonValue;
    }

    const updated = await prisma.labelTemplateVariant
      .update({ where: { id: variantId }, data })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict("Bu şablonda bu boyutta bir varyant zaten var");
        }
        throw e;
      });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "LABEL_TEMPLATE_VARIANT", recordId: variantId,
      oldData: { name: existing.name, widthMm: existing.widthMm, heightMm: existing.heightMm },
      newData: { name: updated.name, widthMm: updated.widthMm, heightMm: updated.heightMm, elementsChanged: input.elements !== undefined },
    });
    return { success: true, data: updated, message: "Varyant güncellendi" };
  }

  /** Varyantı sil. Primary yalnız SON varyantsa silinebilir (son varyantın silinmesi
   *  = şablonun akış-moduna dönüşü; migration geri-dönüş mekanizması). */
  async deleteVariant(variantId: string, userId?: string): Promise<ApiResponse<{ deleted: true }>> {
    const existing = await prisma.labelTemplateVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, isPrimary: true, templateId: true },
    });
    if (!existing) throw AppError.notFound("Varyant bulunamadı");
    const siblings = await prisma.labelTemplateVariant.count({
      where: { templateId: existing.templateId, NOT: { id: variantId } },
    });
    if (existing.isPrimary && siblings > 0) {
      throw AppError.badRequest("Birincil varyant silinemez — önce başka bir varyantı birincil yapın");
    }
    await prisma.labelTemplateVariant.delete({ where: { id: variantId } });
    await AuditService.log({
      userId, action: "DELETE", tableName: "LABEL_TEMPLATE_VARIANT", recordId: variantId,
      oldData: { templateId: existing.templateId, name: existing.name, isPrimary: existing.isPrimary },
    });
    return { success: true, data: { deleted: true }, message: "Varyant silindi" };
  }

  async setPrimaryVariant(variantId: string, userId?: string): Promise<ApiResponse<LabelTemplateVariant>> {
    const existing = await prisma.labelTemplateVariant.findUnique({
      where: { id: variantId },
      select: { id: true, templateId: true, isPrimary: true },
    });
    if (!existing) throw AppError.notFound("Varyant bulunamadı");
    if (existing.isPrimary) {
      const row = await prisma.labelTemplateVariant.findUnique({ where: { id: variantId } });
      return { success: true, data: row!, message: "Zaten birincil" };
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.labelTemplateVariant.updateMany({
        where: { templateId: existing.templateId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.labelTemplateVariant.update({ where: { id: variantId }, data: { isPrimary: true } });
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "LABEL_TEMPLATE_VARIANT", recordId: variantId,
      newData: { event: "SET_PRIMARY", templateId: existing.templateId },
    });
    return { success: true, data: updated, message: "Birincil varyant güncellendi" };
  }

  /** Şablonun herhangi bir atası var mı? (bağlam varsayılanı / müşteri rotası /
   *  cihaz rotası). Varyant kaydında taranabilir-alan kuralının anahtarı: atanmamış
   *  havuz şablonu STATİK (barkodsuz) kaydedilebilir; atanmış şablonda kural sürer. */
  private async templateHasAssignments(templateId: string): Promise<boolean> {
    const ctx = await prisma.labelContextDefault.count({ where: { templateId } });
    if (ctx > 0) return true;
    const cust = await prisma.customerTemplateRoute.count({ where: { templateId } });
    if (cust > 0) return true;
    const dev = await prisma.peripheralTemplateRoute.count({ where: { templateId } });
    return dev > 0;
  }

  /** Kanvas doğrulama + bilinen bind kontrolü (Türkçe hatalar → 400).
   *  requireScannable=false → statik (barkodsuz) yerleşim kabul (atanmamış havuz
   *  şablonu); true → taranabilir alan zorunlu (atanmış şablon / geri uyum). */
  private parseCanvas(raw: unknown, widthMm: number, heightMm: number, requireScannable = true) {
    try {
      const layout = validateCanvasLayout(raw, { widthMm, heightMm, requireScannable });
      const allowed = getUnifiedKeys();
      for (const el of layout.elements) {
        if (el.type === "field" && !allowed.has(el.bind)) {
          throw new CanvasValidationError(`Bilinmeyen alan anahtarı: '${el.bind}'`);
        }
      }
      return layout;
    } catch (e) {
      if (e instanceof CanvasValidationError) throw AppError.badRequest(e.message);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // BAĞLAM VARSAYILANLARI (kind → şablon) — atama ekranı uçları
  // ---------------------------------------------------------------------------

  async listContextDefaults(): Promise<
    ApiResponse<Array<{ kind: LabelKind; templateId: string; templateName: string }>>
  > {
    const rows = await prisma.labelContextDefault.findMany({
      include: { template: { select: { id: true, name: true } } },
      orderBy: { kind: "asc" },
    });
    return {
      success: true,
      data: rows.map((r) => ({ kind: r.kind, templateId: r.templateId, templateName: r.template.name })),
    };
  }

  /** Bağlam varsayılanını ata/kaldır (templateId null → bağlam default'suz kalır).
   *  Havuz şablonu (kind'sız) da atanabilir; eski isDefault bayrağı yalnız şablonun
   *  legacy kind'ı bağlamla eşleşiyorsa senkronlanır (geri uyum penceresi). */
  async setContextDefault(
    kind: LabelKind,
    templateId: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ kind: LabelKind; templateId: string | null }>> {
    if (!templateId) {
      await prisma.$transaction(async (tx) => {
        await tx.labelContextDefault.deleteMany({ where: { kind } });
        await tx.labelTemplate.updateMany({ where: { kind, isDefault: true }, data: { isDefault: false } });
      });
      await AuditService.log({
        userId, action: "UPDATE", tableName: TABLE, recordId: kind,
        newData: { event: "SET_CONTEXT_DEFAULT", kind, templateId: null },
      }).catch(() => undefined);
      return { success: true, data: { kind, templateId: null }, message: "Bağlam varsayılanı kaldırıldı" };
    }

    const template = await prisma.labelTemplate.findFirst({
      where: { id: templateId, isActive: true, deletedAt: null },
      select: { id: true, name: true, kind: true },
    });
    if (!template) throw AppError.badRequest("Şablon bulunamadı veya pasif");
    // Statik etiket kuralı: barkodsuz varyantlı şablon bağlama ATANAMAZ (kaldırma serbest).
    // `kind` geçilir: tür şartı YOK (tek havuz) ama bağlamın KİMLİK alanını basamayan
    // şablon reddedilir — bkz. `helpers/label-context-fit.ts`.
    await assertTemplateAssignable(templateId, kind);

    await prisma.$transaction(async (tx) => {
      await tx.labelContextDefault.upsert({
        where: { kind },
        create: { kind, templateId },
        update: { templateId },
      });
      // Çift-yazım (geri uyum): eski kolon kind-kapsamlı — yalnız eşleşen legacy
      // kind'da senkronlanabilir.
      await tx.labelTemplate.updateMany({ where: { kind, isDefault: true, NOT: { id: templateId } }, data: { isDefault: false } });
      if (template.kind === kind) {
        await tx.labelTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
      }
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId, action: "UPDATE", tableName: TABLE, recordId: templateId,
      newData: { event: "SET_CONTEXT_DEFAULT", kind, templateId, templateName: template.name },
    }).catch(() => undefined);
    return { success: true, data: { kind, templateId }, message: `${template.name} — ${kind} varsayılanı` };
  }

  /**
   * Bu tür + dil için OTOMATİK ÜRETİLEN kodu, düzenlenebilir {{}} yer-tutuculu şablon
   * olarak döner ("Varsayılan kodu getir"). Auto çıktısındaki görünen alan değerlerini
   * ({{key}}) yer-tutucusuna geri çevirir → uzman bunu kopyalayıp/düzenleyip kaydeder.
   */
  async getDefaultCode(kind: LabelKind, language: PrinterLanguage): Promise<ApiResponse<{ code: string }>> {
    const payload = mockPayload(kind);
    const tpl = await this.findDefault(kind);
    // rawCode'u sıyır → otomatik üretim (şablonun alanlarıyla); değerler fieldDisplayValue
    // formatında çıkar → aşağıdaki geri-çevirme birebir eşleşir.
    const template = tpl ? ({ ...tpl, rawCode: null } as LabelTemplate) : null;
    const format = await resolveLabelFormat({ kind });
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    let code = (await renderLabel(language, { payload, template, barcodeSvg, qrSvg, copies: 1, format })).content;
    // Görünen değer → {{key}} (uzun değer önce ki alt-dize çakışması olmasın).
    const pairs = [...getAllowedKeys(kind)]
      .map((k) => [k, fieldDisplayValue(payload, k).value] as const)
      .filter(([, v]) => v && v.trim().length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    for (const [k, v] of pairs) code = code.split(v).join(`{{${k}}}`);
    return { success: true, data: { code } };
  }

  /** Bu tür için önerilen VARSAYILAN tasarım — "Varsayılana dön" butonu bunu uygular.
   *  Alanlar: katalog default'u. Yerleşim: dengeli satır aralığı + QR + metraj bandı
   *  (ROLL türlerinde açık, SWATCH'ta kapalı — metraj yok). */
  getTemplateDefaults(kind: LabelKind): ApiResponse<{
    fields: TemplateField[];
    lineStepMm: number;
    qrScale: number;
    lengthBanner: boolean;
  }> {
    if (!FIELD_CATALOG[kind]) throw AppError.badRequest("Bilinmeyen LabelKind");
    return {
      success: true,
      data: {
        fields: buildDefaultFields(kind),
        lineStepMm: 1.5, // satırlar arası dengeli ek boşluk (mm)
        qrScale: 5, // okunur QR (~20mm ayak izi)
        // Sağ dikey metraj bandı — yalnız TOP etiketinde anlamlı. Kartelada boy (cm),
        // çuvalda toplam metraj var ama bant tek-top vurgusu için tasarlandı → kapalı.
        lengthBanner: kind !== LabelKind.SWATCH && kind !== LabelKind.SACK,
      },
    };
  }

  /**
   * "Alanlar" sekmesi canlı önizlemesi — AKTİF DİLDE (WYSIWYG). Verilen (kaydedilmemiş)
   * alanlarla + sistem varsayılan geometrisiyle render eder. Native dil (PPLB) → görsel
   * SVG (baskıyla birebir); HTML dili → HTML; çizilemeyen native → ham komut metni.
   */
  async getFieldsPreview(
    kind: LabelKind,
    fields: TemplateField[],
    layout?: { lineStepMm?: number | null; qrScale?: number | null; lengthBanner?: boolean | null },
  ): Promise<
    ApiResponse<{
      mode: "svg" | "html" | "text";
      language: PrinterLanguage;
      content: string;
      /** Ham yazıcı kodu — "Kod" görünümü için (alan değişimi → koda etkisi görünür). */
      native: string;
    }>
  > {
    const payload = mockPayload(kind);
    // Yerleşim (satır aralığı + QR + metraj bandı) canlı önizlemeye yansısın → template'e göm.
    const template = {
      kind,
      fields,
      rawCode: null,
      lineStepMm: layout?.lineStepMm ?? null,
      qrScale: layout?.qrScale ?? null,
      lengthBanner: layout?.lengthBanner ?? null,
    } as unknown as LabelTemplate;
    const format = await resolveLabelFormat({ kind });
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    const input = { payload, template, barcodeSvg, qrSvg, copies: 1, format };
    const language = format.language;
    if (language === PrinterLanguage.RASTER_HTML) {
      const html = (await renderLabel(language, input)).content;
      return { success: true, data: { mode: "html", language, content: html, native: html } };
    }
    const native = (await renderLabel(language, input)).content;
    const svg = renderNativePreviewSvg(
      language,
      native,
      mmToDots(format.widthMm, format.dpi),
      mmToDots(format.heightMm, format.dpi),
    );
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg), native } };
    return { success: true, data: { mode: "text", language, content: native, native } };
  }

  /**
   * KANVAS canlı önizlemesi (Etiket Stüdyosu v2) — kaydedilmemiş varyant tuvali +
   * eleman listesiyle WYSIWYG render. Medya = tuval boyutu (varyant tasarımı kendi
   * boyutunda görülür); dil verilmezse aktif dil (cihazsız → RASTER_HTML). Native
   * dil → komutlar SVG'ye çizilir ("önizleme = baskı"); çizilemeyen → ham komut.
   */
  async getCanvasPreview(opts: {
    kind: LabelKind;
    widthMm: number;
    heightMm: number;
    elements: unknown;
    language?: PrinterLanguage;
    /** "Bu Bilgisayar"da seçili Cihaz Kaydı yazıcısı — verilirse dil + medya (dpi)
     *  O CİHAZDAN çözülür (editör Test Baskısı gerçek yazıcı diliyle bassın diye). */
    peripheralId?: string;
    /** Baskı adedi (1–100, controller doğrular) — native P/Q/^PQ komutu, raster
     *  zarfı ve HTML çoğaltması (applyCopies) hepsi bunu işler. Verilmedi = 1. */
    copies?: number;
    /** Örnek topun kalite KODU — koşullu (showIf) elemanlar önizlemede de gerçek
     *  kuralla değerlendirilsin diye. Verilmedi → mock varsayılanı; boş metin →
     *  "kalitesi belirsiz top" (koşullu eleman basılmaz, fail-closed görülür). */
    qualityGrade?: string;
  }): Promise<
    ApiResponse<{
      mode: "svg" | "html" | "text";
      language: PrinterLanguage;
      content: string;
      /** Ham yazıcı kodu — "Kod" görünümü (eleman değişimi → koda etkisi görünür). */
      native: string;
      /** Raster modda: zarf baytlarının base64'ü (editör Test Baskısı gönderir). */
      nativeB64?: string;
    }>
  > {
    let layout;
    try {
      // ÖNİZLEME yolu: taranabilir-alan kuralı UYGULANMAZ (requireScannable: false)
      // — statik (barkodsuz) bakım etiketi tasarımı da editörde görülebilmeli;
      // kural yalnız kayıtta (parseCanvas) ve atamada (assertTemplateAssignable) işler.
      layout = validateCanvasLayout(opts.elements, {
        widthMm: opts.widthMm,
        heightMm: opts.heightMm,
        requireScannable: false,
      });
    } catch (e) {
      if (e instanceof CanvasValidationError) throw AppError.badRequest(e.message);
      throw e;
    }
    const payload = mockPayload(opts.kind);
    if (opts.qualityGrade !== undefined) payload.qualityGrade = opts.qualityGrade;
    // Cihaz seçiliyse medya (dpi/gap) + dil O CİHAZDAN çözülür — "Bu Bilgisayar"da
    // seçili Cihaz Kaydı yazıcısı (ör. Argox PPLB) editör Test Baskısı'nda da gerçek
    // dille bassın diye. Dil önceliği: explicit language > cihaz languageOverride >
    // RASTER_HTML (cihazsız). resolveLabelFormat dili SABİT RASTER_HTML döndürür
    // (dil routing katmanında biner), o yüzden languageOverride'ı ayrı okuruz.
    const base = await resolveLabelFormat({ kind: opts.kind, peripheralId: opts.peripheralId ?? null });
    let deviceLang: PrinterLanguage | undefined;
    let rasterMode = false;
    if (opts.peripheralId) {
      const dev = await prisma.peripheralDevice.findFirst({
        where: { id: opts.peripheralId, deletedAt: null },
        select: { languageOverride: true, rasterMode: true },
      });
      deviceLang = dev?.languageOverride ?? undefined;
      rasterMode = dev?.rasterMode ?? false;
    }
    const language = opts.language ?? deviceLang ?? base.language;
    const format = { ...base, widthMm: opts.widthMm, heightMm: opts.heightMm, language };
    const fakeVariant = {
      elements: layout,
      widthMm: opts.widthMm,
      heightMm: opts.heightMm,
    } as unknown as LabelTemplateVariant;
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    const copies = Math.max(1, Math.min(100, Math.floor(opts.copies ?? 1)));
    // iconGraphicsOk: editör Test Baskısı ikon içeren kanvası da bassın. `native` latin1
    // olarak dönüp Electron main'de Buffer.from(...,"latin1") ile seri/USB'ye yazılır →
    // GW binary bit-bire-bir korunur (round-trip: pplbGwBlock→latin1→JSON/UTF-8→IPC→latin1).
    // Önizleme SVG'si de GW header'ından ikon placeholder'ı çizer. Komut yolu (rasterMode
    // KAPALI) ikon olmadan yalnız yazı basıyordu — bu bug'ın kök nedeni.
    const input = { payload, template: null, variant: fakeVariant, barcodeSvg, qrSvg, copies, format, iconGraphicsOk: true };
    if (language === PrinterLanguage.RASTER_HTML) {
      const html = (await renderLabel(language, input)).content;
      return { success: true, data: { mode: "html", language, content: html, native: html } };
    }
    // RASTER cihaz + kanvas → önizleme AYNI 1bpp bitmap (BMP). "Kod" görünümü insan-okur
    // özet; baytlar nativeB64'te (editör Test Baskısı gönderir). Envelope patlarsa
    // (PPLA F0 / font eksik) komut SVG'sine düşer (dual-mode, baskıyla tutarlı).
    if (rasterMode && isRasterLanguage(language)) {
      try {
        const { bytes, bitmap } = await renderCanvasRaster(language as RasterLanguage, { payload, format, copies, layout });
        return {
          success: true,
          data: {
            mode: "html",
            language,
            content: rasterPreviewHtml(bitmap, opts.widthMm, opts.heightMm),
            native: `«raster ${bitmap.widthDots}×${bitmap.heightDots} dot, ${bytes.length} bayt (${language})»`,
            nativeB64: bytes.toString("base64"),
          },
        };
      } catch { /* raster envelope başarısız → aşağıdaki komut SVG'sine düş */ }
    }
    const native = (await renderLabel(language, input)).content;
    const svg = renderNativePreviewSvg(
      language,
      native,
      mmToDots(opts.widthMm, format.dpi),
      mmToDots(opts.heightMm, format.dpi),
    );
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg), native } };
    return { success: true, data: { mode: "text", language, content: native, native } };
  }

  /** Bakım sembolü kataloğu — editör ikon paleti (kategori + anahtar/başlık/SVG).
   *  SVG editör önizlemesi içindir; baskı yolu AYNI primitifleri raster-icon ile
   *  1bpp'e döker (önizleme = baskı). Statik katalog — DB'siz. */
  getIconCatalog(): ApiResponse<{
    categories: typeof LABEL_ICON_CATEGORIES;
    icons: Array<{ key: string; label: string; category: string; svg: string }>;
  }> {
    return {
      success: true,
      data: {
        categories: LABEL_ICON_CATEGORIES,
        icons: LABEL_ICONS.map((i) => ({
          key: i.key,
          label: i.label,
          category: i.category,
          svg: labelIconSvg(i.key) ?? "",
        })),
      },
    };
  }
}

// =============================================================================
// Validation
// =============================================================================

function validateFields(kind: LabelKind, fields: TemplateField[]): void {
  if (!Array.isArray(fields)) {
    throw AppError.badRequest("fields bir dizi olmalı");
  }
  if (fields.length === 0) {
    throw AppError.badRequest("Template'te en az 1 alan olmalı");
  }

  const allowed = getAllowedKeys(kind);
  const required = getRequiredKeys(kind);
  const seen = new Set<string>();

  for (const f of fields) {
    if (!f || typeof f !== "object") {
      throw AppError.badRequest("Geçersiz field nesnesi");
    }
    if (typeof f.key !== "string" || f.key.length === 0) {
      throw AppError.badRequest("field.key zorunlu (string)");
    }
    if (!allowed.has(f.key)) {
      throw AppError.badRequest(
        `'${f.key}' bu etiket türünde tanımlı değil. İzinli alanlar: ${[...allowed].join(", ")}`
      );
    }
    if (seen.has(f.key)) {
      throw AppError.badRequest(`Tekrarlanan alan: '${f.key}'`);
    }
    seen.add(f.key);

    // label boş olabilir (çıktıda yalnız değer görünür) — yalnız string tipi şart.
    if (typeof f.label !== "string") {
      throw AppError.badRequest(`'${f.key}' için label metin olmalı`);
    }
    if (typeof f.order !== "number" || !Number.isInteger(f.order) || f.order < 1) {
      throw AppError.badRequest(`'${f.key}' için order pozitif tamsayı olmalı`);
    }
    if (typeof f.isVisible !== "boolean") {
      throw AppError.badRequest(`'${f.key}' için isVisible boolean olmalı`);
    }
    if (f.isBold !== undefined && typeof f.isBold !== "boolean") {
      throw AppError.badRequest(`'${f.key}' için isBold boolean olmalı`);
    }
    if (f.fontSize !== undefined && !FONT_SIZES.includes(f.fontSize)) {
      throw AppError.badRequest(
        `'${f.key}' için fontSize geçersiz. İzinli: ${FONT_SIZES.join(", ")}`
      );
    }

    // required alanlar isVisible=true olmak zorunda
    if (required.has(f.key) && !f.isVisible) {
      const def = findFieldDef(kind, f.key);
      throw AppError.badRequest(
        `'${def?.defaultLabel ?? f.key}' alanı zorunlu — gizlenemez`
      );
    }
  }

  // Required alanların hepsi listede olmak zorunda
  for (const reqKey of required) {
    if (!seen.has(reqKey)) {
      const def = findFieldDef(kind, reqKey);
      throw AppError.badRequest(
        `Zorunlu alan eksik: '${def?.defaultLabel ?? reqKey}'`
      );
    }
  }

  // Scanner-okur en az bir alan zorunlu: barkod VEYA QR kodu görünür olmalı.
  // Aksi halde basılan etiket fabrika içi takip edilemez — fiziksel iz kalmaz.
  const hasBarcode = fields.some((f) => f.key === "barcode" && f.isVisible);
  const hasQr = fields.some((f) => f.key === "qrCode" && f.isVisible);
  if (!hasBarcode && !hasQr) {
    throw AppError.badRequest(
      "Barkod veya QR kodundan en az biri görünür olmalı (taranabilir alan zorunlu)"
    );
  }
}
