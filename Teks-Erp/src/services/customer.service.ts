// =============================================================================
// TeksERP - Customer Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create / update: taxNumber format kontrolü (VKN/TCKN + esnek yabancı VAT)
// =============================================================================

import { BaseService, BaseServiceConfig } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { validateName, validateCode } from "../lib/string-validators";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import prisma from "../lib/prisma";
import { OrderStatus } from "@prisma/client";
import { dailyCodePrefix, nextDailySeq, foldCodeForCompare } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";

/**
 * VKN (10 hane), TCKN (11 hane) ve yabancı VAT/EIN (12-15 hane) için ortak
 * format. Sadece sayı; harf içeren AB VAT'ları (örn. "DE123456789") henüz
 * destek dışı — gerekirse `^[A-Z]{0,2}\d{10,15}$` gibi genişletilebilir.
 * Boş (null/undefined/"") kabul edilir — schema'da `String?` zaten optional.
 */
const TAX_NUMBER_REGEX = /^\d{10,15}$/;

/** Müşteri kodu prefix'i — tek-tip kod formatı: `MUS + GGAAYY + NNNN`. */
const CUSTOMER_CODE_PREFIX = "MUS";

/**
 * "Her şube = ayrı müşteri" düzeni (2026-07): müşteri kartına taşınan opsiyonel
 * alanlar. Sınırlar DB kolonlarıyla birebir (schema.prisma Customer) — aşan girdi
 * Postgres P2000 yerine alan-adlı Türkçe 400 alsın. TEXT kolonlar (address, notes)
 * inline şube validasyonuyla aynı 500 pratik sınırını kullanır.
 */
const CARD_FIELDS = [
  ["exportCode", "İhracat kodu", 50],
  ["address", "Adres", 500],
  ["city", "Şehir", 80],
  ["district", "İlçe", 80],
  ["country", "Ülke", 80],
  ["contactName", "Yetkili adı", 120],
  ["contactPhone", "Telefon", 40],
  ["email", "E-posta", 200],
  ["notes", "Notlar", 500],
] as const;

/** Kaba e-posta biçimi — boşluksuz `x@y.z`; amaç yazım kazasını yakalamak, RFC değil. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sıradaki müşteri kodu: `MUS + GGAAYY + NNNN` (gün başına 1'den artan, 4 hane).
 * collation-güvenli sorgu (gte + startsWith) + sayısal max+1 — sevkiyat/çuval
 * numaralarıyla aynı kalıp ([[code-format]]). Çakışma `withBarcodeRetry` ile telafi.
 */
async function nextCustomerCode(): Promise<string> {
  const prefix = dailyCodePrefix(CUSTOMER_CODE_PREFIX);
  const todays = await prisma.customer.findMany({
    where: { code: { gte: prefix, startsWith: prefix } },
    select: { code: true },
  });
  const seq = nextDailySeq(
    todays.map((c) => c.code),
    prefix,
  );
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// =============================================================================
// İç-içe (inline) şube oluşturma — create body'sinde opsiyonel `branches[]`
// =============================================================================
// Müşteri + sevk noktaları TEK istekte, TEK transaction'da doğar (Prisma
// nested-create; order+lines emsali). "Önce müşteriyi kaydet, sonra şube ekle"
// iki-adımlı akışını profesyonel tek adıma indirir.

/** Tek create'te izin verilen azami inline şube sayısı (kötüye kullanım seddi). */
const MAX_INLINE_BRANCHES = 50;

/** Prisma nested-create'e verilecek beyaz-listeli CustomerBranch skaler şekli. */
interface InlineBranchData {
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}

/** Opsiyonel string alanı: boş/whitespace → null, uzunluk aşımı → 400 (1-tabanlı satır no'lu). */
function optBranchStr(raw: unknown, label: string, max: number, idx: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest(`${idx + 1}. şube: ${label} metin olmalı`);
  }
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > max) {
    throw AppError.badRequest(`${idx + 1}. şube: ${label} en fazla ${max} karakter olabilir`);
  }
  return t;
}

