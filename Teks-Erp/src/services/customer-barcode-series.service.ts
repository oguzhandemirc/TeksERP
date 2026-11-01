// =============================================================================
// MÜŞTERİ BARKOD SERİSİ — tanım · biçim değişimi · önizleme (D4-F2, DALGA4 §7.4)
// =============================================================================
// Müşteri başına TEK seri (`customerId @unique`). Yaratma replay'i token boğazından (R); biçim değişimi
// `updatedAt` üstünde atomik claim (her alan değişimi ilerletir; 0 → 409 SERIES_CHANGED). Görünür biçim değişimi
// yalnız YENİ kodu etkiler: sayaç kapsamı `formatChangedAt`i içerir (`helpers/customer-code-birth.helper.ts`).
// Başlangıç/üst sınır sayaç ayarıdır, `formatChangedAt`i yenilemez (yeni kapsam yine doğar, tohum eski kodların üstünden).
// =============================================================================
import { NumberSeriesDateSegment, type CustomerBarcodeSeries } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import type { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import {
  customerCodeCollidesWithOurs,
  customerSeriesFormat,
  peekCustomerSeriesCode,
  peekCustomerSeriesSeq,
} from "./helpers/customer-code-birth.helper";
import { formatSeriesCode } from "./helpers/series-format.helper";
import { tokenReplay } from "./helpers/token-replay.helper";

const TABLE = "CUSTOMER_BARCODE_SERIES";
/** Replay/değişiklik-yok cevabı işaretlenir (route 201 yerine 200 döner). */
type SeriesResponse<T> = ApiResponse<T> & { idempotent?: boolean };
const FORMAT_FIELDS = ["prefix", "dateSegment", "digits", "separator", "startValue", "maxValue"] as const;
/** Kodun GÖRÜNÜR biçimi — yalnız bunlar değişince `formatChangedAt` yenilenir. */
/** Henüz serisi olmayan müşteride önizleme tohumu — hiçbir kod bu seriye bağlı değildir. */
const NO_SERIES_ID = "00000000-0000-0000-0000-000000000000";
const VISIBLE_FORMAT_FIELDS = ["prefix", "dateSegment", "digits", "separator"] as const;

const formatShape = {
  prefix: z
    .string({ error: "Ön ek zorunlu" })
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{1,16}$/, "Ön ek 1–16 karakter, yalnız harf (A–Z) ve rakam olmalı")),
  dateSegment: z.enum(NumberSeriesDateSegment, { error: "Tarih parçası geçersiz" }),
  digits: z.number({ error: "Hane sayısı sayı olmalı" }).int().min(1, "Hane sayısı en az 1").max(10, "Hane sayısı en çok 10"),
  separator: z.enum(["", "-", "/", ".", "_"], { error: "Ayraç boş, -, /, . ya da _ olmalı" }),
  startValue: z.number({ error: "Başlangıç sayı olmalı" }).int().min(1, "Başlangıç en az 1").nullable(),
  maxValue: z.number({ error: "Üst sınır sayı olmalı" }).int().min(1, "Üst sınır en az 1").nullable(),
};
const createSchema = z.strictObject({ ...formatShape, clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }) });
const updateSchema = z.strictObject({
  ...formatShape,
  isActive: z.boolean({ error: "Etkinlik true/false olmalı" }),
  expectedUpdatedAt: z.iso.datetime({ error: "expectedUpdatedAt ISO tarih olmalı", offset: true }),
});
const previewSchema = z.strictObject(formatShape).partial();

type FormatInput = Omit<z.infer<z.ZodObject<typeof formatShape>>, "separator"> & { separator: string };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw AppError.badRequest(r.error.issues.map((i) => i.message).join(" · "), { code: "VALIDATION_ERROR", issues: r.error.issues });
  }
  return r.data;
}

async function assertCustomer(customerId: string): Promise<void> {
  if (!z.uuid().safeParse(customerId).success) throw AppError.notFound("Müşteri bulunamadı", { customerId });
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { mergedIntoId: true } });
  if (!c || c.mergedIntoId) throw AppError.notFound("Müşteri bulunamadı", { customerId });
}

