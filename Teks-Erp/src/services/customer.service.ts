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
import { OrderStatus, ShipmentDestination } from "@prisma/client";
import { dailyCodePrefix, nextDailySeq, foldCodeForCompare } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { parseQueryParams, readFilterList } from "../utils/query-parser";
import { applyPartnerRoles, ROLE_FILTER_TO_FLAG, type PartnerRoles } from "./helpers/partner-roles.helper";
import { validateAndShapeBranches } from "./helpers/customer-inline-branches.helper";
import type { Request } from "express";

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

export class CustomerService extends BaseService {
  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * `filter[role]` (CSV: customer · supplier · subcontractor) → rol bayrakları OR. `safeFilters` bu anahtarı
   * skaler süzgeçte düşürür (kolon değil), ham `filters`tan okunur; tanınmayan değer 400 (fail-closed).
   * `filter[type]` eski istemci için çalışmaya devam eder (kolon süzgeci). `buildListWhere` tek nokta.
   */
  protected extraWhere(req: Request): Record<string, unknown> | undefined {
    const { filters } = parseQueryParams(req);
    const roles = readFilterList(filters.role);
    if (roles.length === 0) return undefined;
    const or = roles.map((r) => {
      const flag = ROLE_FILTER_TO_FLAG[r.trim().toLowerCase()];
      if (!flag) throw AppError.badRequest(`Geçersiz rol süzgeci: ${r} (customer, supplier, subcontractor).`);
      return { [flag]: true };
    });
    return or.length === 1 ? or[0] : { OR: or };
  }

  /** Kartın mevcut rolleri (update'te gövdedeki eksik bayrak buradan tamamlanır). */
  private async currentRoles(id: string): Promise<PartnerRoles | null> {
    return prisma.customer.findUnique({
      where: { id },
      select: { isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true },
    });
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

  /**
   * `defaultDestination`: boş/"" → null (varsayılan yok), enum dışı → 400 TR.
   * Prisma'nın kendi validation hatası da 400'e iner ama alan adı ve mesaj burada
   * belirgin olsun — kullanıcı "kg yazdım m oldu" benzeri sessiz kaymayı görmesin.
   */
  private normalizeDefaultDestination(data: Record<string, unknown>): void {
    if (!("defaultDestination" in data)) return;
    const v = data.defaultDestination;
    if (v == null || v === "") {
      data.defaultDestination = null;
      return;
    }
    if (typeof v !== "string" || !(Object.values(ShipmentDestination) as string[]).includes(v)) {
      throw AppError.badRequest(`Geçersiz sevk varsayılanı: ${String(v)} (DOMESTIC veya EXPORT).`);
    }
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
    this.normalizeDefaultDestination(data);
    // Rol modeli: bayraklar gövdeden, `type` TÜRETİLİR (istemcinin `type`i yalnız rollere çevrilir).
    applyPartnerRoles(data, null);
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
    this.normalizeDefaultDestination(data);
    // Rol modeli: gövdede rol ya da eski `type` varsa mevcut bayraklarla birleşir, `type` yeniden türetilir.
    if ("isCustomerRole" in data || "isSupplierRole" in data || "isSubcontractorRole" in data || "type" in data) {
      applyPartnerRoles(data, await this.currentRoles(id));
    }
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

    const [orderCount, shipmentCount, returnCount, branchCount, sackCount, routeCount, goodsReceiptCount] =
      await Promise.all([
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
      // goods_receipts.supplierId de ON DELETE SET NULL (ticaret paketi, 2026-08-13):
      // firma TEDARİKÇİ rolündeyken mal kabul fişlerine bağlanır. Guard'sız silmede
      // fişler sessizce "tedarikçisiz" kalır — satın alma izi kaybolur ve alış
      // faturası mutabakatı dayanağını yitirir.
      prisma.goodsReceipt.count({ where: { supplierId: id } }),
    ]);

    const blockers: string[] = [];
    if (orderCount > 0) blockers.push(`${orderCount} sipariş`);
    if (shipmentCount > 0) blockers.push(`${shipmentCount} sevkiyat`);
    if (returnCount > 0) blockers.push(`${returnCount} iade`);
    if (branchCount > 0) blockers.push(`${branchCount} şube`);
    if (sackCount > 0) blockers.push(`${sackCount} çuval`);
    if (routeCount > 0) blockers.push(`${routeCount} müşteriye özel rota`);
    if (goodsReceiptCount > 0) blockers.push(`${goodsReceiptCount} mal kabul fişi`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `Müşteriye bağlı kayıtlar var (${blockers.join(", ")}) — kalıcı silinemez. ` +
          `Müşteriyi pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }
}
