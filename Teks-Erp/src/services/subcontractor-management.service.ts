// =============================================================================
// TeksERP - Subcontractor Management Service
// =============================================================================
// Subcontractor (Fason firma) ve SubcontractorCategory CRUD.
// Sevk/Mal kabul işlemleri için subcontractor.service.ts'e bakın.
// =============================================================================

import prisma from "../lib/prisma";
import { normalizeDisplayName } from "./helpers/name-normalize.helper";
import { Prisma } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import { validateName, validateCode } from "../lib/string-validators";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { foldCodeForCompare } from "../utils/code-format";
import {
  decideCodeUniqueness,
  assertCodeAvailable,
  type CodeCandidate,
  type CodeUniquenessTexts,
} from "./helpers/code-unique.helper";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  resolveSortBy,
} from "../utils/query-parser";
import { Request } from "express";

/**
 * Ad-mükerrer koruması (Türkçe-duyarsız; BaseService.assertNameNotDuplicate
 * emsali — bu servisler BaseService kullanmadığından yerel eş). Pasif kayıt da
 * sayılır (yenisini eklemek yerine aktifleştirme önerilir); excludeId reactivate/
 * update'te kaydın kendisini hariç tutar.
 *
 * 2026-08-19: tam tablo taraması + JS katlaması yerine `nameFold` gölge kolonu
 * (indexli `findFirst`). Katlama artık ASCII'ye de iner, yani "ŞAHİN ZIMPARA"
 * ile "SAHIN ZIMPARA" aynı firma sayılır (kullanıcı kararı D3).
 */
async function assertSubNameAvailable(
  model: "subcontractor" | "subcontractorCategory",
  label: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  if (!name || name.trim().length === 0) return;
  const target = foldNameForCompare(name);
  // ⚠️ Fason firmada BİRLEŞTİRİLMİŞ (tombstone) kayıt aday DEĞİL — `BaseService`
  // tarafındaki ikizinin birebir aynısı ve sebebi de aynı: aksi hâlde guard, az
  // önce birleştirilen firma için *"PASİF kayıt var, aktifleştirin"* der ve
  // operatörü tombstone'u DİRİLTMEYE davet eder. Kategoride soy bağı yok, o
  // yüzden koşul yalnız firma dalında anlamlı — `undefined` yayılmaz.
  const lineage = model === "subcontractor" ? { mergedIntoId: null } : {};
  const where = { nameFold: target, ...lineage, ...(excludeId ? { id: { not: excludeId } } : {}) };
  const select = { name: true, code: true, isActive: true } as const;
  // Aktif eş varsa ONU göster — mesaj "zaten var" ↔ "PASİF, aktifleştirin"
  // arasında ayrışıyor ve operatöre yapılacak işi söylemeli.
  const orderBy = [{ isActive: "desc" as const }, { createdAt: "asc" as const }];
  const hit: { name: string; code: string; isActive: boolean } | null =
    model === "subcontractor"
      ? await prisma.subcontractor.findFirst({ where, select, orderBy })
      : await prisma.subcontractorCategory.findFirst({ where, select, orderBy });
  if (!hit) return;
  throw AppError.conflict(
    hit.isActive
      ? `'${name.trim()}' adında bir ${label} zaten var (kod: ${hit.code}). Aynı ${label} ikinci kez eklenemez.`
      : `'${name.trim()}' adında PASİF bir ${label} zaten var (kod: ${hit.code}). Yenisini eklemek yerine mevcut kaydı aktifleştirin.`,
  );
}

/**
 * KOD tekilliği (§18, 2026-08-15) — bu iki servis BaseService kullanmadığından
 * tekilliğin kendi kopyasını taşıyor ve o kopya `findFirst({ where: { code } })`
 * ile TAM EŞLEŞME arıyordu: `BOYER` ile `boyer` iki ayrı kimlik sayılıyordu.
 * Kod bu sistemde KİMLİKTİR — harf büyüklüğü kimlik farkı değildir. Gerekçe +
 * kapsam + tarihsel kayıt politikası: `helpers/code-unique.helper.ts` başlığı.
 *
 * Adaylar tek select ile çekilir (fason tabloları onlarca satır), katlama JS'te.
 */
