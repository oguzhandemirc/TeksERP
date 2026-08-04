// =============================================================================
// Refakat Kartı Şablonu — CRUD + çözüm zinciri (Faz 2)
// =============================================================================
// Üç kademe (bkz. schema.prisma TravelerCardTemplate):
//   BUILTIN  — acemi: hiç dokunmaz, yerleşik yerleşim.
//   SECTIONS — orta: bölüm sırası/açık-kapalı (Şablon Stüdyosu).
//   RAW_HTML — uzman: kartın tüm HTML'ini kendi yazar ({{alan}} ile veri).
//
// ÇÖZÜM ZİNCİRİ (kart basımında): açık seçim > varsayılan şablon > SİSTEM AYARI.
// Son halka bilerek "şablon yok" durumudur: tablo boşken kart bugünkü gibi
// basılır, yani Faz 2 kurulur kurulmaz hiçbir şey değişmez. Şablon oluşturmak
// AKTİF bir karardır.
//
// FAIL-CLOSED: seçili şablon çözülemiyorsa (silinmiş/pasif/bozuk) baskı NET 400
// verir — sessizce yerleşiğe SAPMAZ. Emsal çuval etiketi: bilinmeyen kind'ı
// ROLL_FINISHED'a düşüren eski davranış, yanlış belgeyi doğru sanarak bastırıyordu.
// Kullanıcının çıkışı "Yerleşiğe dön" (şablonu BUILTIN'e çevir) ya da baskıda
// şablon seçmemektir — ikisi de bilinçli, ikisi de tek tık.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, TravelerTemplateMode } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import {
  normalizeTravelerCardConfig,
  readTravelerCardConfig,
  type TravelerCardConfig,
} from "./system-setting.service";
import {
  sanitizeTemplateHtml,
  describeSanitization,
  findUnknownKeys,
} from "./document-render/traveler-card-raw";

const TABLE = "TRAVELER_CARD_TEMPLATE";
const MAX_HTML = 200_000; // ~200 KB — bir sayfalık belge için fazlasıyla cömert

export interface TravelerTemplateInput {
  name?: string;
  mode?: TravelerTemplateMode;
  config?: unknown;
  html?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
}

/** Karta DONDURULAN çözülmüş şablon — snapshot.template ile aynı şekil. */
export interface ResolvedTravelerTemplate {
  id: string | null;
  name: string;
  mode: TravelerTemplateMode;
  html: string | null;
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  mode: true,
  isDefault: true,
  isActive: true,
  config: true,
  html: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TravelerCardTemplateSelect;

/** RAW_HTML gövdesini doğrula + temizle. Boş/aşırı uzun → 400. */
function shapeHtml(mode: TravelerTemplateMode, raw: unknown): string | null {
  if (mode !== TravelerTemplateMode.RAW_HTML) return null;
  if (typeof raw !== "string" || !raw.trim()) {
    throw AppError.badRequest("Uzman modunda şablon HTML'i boş olamaz.");
  }
  if (raw.length > MAX_HTML) {
    throw AppError.badRequest(`Şablon HTML'i çok uzun (en fazla ${MAX_HTML} karakter).`);
  }
  // Kayıtta da temizle: DB'de aktif içerik BARINDIRMASIN. Render tarafı da
  // ayrıca temizler (elle DB düzenlemesi / eski satır / geri yükleme yolları).
  return sanitizeTemplateHtml(raw);
}

export class TravelerTemplateService {
  /** Liste — silinmemiş şablonlar (varsayılan önce, sonra ada göre). */
  async list(): Promise<ApiResponse<unknown[]>> {
    const rows = await prisma.travelerCardTemplate.findMany({
      where: { deletedAt: null },
      select: TEMPLATE_SELECT,
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return { success: true, data: rows };
  }

  async findById(id: string): Promise<ApiResponse<unknown>> {
    const row = await prisma.travelerCardTemplate.findFirst({
      where: { id, deletedAt: null },
      select: TEMPLATE_SELECT,
    });
    if (!row) throw AppError.notFound("Şablon bulunamadı");
    return { success: true, data: row };
  }

  async create(input: TravelerTemplateInput, userId?: string): Promise<ApiResponse<unknown>> {
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) throw AppError.badRequest("Şablon adı gerekli");
    const mode = input.mode ?? TravelerTemplateMode.SECTIONS;
    const config = normalizeTravelerCardConfig(
      (input.config && typeof input.config === "object" ? input.config : {}) as Record<string, unknown>,
    );
    const html = shapeHtml(mode, input.html);

    const row = await prisma.travelerCardTemplate
      .create({
        data: {
          name,
          mode,
          config: config as unknown as Prisma.InputJsonValue,
          html,
          isActive: input.isActive !== false,
          // Varsayılanlık AYRI bir işlemdir (setDefault) — create'te true gelirse
          // partial unique 409 üretirdi ve kullanıcı "ad çakıştı" sanırdı.
          isDefault: false,
        },
        select: TEMPLATE_SELECT,
      })
      .catch(rethrowNameConflict);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: row.id,
      newData: { name: row.name, mode: row.mode },
    });
    return { success: true, data: row, message: `Şablon oluşturuldu: ${row.name}` };
  }