/** Biçim kapıları: sınırlar tutarlı, kod 64 karakteri aşmaz, ilk kod bizim iç biçimimizle çakışmaz. */
async function assertFormatUsable(fmt: FormatInput): Promise<string> {
  if (fmt.startValue != null && fmt.maxValue != null && fmt.maxValue < fmt.startValue) {
    throw AppError.badRequest("Üst sınır başlangıçtan küçük olamaz", { code: "VALIDATION_ERROR" });
  }
  const sample = formatSeriesCode(customerSeriesFormat({ ...fmt, formatChangedAt: null }), fmt.startValue ?? 1, new Date());
  if (sample.length > 64) throw AppError.badRequest("Üretilecek kod 64 karakteri aşıyor", { code: "VALIDATION_ERROR" });
  if (await customerCodeCollidesWithOurs(prisma, sample)) {
    throw AppError.conflict(`"${sample}" bizim barkod biçimimizle çakışıyor — başka bir ön ek seçin.`, {
      code: "CUSTOMER_CODE_COLLIDES",
      scannedCode: sample,
    });
  }
  return sample;
}

function sameFormat(a: Pick<CustomerBarcodeSeries, (typeof FORMAT_FIELDS)[number]>, b: FormatInput): boolean {
  return FORMAT_FIELDS.every((k) => a[k] === b[k]);
}

function formatAudit(s: Pick<CustomerBarcodeSeries, (typeof FORMAT_FIELDS)[number]>): Record<string, unknown> {
  return Object.fromEntries(FORMAT_FIELDS.map((k) => [k, s[k]]));
}

const createReplay = (expect: { customerId: string; fmt: FormatInput }) =>
  tokenReplay<CustomerBarcodeSeries, SeriesResponse<CustomerBarcodeSeries>>({
    find: (db, clientToken) => db.customerBarcodeSeries.findUnique({ where: { clientToken } }),
    alive: { neverDies: "seri silinmez; pasife alma durum geçişidir ve yaratma replay'i yine aynı seriyi döner" },
    identity: (prior) => [
      { ad: "customerId", mevcut: prior.customerId, gelen: expect.customerId },
      { ad: "prefix", mevcut: prior.prefix, gelen: expect.fmt.prefix },
      { ad: "dateSegment", mevcut: prior.dateSegment, gelen: expect.fmt.dateSegment },
      { ad: "digits", mevcut: prior.digits, gelen: expect.fmt.digits },
      { ad: "separator", mevcut: prior.separator, gelen: expect.fmt.separator },
      { ad: "startValue", mevcut: prior.startValue, gelen: expect.fmt.startValue },
      { ad: "maxValue", mevcut: prior.maxValue, gelen: expect.fmt.maxValue },
    ],
    collision: "Bu kayıt kimliği başka bir seri tanımı için kullanılmış — formu yeniden açıp kaydedin.",
    collisionEk: (prior) => ({ seriesId: prior.id }),
    respond: (prior) => ({ success: true, data: prior, message: "Barkod serisi zaten tanımlı", idempotent: true }),
  });

async function createFresh(customerId: string, fmt: FormatInput, clientToken: string, userId?: string): Promise<SeriesResponse<CustomerBarcodeSeries>> {
  await assertFormatUsable(fmt);
  let row: CustomerBarcodeSeries;
  try {
    row = await prisma.customerBarcodeSeries.create({ data: { customerId, ...fmt, clientToken, createdById: userId ?? null } });
  } catch (e) {
    if (isClientTokenP2002(e)) throw e;
    if (p2002Mentions(e, /customerId/i)) {
      throw AppError.conflict("Bu müşterinin zaten bir barkod serisi var — biçimi değiştirmek için mevcut seriyi düzenleyin.", {
        code: "CUSTOMER_SERIES_EXISTS",
        customerId,
      });
    }
    throw e;
  }
  await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: row.id, newData: { customerId, ...formatAudit(row) } }).catch(() => undefined);
  return { success: true, data: row, message: "Barkod serisi tanımlandı" };
}

export interface CustomerBarcodeSeriesView {
  series: CustomerBarcodeSeries | null;
  /** Sıradaki kod (sayacı tüketmeden); seri yoksa null. */
  nextCode: string | null;
}

export class CustomerBarcodeSeriesService {
  /** GET /api/customers/:id/barcode-series */
  static async get(customerId: string): Promise<ApiResponse<CustomerBarcodeSeriesView>> {
    await assertCustomer(customerId);
    const series = await prisma.customerBarcodeSeries.findUnique({ where: { customerId } });
    const nextCode = series ? await peekCustomerSeriesCode(prisma, series) : null;
    return { success: true, data: { series, nextCode } };
  }

  /** POST /api/customers/:id/barcode-series — seri tanımı; `clientToken` zorunlu (aynı token → aynı seri). */
  static async create(customerId: string, body: unknown, userId?: string): Promise<SeriesResponse<CustomerBarcodeSeries>> {
    await assertCustomer(customerId);
    const { clientToken, ...fmt } = parse(createSchema, body);
    return createReplay({ customerId, fmt }).run(clientToken, () => createFresh(customerId, fmt, clientToken, userId));
  }