async function loadSubCodeCandidates(
  model: "subcontractor" | "subcontractorCategory",
  excludeId?: string,
): Promise<CodeCandidate[]> {
  const where = excludeId ? { id: { not: excludeId } } : {};
  const select = { id: true, code: true, name: true, isActive: true } as const;
  return model === "subcontractor"
    ? prisma.subcontractor.findMany({ where, select })
    : prisma.subcontractorCategory.findMany({ where, select });
}

const SUB_CODE_TEXTS: CodeUniquenessTexts = {
  // Eski cümle korunur; yeni bilgi arkasına eklenir. (Eskiden 400 dönüyordu —
  // F43 standardı duplicate = 409 Conflict der, helper onu uygular.)
  activeExactLead: "Bu kod ile aktif fason firma zaten var",
  entityLabel: "fason firma",
};
const SUB_CATEGORY_CODE_TEXTS: CodeUniquenessTexts = {
  activeExactLead: "Bu kod ile aktif kategori zaten var",
  entityLabel: "fason kategorisi",
};

/**
 * Aynı vergi numaralı (VKN/TCKN) ikinci fason firmaya izin verme (müşteri
 * emsali). Değer normalize sonrası birebir karşılaştırılır.
 *
 * ⚠️ 2026-08-19: PASİF kayıtlar da sayılır. Öncesinde `isActive: true` süzgeci
 * vardı ve aynı dosyadaki AD guard'ı pasifleri sayıyordu — yani pasif bir
 * firmanın ADI korunuyor ama VERGİ NUMARASI serbest kalıyordu. Aynı vergi
 * numarasıyla ikinci kayıt açıldığında ilk firma yeniden aktifleştirilemez
 * hâle gelirdi. İki guard artık aynı politikayı uygular.
 */