  async update(id: string, input: TravelerTemplateInput, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.travelerCardTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, mode: true },
    });
    if (!existing) throw AppError.notFound("Şablon bulunamadı");

    const data: Prisma.TravelerCardTemplateUpdateInput = {};
    if (input.name !== undefined) {
      const name = String(input.name).trim().slice(0, 80);
      if (!name) throw AppError.badRequest("Şablon adı boş olamaz");
      data.name = name;
    }
    // Mod değişebilir (uzman → yerleşiğe dönüş bir TIK olmalı). html şekli MODA
    // bağlı olduğu için ikisi birlikte çözülür; aksi halde SECTIONS'a dönen bir
    // şablonda eski ham HTML geride kalır ve mod geri alınınca sürpriz yapar.
    const nextMode = input.mode ?? existing.mode;
    if (input.mode !== undefined) data.mode = input.mode;
    if (input.mode !== undefined || input.html !== undefined) {
      data.html = shapeHtml(nextMode, input.html ?? null);
    }
    if (input.config !== undefined) {
      if (!input.config || typeof input.config !== "object") {
        throw AppError.badRequest("Şablon config nesne olmalı");
      }
      data.config = normalizeTravelerCardConfig(
        input.config as Record<string, unknown>,
      ) as unknown as Prisma.InputJsonValue;
    }
    if (typeof input.isActive === "boolean") data.isActive = input.isActive;

    const row = await prisma.travelerCardTemplate
      .update({ where: { id }, data, select: TEMPLATE_SELECT })
      .catch(rethrowNameConflict);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { name: existing.name, mode: existing.mode },
      newData: { name: row.name, mode: row.mode },
    });
    return { success: true, data: row, message: "Şablon güncellendi" };
  }

  /**
   * Varsayılanı DEĞİŞTİR — eski varsayılanı düşürüp yenisini işaretler, TEK tx.
   * Partial unique (`WHERE isDefault=true`) yüzünden sıra ÖNEMLİ: önce temizle,
   * sonra işaretle. Ters sırada iki satır anlık olarak true olur ve DB reddeder.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const row = await prisma.$transaction(async (tx) => {
      const target = await tx.travelerCardTemplate.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });
      if (!target) throw AppError.notFound("Şablon bulunamadı");
      if (!target.isActive) throw AppError.badRequest("Pasif şablon varsayılan yapılamaz.");
      await tx.travelerCardTemplate.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      return tx.travelerCardTemplate.update({
        where: { id },
        data: { isDefault: true },
        select: TEMPLATE_SELECT,
      });
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      newData: { isDefault: true },
    });
    return { success: true, data: row, message: `Varsayılan şablon: ${row.name}` };
  }

  /** Varsayılanlığı KALDIR — sistem yerleşik ayara döner (şablon silinmez). */
  async clearDefault(userId?: string): Promise<ApiResponse<null>> {
    // Hangi satırın varsayılanlığı düştü — audit'e YAZ (aksi halde "kim yerleşiğe
    // döndü" sorusunun cevabı kayıtta hiç olmaz).
    const prev = await prisma.travelerCardTemplate.findFirst({
      where: { isDefault: true },
      select: { id: true, name: true },
    });
    await prisma.travelerCardTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: prev?.id ?? "-",
      oldData: prev ? { name: prev.name, isDefault: true } : null,
      newData: { isDefault: false },
    });
    return { success: true, data: null, message: "Varsayılan şablon kaldırıldı — yerleşik kart basılacak." };
  }

  /**
   * Soft delete. BASILMIŞ KARTLARI ETKİLEMEZ: şablon karta dondurulduğu için
   * eski kartlar aynen yeniden basılabilir. Varsayılan şablon silinirse
   * varsayılanlık da düşer (yoksa "silinmiş ama varsayılan" hayaleti kalırdı).
   */
  async remove(id: string, userId?: string): Promise<ApiResponse<null>> {
    const existing = await prisma.travelerCardTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!existing) throw AppError.notFound("Şablon bulunamadı");
    await prisma.travelerCardTemplate.update({
      where: { id },
      // Ad benzersizliği: silinmiş şablonun adı serbest kalsın (label_templates
      // DEL- öneki emsali) — aksi halde aynı adla yeni şablon açılamazdı.
      data: { deletedAt: new Date(), isDefault: false, name: `DEL-${Date.now()}-${existing.name}`.slice(0, 80) },
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: TABLE,
      recordId: id,
      oldData: { name: existing.name },
    });
    return { success: true, data: null, message: `Şablon silindi: ${existing.name}` };
  }

  /**
   * BASKI ÇÖZÜMÜ: açık seçim > varsayılan > sistem ayarı (yerleşik).
   * `templateId` verilmiş ama çözülemiyorsa FAIL-CLOSED (404) — yerleşiğe sapmaz.
   */
  async resolveForPrint(
    templateId?: string | null,
    /** Kart snapshot'ı bir tx içinde kurulduğunda AYNI client geçilir — okuma
     *  ayrı bağlantıya kaçmasın (tx uzunluğu kısa: tek indexli satır). */
    client: Pick<typeof prisma, "travelerCardTemplate" | "systemSetting"> = prisma,
  ): Promise<{ template: ResolvedTravelerTemplate; config: TravelerCardConfig }> {
    if (templateId) {
      const row = await client.travelerCardTemplate.findFirst({
        where: { id: templateId, deletedAt: null, isActive: true },
        select: { id: true, name: true, mode: true, config: true, html: true },
      });
      if (!row) {
        throw AppError.notFound(
          "Seçilen refakat kartı şablonu bulunamadı veya pasif — şablonu düzeltin ya da yerleşik karta dönün.",
        );
      }
      return {
        template: { id: row.id, name: row.name, mode: row.mode, html: row.html },
        config: normalizeTravelerCardConfig((row.config ?? {}) as Record<string, unknown>),
      };
    }

    const def = await client.travelerCardTemplate.findFirst({
      where: { isDefault: true, deletedAt: null, isActive: true },
      select: { id: true, name: true, mode: true, config: true, html: true },
    });
    if (def) {
      return {
        template: { id: def.id, name: def.name, mode: def.mode, html: def.html },
        config: normalizeTravelerCardConfig((def.config ?? {}) as Record<string, unknown>),
      };
    }

    // Şablon yok → yerleşik: sistem ayarı. Faz 2 öncesiyle BİREBİR aynı davranış.
    return {
      template: { id: null, name: "Yerleşik", mode: TravelerTemplateMode.BUILTIN, html: null },
      config: await readTravelerCardConfig(client),
    };
  }

  /**
   * Stüdyo kayıt kapısı için ön-denetim: neyin kesileceği + bilinmeyen alanlar.
   * UYARI üretir, hata DEĞİL — bilinmeyen anahtar boş basar, baskı durmaz
   * (bkz. `config/traveler-card-fields` başlığı).
   */
  inspect(html: string): { stripped: string[]; unknownKeys: string[] } {
    return { stripped: describeSanitization(html), unknownKeys: findUnknownKeys(html) };
  }
}

/** Ad çakışması (@@unique(name)) → anlamlı 409. */
function rethrowNameConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw AppError.conflict("Bu adda bir şablon zaten var.");
  }
  throw err;
}

export const travelerTemplateService = new TravelerTemplateService();