/**
 * Müşteri create body'sindeki opsiyonel `branches` alanını doğrular + şekillendirir:
 *   - yok/null/boş dizi → undefined (nested-create hiç gönderilmez);
 *   - dizi değilse veya bir satır bozuksa → 400 (Türkçe, 1-tabanlı satır no'lu);
 *   - her satır CustomerBranch skaler alanlarına indirgenir (MASS-ASSIGNMENT YOK —
 *     yalnız beyaz-listeli alanlar geçer; `customerId` ilişkiden gelir, `id`/tarih
 *     sistem alanları asla istemciden yazılmaz).
 * Sınırlar customer-branch.routes.ts createSchema ile birebir (tek-adım / iki-adım
 * şube ekleme aynı validasyonu görsün).
 */
function validateAndShapeBranches(raw: unknown): InlineBranchData[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw AppError.badRequest("Şubeler geçersiz (dizi bekleniyor)");
  }
  if (raw.length === 0) return undefined;
  if (raw.length > MAX_INLINE_BRANCHES) {
    throw AppError.badRequest(`Tek seferde en fazla ${MAX_INLINE_BRANCHES} şube eklenebilir`);
  }
  // Dizi içi ad + kod mükerrer kontrolü (Türkçe-duyarsız) — yeni müşteri
  // olduğundan mevcut şube yok; iki-adım yolun guard'ı customer-branch.service'te.
  const seenNames = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  const shaped = raw.map((entry, idx): InlineBranchData => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw AppError.badRequest(`${idx + 1}. şube: geçersiz kayıt`);
    }
    const rec = entry as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.trim() === "") {
      throw AppError.badRequest(`${idx + 1}. şube: Şube adı zorunlu`);
    }
    const name = rec.name.trim();
    // Sınırlar DB kolonlarıyla birebir (CustomerBranch.name VARCHAR(100) /
    // code VARCHAR(50)) — aşan girdi Postgres P2000 (jenerik 400) yerine
    // burada net, alan-adlı Türkçe 400 alsın; ayrıca atomik create'i boşa düşürmesin.
    if (name.length > 100) {
      throw AppError.badRequest(`${idx + 1}. şube: Şube adı en fazla 100 karakter olabilir`);
    }
    const nameKey = foldNameForCompare(name);
    const firstIdx = seenNames.get(nameKey);
    if (firstIdx !== undefined) {
      throw AppError.badRequest(
        `${idx + 1}. şube: '${name}' adı ${firstIdx + 1}. şubeyle aynı — şube adları tekrar edemez`,
      );
    }
    seenNames.set(nameKey, idx);
    const code = optBranchStr(rec.code, "İhracat kodu", 50, idx);
    if (code) {
      // §18: KOD katlaması yerel-BAĞIMSIZ olmalı — `foldNameForCompare` (tr-TR
      // BÜYÜK) `i → İ` çevirdiği için "sip"/"SIP" çifti sessizce eşleşmezdi.
      const codeKey = foldCodeForCompare(code);
      const firstCodeIdx = seenCodes.get(codeKey);
      if (firstCodeIdx !== undefined) {
        throw AppError.badRequest(
          `${idx + 1}. şube: '${code}' ihracat kodu ${firstCodeIdx + 1}. şubeyle aynı — şube ihracat kodları tekrar edemez`,
        );
      }
      seenCodes.set(codeKey, idx);
    }
    return {
      code,
      name,
      address: optBranchStr(rec.address, "Adres", 500, idx),
      city: optBranchStr(rec.city, "Şehir", 80, idx),
      district: optBranchStr(rec.district, "İlçe", 80, idx),
      contactName: optBranchStr(rec.contactName, "İletişim kişisi", 120, idx),
      contactPhone: optBranchStr(rec.contactPhone, "Telefon", 40, idx),
      notes: optBranchStr(rec.notes, "Notlar", 500, idx),
      isActive: rec.isActive === undefined ? true : Boolean(rec.isActive),
    };
  });
  return shaped;
}