  /**
   * PUT /api/customers/:id/barcode-series — biçim/etkinlik değişimi. Aynı içerik → değişiklik yok (200, idempotent).
   * Görünür biçim değişirse `formatChangedAt` yenilenir (sayaç yeni biçimden); eski kodlar değişmez.
   * Claim `updatedAt` üstünde: eşzamanlı iki PUT'tan (yalnız etkinlik değişimi dahil) biri 409 alır.
   */
  static async update(customerId: string, body: unknown, userId?: string): Promise<SeriesResponse<CustomerBarcodeSeries>> {
    await assertCustomer(customerId);
    const { expectedUpdatedAt, isActive, ...fmt } = parse(updateSchema, body);
    const current = await prisma.customerBarcodeSeries.findUnique({ where: { customerId } });
    if (!current) throw AppError.notFound("Bu müşterinin barkod serisi yok", { code: "CUSTOMER_SERIES_NOT_FOUND", customerId });
    const formatChanged = !sameFormat(current, fmt);
    if (!formatChanged && current.isActive === isActive) {
      return { success: true, data: current, message: "Barkod serisinde değişiklik yok", idempotent: true };
    }
    if (formatChanged) await assertFormatUsable(fmt);
    const visibleChanged = VISIBLE_FORMAT_FIELDS.some((k) => current[k] !== fmt[k]);
    const now = new Date();
    const claimed = await prisma.customerBarcodeSeries.updateMany({
      where: { id: current.id, updatedAt: new Date(expectedUpdatedAt) },
      data: { ...fmt, isActive, ...(visibleChanged ? { formatChangedAt: now } : {}) },
    });
    if (claimed.count === 0) {
      throw AppError.conflict("Barkod serisi bu sırada başka biri tarafından değiştirildi — sayfayı yenileyip tekrar deneyin.", {
        code: "SERIES_CHANGED",
        seriesId: current.id,
      });
    }
    const row = await prisma.customerBarcodeSeries.findUniqueOrThrow({ where: { id: current.id } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: row.id,
      oldData: { ...formatAudit(current), isActive: current.isActive },
      newData: { customerId, ...formatAudit(row), isActive: row.isActive, formatChanged: visibleChanged },
    }).catch(() => undefined);
    return { success: true, data: row, message: visibleChanged ? "Barkod serisi biçimi değişti — yeni kodlar yeni biçimden" : "Barkod serisi güncellendi" };
  }

  /**
   * POST /api/customers/:id/barcode-series/preview — yazmadan önizleme. Gövdedeki alanlar mevcut serinin
   * üstüne bindirilir; biçim değişiyorsa sayaç baştan (ilk üç kod), değişmiyorsa sıradaki kod.
   */
  static async preview(customerId: string, body: unknown): Promise<ApiResponse<{ codes: string[]; formatChanged: boolean; collides: boolean }>> {
    await assertCustomer(customerId);
    const over = parse(previewSchema, body);
    const current = await prisma.customerBarcodeSeries.findUnique({ where: { customerId } });
    const base: FormatInput = current
      ? { prefix: current.prefix, dateSegment: current.dateSegment, digits: current.digits, separator: current.separator, startValue: current.startValue, maxValue: current.maxValue }
      : { prefix: "", dateSegment: NumberSeriesDateSegment.NONE, digits: 4, separator: "", startValue: null, maxValue: null };
    const fmt: FormatInput = { ...base, ...over };
    if (!fmt.prefix) throw AppError.badRequest("Ön ek zorunlu", { code: "VALIDATION_ERROR" });
    // Görünür biçim değişiyorsa yeni kapsam (ilk üç kod); değilse aynı kapsamda sıradaki kod. Tohum her iki yolda
    // da doğumla AYNI hesaptan (aynı görünür biçimde eski kodların üstünden).
    const formatChanged = !current || VISIBLE_FORMAT_FIELDS.some((k) => current[k] !== fmt[k]);
    const draft = {
      ...fmt,
      id: current?.id ?? NO_SERIES_ID,
      formatChangedAt: formatChanged ? new Date() : current!.formatChangedAt,
    };
    const now = new Date();
    const seq = await peekCustomerSeriesSeq(prisma, draft, now);
    const plain = customerSeriesFormat({ ...fmt, formatChangedAt: null });
    const codes = (formatChanged ? [0, 1, 2] : [0]).map((i) => formatSeriesCode(plain, seq + i, now));
    const collides = await customerCodeCollidesWithOurs(prisma, codes[0]!);
    return { success: true, data: { codes, formatChanged, collides } };
  }
}