async function assertSubTaxAvailable(taxNumber: unknown, excludeId?: string): Promise<void> {
  if (typeof taxNumber !== "string" || taxNumber.trim().length === 0) return;
  const value = taxNumber.trim();
  const existing = await prisma.subcontractor.findFirst({
    where: { taxNumber: value, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { code: true, name: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  if (!existing) return;
  throw AppError.conflict(
    existing.isActive
      ? `'${value}' vergi numarası '${existing.name}' (${existing.code}) fason firmasında zaten kayıtlı. Aynı vergi no ile ikinci firma açılamaz.`
      : `'${value}' vergi numarası PASİF '${existing.name}' (${existing.code}) fason firmasında kayıtlı. Yenisini eklemek yerine mevcut kaydı aktifleştirin.`,
  );
}

// =============================================================================
// SUBCONTRACTOR CATEGORY (Boyahane, Yıkama, Zımpara...)
// =============================================================================

export class SubcontractorCategoryService {
  async findAll(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where = buildWhereClause(params.filters, ["name"], params.search, ["code"]);
    // F90: sortBy verilmediğinde name/asc default; explicit createdAt saygı görür;
    // bilinmeyen sortBy 500 yerine name'e düşer. (Eski çift-ternary HER createdAt'i
    // — explicit olanı bile — name/asc'a zorluyordu.)
    const rawSortBy = req.query.sortBy as string | undefined;
    const orderBy = buildOrderByClause(
      resolveSortBy(rawSortBy, ["code", "name", "createdAt"], "name"),
      rawSortBy ? params.sortOrder : "asc",
    );
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.subcontractorCategory.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { subcontractors: true, workOrderSteps: true } } },
      }),
      prisma.subcontractorCategory.count({ where }),
    ]);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  async findById(id: string): Promise<ApiResponse<unknown>> {
    const cat = await prisma.subcontractorCategory.findUnique({
      where: { id },
      include: {
        subcontractors: {
          include: { subcontractor: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!cat) throw AppError.notFound("Kategori bulunamadı");
    return { success: true, data: cat };
  }

  async create(
    data: {
      code: string;
      name: string;
      description?: string;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // §18: kod tekilliği harf-duyarsız. TAM eşleşmeli aktif kayıt → 409; TAM
    // eşleşmeli pasif kayıt → diriltme; YALNIZ harf farkıyla eşleşme → 409
    // (diriltme yok — gerekçe `decideCodeUniqueness` docstring'inde).
    const decision = decideCodeUniqueness(
      data.code,
      await loadSubCodeCandidates("subcontractorCategory"),
      SUB_CATEGORY_CODE_TEXTS,
    );
    const existing = decision.kind === "REACTIVATE" ? decision.target : null;
    await assertSubNameAvailable(
      "subcontractorCategory",
      "fason kategorisi",
      data.name,
      existing ? existing.id : undefined,
    );

    const cat = existing
      ? await prisma.subcontractorCategory.update({
          where: { id: existing.id },
          data: { ...data, isActive: true },
        })
      : await prisma.subcontractorCategory.create({
          // Künye (Faz A2)
          data: { ...data, createdById: userId ?? null, updatedById: userId ?? null },
        });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: cat.id,
      newData: {
        code: cat.code,
        name: cat.name,
        appliesColor: cat.appliesColor,
        appliesProperty: cat.appliesProperty,
        ...(existing ? { reactivated: true } : {}),
      },
    });
    return {
      success: true,
      data: cat,
      message: existing
        ? `Pasif kategori yeniden aktive edildi: ${cat.name}`
        : `Kategori oluşturuldu: ${cat.name}`,
    };
  }

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      description?: string | null;
      isActive?: boolean;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // F94: mutasyon öncesi before-state — audit oldData boş kalmasın.
    const before = await prisma.subcontractorCategory.findUnique({
      where: { id },
      select: { code: true, name: true, description: true, isActive: true, appliesColor: true, appliesProperty: true },
    });
    // Ad-mükerrer kontrolü yalnız ad gerçekten değişirken (tarihsel mükerrer
    // kayıt düzenlenebilir kalsın). Kayıt yoksa atla — 409 yerine not-found dönsün.
    if (
      typeof data.name === "string" &&
      before &&
      foldNameForCompare(data.name) !== foldNameForCompare(before.name)
    ) {
      await assertSubNameAvailable("subcontractorCategory", "fason kategorisi", data.name, id);
    }
    // §18: kod tekilliği — YALNIZ kod gerçekten (katlanmış hâliyle) değişirken.
    // Tarihsel ikizin kendisi düzenlenebilir kalsın diye ad guard'ıyla aynı kural.
    if (
      typeof data.code === "string" &&
      before &&
      foldCodeForCompare(data.code) !== foldCodeForCompare(before.code)
    ) {
      assertCodeAvailable(
        data.code,
        await loadSubCodeCandidates("subcontractorCategory", id),
        SUB_CATEGORY_CODE_TEXTS,
      );
    }
    const cat = await prisma.subcontractorCategory.update({ where: { id }, data });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: id,
      oldData: before ?? null,
      newData: data as Record<string, unknown>,
    });
    return { success: true, data: cat, message: "Kategori güncellendi" };
  }

  async remove(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    // F94: soft-delete öncesi before-state.
    const before = await prisma.subcontractorCategory.findUnique({
      where: { id },
      select: { code: true, name: true, description: true, isActive: true, appliesColor: true, appliesProperty: true },
    });
    // Soft delete — bağlı subcontractor veya step varsa veriyi koruyoruz
    const cat = await prisma.subcontractorCategory.update({
      where: { id },
      data: { isActive: false },
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: id,
      oldData: before ?? null,
    });
    return { success: true, data: cat, message: "Kategori pasife alındı" };
  }
}

// =============================================================================
// SUBCONTRACTOR (Fason firma)
// =============================================================================