export class CustomerService extends BaseService {
  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * taxNumber boş değilse 10-15 hane sayı olmalı.
   * Trim'i çağıran üst katmandan beklemiyoruz; burada da temizliyoruz.
   */
  private validateTaxNumber(raw: unknown): string | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw !== "string") {
      throw AppError.badRequest("Vergi numarası metin olmalı");
    }
    const trimmed = raw.trim();
    if (trimmed === "") return null; // boş → null'a çevir
    if (!TAX_NUMBER_REGEX.test(trimmed)) {
      throw AppError.badRequest(
        "Vergi numarası 10-15 hane sayı olmalı (VKN: 10, TCKN: 11)"
      );
    }
    return trimmed;
  }

  /**
   * Müşteri kartı opsiyonel alanları: gövdede yoksa dokunma, null/boş → null,
   * metin değilse veya sınırı aşarsa alan-adlı Türkçe 400. E-posta ek biçim
   * kontrolünden geçer. Doğrulanan değer data'ya geri yazılır (trim'li).
   */
  private applyCardFields(data: Record<string, unknown>): void {
    for (const [key, label, max] of CARD_FIELDS) {
      if (!(key in data)) continue;
      const raw = data[key];
      if (raw === undefined) continue;
      if (raw === null) {
        data[key] = null;
        continue;
      }
      if (typeof raw !== "string") {
        throw AppError.badRequest(`${label} metin olmalı`);
      }
      const trimmed = raw.trim();
      if (trimmed === "") {
        data[key] = null;
        continue;
      }
      if (trimmed.length > max) {
        throw AppError.badRequest(`${label} en fazla ${max} karakter olabilir`);
      }
      if (key === "email" && !EMAIL_REGEX.test(trimmed)) {
        throw AppError.badRequest("E-posta adresi geçersiz görünüyor");
      }
      data[key] = trimmed;
    }
  }

  /**
   * Name + code (create'te zorunlu, update'te varsa). Trim + max length
   * paylaşımlı validator'dan.
   */
  private applyStringFields(data: Record<string, unknown>, isCreate: boolean): void {
    const code = validateCode(data.code, {
      label: "Müşteri kodu",
      required: isCreate,
    });
    if (code !== undefined) data.code = code;
    const name = validateName(data.name, {
      label: "Müşteri adı",
      required: isCreate,
    });
    if (name !== undefined) data.name = name;
  }

  /**
   * Aynı vergi numaralı (VKN/TCKN) ikinci müşteriye izin verme — vergi no tüzel
   * kişiyi/kişiyi benzersiz tanımlar, mükerrer = aynı firma iki kez. Yalnız
   * AKTİF kayıtlar sayılır (pasif kayıt false-block yapmasın); değer normalize
   * (trim) sonrası birebir karşılaştırılır (rakam dizisi — katlama gerekmez).
   */
  private async assertTaxNumberAvailable(
    taxNumber: unknown,
    excludeId?: string,
  ): Promise<void> {
    if (typeof taxNumber !== "string" || taxNumber.trim().length === 0) return;
    const value = taxNumber.trim();
    const existing = await prisma.customer.findFirst({
      where: { taxNumber: value, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { code: true, name: true },
    });
    if (!existing) return;
    throw AppError.conflict(
      `'${value}' vergi numarası '${existing.name}' (${existing.code}) müşterisinde zaten kayıtlı. Aynı vergi no ile ikinci müşteri açılamaz.`,
    );
  }

  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // Müşteri kodu backend-authoritative: her zaman `MUS+GGAAYY+NNNN` günlük
    // sıralı üretilir; istemciden gelen `code` YOK SAYILIR (iki giriş noktası —
    // Müşteriler sayfası + sipariş içi hızlı ekleme — aynı formatı alsın).
    // Eşzamanlı iki create aynı sıra no'yu okuyup INSERT'te @unique çakışırsa
    // (P2002) withBarcodeRetry taze sıra no ile yeniden dener.
    //
    // Opsiyonel inline şubeler: doğrulama+şekillendirme retry DIŞINDA bir kez
    // (idempotent, yan etkisiz). Şekillenmiş dizi retry içinde `data.branches`'e
    // yazılır → super.create sanitize'ı korur (config.nestedCreateFields) ve
    // BaseService onu `{ create: [...] }`'e sarıp müşteriyle ATOMİK nested-create eder.
    const branches = validateAndShapeBranches(data.branches);
    return withBarcodeRetry(async () => {
      data.code = await nextCustomerCode();
      this.applyStringFields(data, true);
      this.applyCardFields(data);
      const validated = this.validateTaxNumber(data.taxNumber);
      if (validated !== undefined) {
        data.taxNumber = validated;
        await this.assertTaxNumberAvailable(validated);
      }
      if (branches) data.branches = branches;
      else delete data.branches;
      return super.create(data, userId);
    });
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // `branches` yalnız create'e özel iç-içe alandır (nestedCreateFields). Update
    // gövdesinde gelirse (beklenmez — UI şubeleri ayrı uçlardan yönetir) sessizce
    // düş: BaseService.update nested-wrap YAPMAZ, ham dizi Prisma update'i bozardı.
    if ("branches" in data) delete data.branches;
    this.applyStringFields(data, false);
    this.applyCardFields(data);
    const validated = this.validateTaxNumber(data.taxNumber);
    if (validated !== undefined) {
      data.taxNumber = validated;
      // Yalnız vergi no gerçekten değişirken kontrol — tarihsel mükerrer kayıt
      // (koruma öncesi) düzenlenebilir kalsın.
      const current = await prisma.customer.findUnique({
        where: { id },
        select: { taxNumber: true },
      });
      if (validated && validated !== (current?.taxNumber ?? null)) {
        await this.assertTaxNumberAvailable(validated, id);
      }
    }
    return super.update(id, data, userId);
  }

  /**
   * M-26: AÇIK siparişi olan müşteri pasifleştirilemez — yoksa pasif müşterinin
   * siparişleri MRP'de talep olarak yaşamaya devam eder, planlamacı pasif
   * müşteri için üretim açar, sevkiyat FIFO bu satırlara tahsis eder.
   * "Yıkıcı işlemde somut liste" kuralı: bloklanırken sipariş no'ları döner.
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const openOrders = await prisma.order.findMany({
      where: {
        customerId: id,
        status: { in: [OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED] },
      },
      select: { orderNumber: true },
      take: 20,
    });
    if (openOrders.length > 0) {
      const list = openOrders.map((o) => o.orderNumber).join(", ");
      throw AppError.conflict(
        `Müşterinin açık siparişleri var: ${list}${openOrders.length === 20 ? ", …" : ""}. ` +
          `Önce siparişleri kapatın/iptal edin, sonra müşteriyi pasife alın.`
      );
    }
    return super.softDelete(id, userId);
  }

  /**
   * F203: kalıcı silme guard'ı — bağımlı kayıt varsa ham FK (P2003) yerine anlamlı
   * 409. Tümü prisma.* (tx DIŞI) → Promise.all serbest (kural yalnız tx.* için).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!existing) return { success: false, data: null, message: "Müşteri bulunamadı" };

    const [orderCount, shipmentCount, returnCount, branchCount, sackCount, routeCount] = await Promise.all([
      prisma.order.count({ where: { customerId: id } }),
      prisma.shipment.count({ where: { customerId: id } }),
      prisma.rollReturn.count({ where: { customerId: id } }),
      prisma.customerBranch.count({ where: { customerId: id } }),
      // sacks_customerId_fkey artık ON DELETE SET NULL (2026-07-15 drift düzeltmesi,
      // eskiden RESTRICT idi) — o P2003'ü artık fırlatmaz, guard burada EXPLICIT olmalı.
      prisma.sack.count({ where: { customerId: id } }),
      // routes.customerId de ON DELETE SET NULL (A5, 2026-07-31 denetimi) — müşteriye
      // özel varsayılan rota, guard'sız silmede sessizce "genel" rotaya dönerdi.
      prisma.route.count({ where: { customerId: id } }),
    ]);

    const blockers: string[] = [];
    if (orderCount > 0) blockers.push(`${orderCount} sipariş`);
    if (shipmentCount > 0) blockers.push(`${shipmentCount} sevkiyat`);
    if (returnCount > 0) blockers.push(`${returnCount} iade`);
    if (branchCount > 0) blockers.push(`${branchCount} şube`);
    if (sackCount > 0) blockers.push(`${sackCount} çuval`);
    if (routeCount > 0) blockers.push(`${routeCount} müşteriye özel rota`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `Müşteriye bağlı kayıtlar var (${blockers.join(", ")}) — kalıcı silinemez. ` +
          `Müşteriyi pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }
}