/**
 * Subcontractor giriş alanları için format kontrolleri.
 * `taxNumber` regex'i `CustomerService` ile aynı (10-15 hane sayı; VKN/TCKN/
 * yabancı VAT). `phone` ve `address` için minimum gerçeklik kontrolü —
 * seed verisinde `phone:"1", address:"1"` gibi çöp değerler vardı.
 *
 * Helper'lar saf fonksiyon: hem create hem update'ten çağrılıyor. Üçü de
 * `null`'a izin verir (alan optional, schema `String?`).
 */
const SUB_TAX_REGEX = /^\d{10,15}$/;
const SUB_PHONE_REGEX = /^[+0-9 ()/-]{7,20}$/;
const SUB_ADDRESS_MIN_LENGTH = 5;

function normalizeAndValidateTaxNumber(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Vergi numarası metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!SUB_TAX_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      "Vergi numarası 10-15 hane sayı olmalı (VKN: 10, TCKN: 11)"
    );
  }
  return trimmed;
}

function normalizeAndValidatePhone(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Telefon metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!SUB_PHONE_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      "Telefon 7-20 karakter olmalı (sayılar, +, boşluk, parantez, tire, eğik çizgi)"
    );
  }
  return trimmed;
}

function normalizeAndValidateAddress(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Adres metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length < SUB_ADDRESS_MIN_LENGTH) {
    throw AppError.badRequest(
      `Adres en az ${SUB_ADDRESS_MIN_LENGTH} karakter olmalı`
    );
  }
  return trimmed;
}

/**
 * F88: categoryIds var-mı + isActive doğrulaması (dedupe) — pasif kategoriye bağ
 * kurulmasını, olmayan UUID'nin belirsiz P2003'ünü ve mükerrer UUID'nin P2002'sini önler.
 */
async function assertActiveCategories(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = await tx.subcontractorCategory.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const ok = new Set(found.map((c) => c.id));
    const invalid = unique.filter((id) => !ok.has(id));
    throw AppError.badRequest(`Geçersiz veya pasif fason kategorisi: ${invalid.join(", ")}`);
  }
  return unique;
}

export class SubcontractorManagementService {
  async findAll(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);

    // Standart filtreler (isActive, code...) buildWhereClause halleder
    // `taxNumber` KOD kovasında: rakam alanıdır, katlanmaz ve bir firma ADI
    // aramasında boşuna koşmaz.
    const where = buildWhereClause(params.filters, ["name"], params.search, ["code", "taxNumber"]);

    // categoryId filter — relation üzerinden M:N filter. F92: dizi | CSV | tek değeri
    // normalize et (birden çok kategori seçimi de çalışsın; tek → eşitlik, çok → {in}).
    const rawCategoryId = params.filters["categoryId"];
    const catIds = (Array.isArray(rawCategoryId) ? rawCategoryId : String(rawCategoryId ?? "").split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (catIds.length > 0) {
      (where as Record<string, unknown>).categories = {
        some: { categoryId: catIds.length === 1 ? catIds[0] : { in: catIds } },
      };
    }
    delete (where as Record<string, unknown>).categoryId;

    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.subcontractor.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          categories: { include: { category: true } },
        },
      }),
      prisma.subcontractor.count({ where }),
    ]);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  async findById(id: string): Promise<ApiResponse<unknown>> {
    const sub = await prisma.subcontractor.findUnique({
      where: { id },
      include: {
        categories: { include: { category: true } },
      },
    });
    if (!sub) throw AppError.notFound("Fason firma bulunamadı");
    return { success: true, data: sub };
  }

  async create(
    data: {
      code: string;
      name: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isFavorite?: boolean;
      categoryIds?: string[];
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds = [], ...rest } = data;
    const payload: {
      code: string;
      name: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isFavorite?: boolean;
      // Ad BÜYÜK normalize edilir (2026-08-19) — mükerrer kontrolü aynı
      // katlamayı kullanıyor; depolanan biçim ondan ayrışırsa kontrol kendi
      // yazdığı kaydı bulamaz.
    } = { code: rest.code, name: normalizeDisplayName(rest.name) };

    // Required + length kontrolleri (paylaşımlı validator)
    const code = validateCode(rest.code, { label: "Fason kodu", required: true });
    if (typeof code === "string") payload.code = code;
    const name = validateName(rest.name, { label: "Fason adı", required: true });
    if (typeof name === "string") payload.name = normalizeDisplayName(name);

    // Format validasyonları — create'te tüm 3 alan optional, ama verilirse
    // format şartı uygulanır. Boş/null gelirse null'a normalize edilir.
    const tax = normalizeAndValidateTaxNumber(rest.taxNumber);
    if (tax !== undefined) payload.taxNumber = tax;
    const phone = normalizeAndValidatePhone(rest.phone);
    if (phone !== undefined) payload.phone = phone;
    const address = normalizeAndValidateAddress(rest.address);
    if (address !== undefined) payload.address = address;
    if (typeof rest.isFavorite === "boolean") payload.isFavorite = rest.isFavorite;

    // §18: kod tekilliği harf-duyarsız. TAM eşleşmeli aktif kayıt → 409; TAM
    // eşleşmeli pasif kayıt → diriltme; YALNIZ harf farkıyla eşleşme → 409
    // (diriltme yok — gerekçe `decideCodeUniqueness` docstring'inde).
    const decision = decideCodeUniqueness(
      payload.code,
      await loadSubCodeCandidates("subcontractor"),
      SUB_CODE_TEXTS,
    );
    const existing = decision.kind === "REACTIVATE" ? decision.target : null;
    await assertSubNameAvailable(
      "subcontractor",
      "fason firma",
      payload.name,
      existing ? existing.id : undefined,
    );
    if (payload.taxNumber != null) {
      await assertSubTaxAvailable(payload.taxNumber, existing ? existing.id : undefined);
    }

    const sub = await prisma.$transaction(async (tx) => {
      let createdId: string;
      if (existing) {
        // F87: reaktivasyonu atomik claim'e çevir — eşzamanlı iki istek birbirini
        // sessizce ezmesin; kaybeden 'aktif zaten var' 409 alır.
        const claim = await tx.subcontractor.updateMany({
          where: { id: existing.id, isActive: false },
          data: { ...payload, isActive: true },
        });
        if (claim.count === 0) {
          throw AppError.conflict("Bu kod ile aktif fason firma zaten var");
        }
        await tx.subcontractorToCategory.deleteMany({
          where: { subcontractorId: existing.id },
        });
        createdId = existing.id;
      } else {
        // Kayıt künyesi (2026-08-19) — BaseService dışı servis, elle yazılır.
        const c = await tx.subcontractor.create({
          data: { ...payload, createdById: userId ?? null, updatedById: userId ?? null },
          select: { id: true },
        });
        createdId = c.id;
      }
      // F88: kategori doğrulama (var + aktif + dedupe) createMany ÖNCESİ.
      const uniqueCategoryIds = await assertActiveCategories(tx, categoryIds);
      if (uniqueCategoryIds.length > 0) {
        await tx.subcontractorToCategory.createMany({
          data: uniqueCategoryIds.map((categoryId) => ({
            subcontractorId: createdId,
            categoryId,
          })),
        });
      }
      return tx.subcontractor.findUnique({
        where: { id: createdId },
        include: { categories: { include: { category: true } } },
      });
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: "SUBCONTRACTOR",
      recordId: sub!.id,
      newData: {
        code: sub!.code,
        name: sub!.name,
        categoryIds,
        ...(existing ? { reactivated: true } : {}),
      },
    });

    return {
      success: true,
      data: sub,
      message: existing
        ? `Pasif fason firma yeniden aktive edildi: ${sub!.name}`
        : `Fason firma oluşturuldu: ${sub!.name}`,
    };
  }

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isActive?: boolean;
      isFavorite?: boolean;
      categoryIds?: string[]; // verilirse mevcut kategoriler tamamen değişir
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds, ...rest } = data;

    // F94: mutasyon öncesi before-state — audit oldData boş kalmasın.
    const before = await prisma.subcontractor.findUnique({
      where: { id },
      select: { code: true, name: true, taxNumber: true, phone: true, address: true, isActive: true, isFavorite: true },
    });

    // Update'te her alan tamamen optional. Gönderilmemişse undefined kalır
    // (Prisma update no-op). Gönderildiyse format şartı uygulanır; sonuç
    // (string ya da null) doğrudan yazılır.
    if (rest.code !== undefined) {
      const v = validateCode(rest.code, { label: "Fason kodu", required: true });
      if (typeof v === "string") rest.code = v;
    }
    if (rest.name !== undefined) {
      const v = validateName(rest.name, { label: "Fason adı", required: true });
      if (typeof v === "string") rest.name = v;
    }
    if (rest.taxNumber !== undefined) {
      rest.taxNumber = normalizeAndValidateTaxNumber(rest.taxNumber) as string | null;
    }
    if (rest.phone !== undefined) {
      rest.phone = normalizeAndValidatePhone(rest.phone) as string | null;
    }
    if (rest.address !== undefined) {
      rest.address = normalizeAndValidateAddress(rest.address) as string | null;
    }

    // Ad-mükerrer kontrolü yalnız ad gerçekten değişirken (tarihsel mükerrer
    // kayıt düzenlenebilir kalsın). Kayıt yoksa atla — 409 yerine not-found dönsün.
    if (
      typeof rest.name === "string" &&
      before &&
      foldNameForCompare(rest.name) !== foldNameForCompare(before.name)
    ) {
      await assertSubNameAvailable("subcontractor", "fason firma", rest.name, id);
    }
    // §18: kod tekilliği — YALNIZ kod gerçekten (katlanmış hâliyle) değişirken
    // (tarihsel ikiz düzenlenebilir kalsın; ad guard'ıyla aynı kural).
    if (
      typeof rest.code === "string" &&
      before &&
      foldCodeForCompare(rest.code) !== foldCodeForCompare(before.code)
    ) {
      assertCodeAvailable(
        rest.code,
        await loadSubCodeCandidates("subcontractor", id),
        SUB_CODE_TEXTS,
      );
    }
    // Vergi no yalnız gerçekten değişirken kontrol (tarihsel mükerrer düzenlenebilir).
    if (
      typeof rest.taxNumber === "string" &&
      rest.taxNumber.trim().length > 0 &&
      before &&
      rest.taxNumber.trim() !== (before.taxNumber ?? null)
    ) {
      await assertSubTaxAvailable(rest.taxNumber, id);
    }

    const sub = await prisma.$transaction(async (tx) => {
      await tx.subcontractor.update({ where: { id }, data: { ...rest, updatedById: userId ?? null } });

      if (categoryIds !== undefined) {
        await tx.subcontractorToCategory.deleteMany({ where: { subcontractorId: id } });
        // F88: kategori doğrulama (var + aktif + dedupe) createMany öncesi.
        const uniqueCategoryIds = await assertActiveCategories(tx, categoryIds);
        if (uniqueCategoryIds.length > 0) {
          await tx.subcontractorToCategory.createMany({
            data: uniqueCategoryIds.map((categoryId) => ({
              subcontractorId: id,
              categoryId,
            })),
          });
        }
      }

      return tx.subcontractor.findUnique({
        where: { id },
        include: { categories: { include: { category: true } } },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR",
      recordId: id,
      oldData: before ?? null,
      // F94: normalize edilmiş değerleri logla (ham `data` değil) — kategoriler dahil.
      newData: { ...rest, categoryIds } as Record<string, unknown>,
    });

    return { success: true, data: sub, message: "Fason firma güncellendi" };
  }

  async remove(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    // F94: soft-delete öncesi before-state.
    const before = await prisma.subcontractor.findUnique({
      where: { id },
      select: { code: true, name: true, taxNumber: true, phone: true, address: true, isActive: true, isFavorite: true },
    });
    const sub = await prisma.subcontractor.update({
      where: { id },
      data: { isActive: false },
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SUBCONTRACTOR",
      recordId: id,
      oldData: before ?? null,
    });
    return { success: true, data: sub, message: "Fason firma pasife alındı" };
  }
}
