// =============================================================================
// TeksERP - System Setting Service
// =============================================================================
// Runtime'da güncellenebilir konfigürasyon (key-value).
// =============================================================================

import { ApiResponse } from "../types/api.types";
import prisma from "../lib/prisma";
import { SECURITY_SETTING_PREFIX } from "../constants/reserved-settings";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { createHash } from "crypto";
import { DEFAULT_COMPANY_NAME } from "../constants/company";
import { asNumber } from "./system-setting/core";
import { LOGO_DATAURL_RE, LOGO_MAX_CHARS, readDocumentsLogo, type DocumentsLogo } from "./system-setting/documents";
import { getFeatureFlags as getFeatureFlagsImpl, invalidateFeatureFlagsCache } from "./system-setting/feature-flags-read";
import { MODULE_SETTING_KEY_BY_FLAG, type FeatureFlags } from "./system-setting/feature-flags-types";
import { assertModuleDependencies as assertModuleDependenciesImpl, assertModuleWritesLicensed as assertModuleWritesLicensedImpl, assertTezgahAlarmShiftRequirement as assertTezgahAlarmShiftRequirementImpl, assertTezgahAlarmUnclassifiedRequirement as assertTezgahAlarmUnclassifiedRequirementImpl, effectiveModuleValue as effectiveModuleValueImpl, setFeatureFlags as setFeatureFlagsImpl, type SystemSettingServiceThis } from "./system-setting/feature-flags-write";
import { DEFAULT_WITHHOLDING_DENOMINATOR, purchaseWithholdingSettingProblem, readFinancePurchaseWithholdingFlags, readFinanceWithholdingFlags, withholdingSettingProblem, type PurchaseWithholdingFlags, type PurchaseWithholdingInput, type WithholdingFlags, type WithholdingInput } from "./system-setting/finance";
import { SETTING_KEYS } from "./system-setting/keys";

export type { CompanyLegalIdentity, EIrsaliyeConfig } from "./e-irsaliye/e-irsaliye-settings";

const TABLE = "SYSTEM_SETTING";

/** Firma adı verilmediğinde gösterilen NÖTR varsayılan (tek kaynak `constants/company`). */
export { DEFAULT_COMPANY_NAME };

export class SystemSettingService {
  async list(): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.systemSetting.findMany({
      // ⚠️ SIR SATIRLARI LİSTEDE DÖNMEZ (2026-09-03 / P3). `system_settings` artık
      // ayar olmayan bir satır da taşıyor: ayar şifresinin bcrypt hash'i. Bu uç
      // TÜM satırları döndürdüğü için hash burada görünseydi kapı FİİLEN ÖLÜRDÜ —
      // çevrimdışı kırma için bcrypt gövdesi yeterli ve yükü okuyan herkes
      // şifrenin tanımlı olduğunu da öğrenirdi. Süzgeç TEK ANAHTAR değil ÖN EK
      // bazlı: yarın eklenecek ikinci bir sır satırı da doğduğu an korunur
      // ("unutulmuş altıncı enum" sınıfı). Yazma tarafının ikizi:
      // `isReservedSettingKey` (admin.routes PUT /settings/:key).
      where: { NOT: { key: { startsWith: SECURITY_SETTING_PREFIX } } },
      orderBy: { key: "asc" },
      include: {
        updatedBy: { select: { id: true, fullName: true } },
      },
    });
    return { success: true, data: items };
  }

  async get(key: string): Promise<ApiResponse<unknown | null>> {
    const item = await prisma.systemSetting.findUnique({ where: { key } });
    return { success: true, data: item };
  }

  /**
   * Upsert: yoksa oluştur, varsa güncelle.
   * description sadece ilk oluşturmada set edilir; sonraki update'lerde değişmez
   * (admin niyetlerinin bozulmaması için).
   */
  async set(
    key: string,
    value: Prisma.InputJsonValue,
    description: string | undefined,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.systemSetting.findUnique({ where: { key } });

    const updated = await prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value,
        description: description ?? null,
        updatedById: userId,
      },
      update: {
        value,
        updatedById: userId,
      },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE,
      recordId: key,
      oldData: existing ? { value: existing.value as Prisma.InputJsonValue } : null,
      newData: { value: updated.value as Prisma.InputJsonValue },
    });

    // Herhangi bir ayar yazımı feature-flag agregat cache'ini bayatlatabilir →
    // tek write chokepoint burada invalidate eder (toggle anında taze görünür).
    invalidateFeatureFlagsCache();

    return { success: true, data: updated, message: "Ayar güncellendi" };
  }

  /** Güncel belge logosu (yalnız aktif dataUrl — kütüphanenin tamamı değil). */
  async getDocumentsLogo(): Promise<ApiResponse<{ dataUrl: string | null }>> {
    const logo = await readDocumentsLogo();
    return {
      success: true,
      data: { dataUrl: logo.current ? (logo.items[logo.current] ?? null) : null },
    };
  }

  /**
   * Belge logosunu günceller. dataUrl=null → logo kaldırılır (current=null);
   * kütüphane (items) APPEND-ONLY kalır — eski donmuş belgeler hash'leriyle kendi
   * logolarını basmaya devam eder. Aynı görsel tekrar yüklenirse hash çakışır,
   * kopya çıkmaz. Logolar nadiren değişir → items pratikte birkaç kayıt.
   */
  async setDocumentsLogo(
    dataUrl: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ dataUrl: string | null }>> {
    // A8 (2026-07-31 denetimi): read-merge-write süreç-içi kuyrukla serileşir —
    // eşzamanlı iki farklı yükleme birbirinin items eklemesini kaybettiremez.
    // Tek Express process invariant'ı (server.ts) altında DB kilidi gerekmez.
    const task = documentsLogoWriteQueue.then(() => this.applyDocumentsLogo(dataUrl, userId));
    documentsLogoWriteQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async applyDocumentsLogo(
    dataUrl: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ dataUrl: string | null }>> {
    const logo = await readDocumentsLogo();
    let next: DocumentsLogo;
    if (dataUrl == null || dataUrl === "") {
      next = { current: null, items: logo.items };
    } else {
      if (dataUrl.length > LOGO_MAX_CHARS) {
        throw AppError.badRequest("Logo çok büyük — en fazla ~100KB görsel yükleyin");
      }
      if (!LOGO_DATAURL_RE.test(dataUrl)) {
        throw AppError.badRequest("Logo PNG, JPEG veya SVG data-url formatında olmalı");
      }
      const hash = createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
      next = { current: hash, items: { ...logo.items, [hash]: dataUrl } };
    }
    await this.set(
      SETTING_KEYS.DOCUMENTS_LOGO,
      next as unknown as Prisma.InputJsonValue,
      "Belge logosu (hash-anahtarlı kütüphane; snapshot yalnız hash taşır)",
      userId,
    );
    return {
      success: true,
      data: { dataUrl: next.current ? next.items[next.current] : null },
      message: next.current ? "Logo güncellendi" : "Logo kaldırıldı",
    };
  }

  /**
   * Tolerance değerini DB'den okur. Kayıt yoksa default 5m döner.
   * NOT: Bu fonksiyon çok sık çağrılmaz (sevk onayı sırasında); cache'siz kabul.
   */
  async getShippingToleranceMeters(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
      select: { value: true },
    });
    if (!setting) return 5;
    const parsed = asNumber(setting.value);
    if (parsed === null || parsed < 0) return 5;
    return parsed;
  }

  /**
   * Tüm feature flag'leri tek atışta. Default: tüm flag'ler false (en
   * konservatif — fabrika fiyat görmek istemiyor şu an).
   */
  /**
   * Fabrikada AÇIK modüllerin DB anahtarları (bayrak ∧ lisans tavanı; sıralı) — yoklamanın `acikModuller` alanı (K10).
   * Kaynak `getFeatureFlags`tir: ham bayrak + canlı lisans bloğu, ikinci bir okuma yolu yok.
   */
  async getOpenModuleKeys(): Promise<string[]> {
    const flags = (await this.getFeatureFlags()).data;
    if (!flags) return [];
    const closed = new Set(flags.license.kapaliModuller.map((m) => m.anahtar));
    const record = flags as unknown as Record<string, unknown>;
    return Object.entries(MODULE_SETTING_KEY_BY_FLAG)
      .filter(([flag, key]) => record[flag] === true && !closed.has(key))
      .map(([, key]) => key)
      .sort();
  }

  async getFeatureFlags(): Promise<ApiResponse<FeatureFlags>> {
    return getFeatureFlagsImpl();
  }

  /**
   * Bir modül anahtarının bu PATCH'ten SONRAKİ etkin değeri.
   *
   * Gövde o anahtarı taşıyorsa gövdedeki değer, taşımıyorsa DB'deki değer
   * kazanır — "kısmi PATCH" sözleşmesinin birebir karşılığı.
   *
   * ⚠️ Gövdedeki değer boolean DEĞİLSE DB'ye düşülür: tip hatasını asıl yazma
   * dalı ("<alan> boolean olmalı") söylemeli. Burada `Boolean("hayır") === true`
   * yapmak, yanlış yazımı bağımlılık hatasıyla maskelerdi.
   * ⚠️ Okuma CACHE'SİZ okuyuculardan: `getFeatureFlags` 30 sn'lik önbelleğinden
   * beslenseydi, aynı saniyede ticareti kapatıp ipliği açan bir çift bayat
   * veriyle doğrulanırdı.
   */
  private async effectiveModuleValue(
    input: Record<string, unknown>,
    key: string,
  ): Promise<boolean> {
    return effectiveModuleValueImpl(input, key);
  }

  /**
   * MODÜL BAĞIMLILIKLARI (`constants/module-flags.ts` → `MODULE_DEPENDENCIES`).
   *
   * Kural tek cümle: bağımlı modül AÇIK kalacaksa ön koşulu da AÇIK kalmalı.
   * Bu tek yüklem iki yönü birden kapsar — bağımlıyı açmak da ön koşulu
   * kapatmak da aynı yasak durumu (açık bağımlı + kapalı ön koşul) üretir;
   * mesaj kullanıcının HANGİ hamleyi yaptığına göre yazılır, çünkü "önce
   * ticareti açın" ile "önce ipliği kapatın" farklı ekranlara götürür.
   *
   * ⚠️ TÜM yazmalardan ÖNCE koşar (setFeatureFlags'in ilk ifadesi): dallar tek
   * tx değildir, araya girseydi yarım gövde yazılırdı.
   */
  /**
   * `REQUIRE_SHIFT` kapısı — HER YAZMADAN ÖNCE (yarım gövde yazılmasın). Yalnız GEÇİŞ durdurulur: alarm
   * kapalıdan açığa geçerken ya da açık alarmın kipi REQUIRE_SHIFT'e dönerken vardiya tanımı yoksa 400.
   * Değişmeden gelen değer ve kapatma engellenmez (tanımlar sonradan arşivlenirse yüzeyler uyarır).
   */
  private async assertTezgahAlarmShiftRequirement(input: Record<string, unknown>): Promise<void> {
    return assertTezgahAlarmShiftRequirementImpl(input);
  }

  /**
   * Sebepsiz anahtar açıkken süre zorunlu — HER YAZMADAN ÖNCE. Eski istemci yalnız süreyi yollar: anahtar
   * süreden türer (boş = kapalı), bu yüzden eski gövde bu kapıya hiç takılmaz.
   */
  private async assertTezgahAlarmUnclassifiedRequirement(input: Record<string, unknown>): Promise<void> {
    return assertTezgahAlarmUnclassifiedRequirementImpl(input);
  }

  /** D4-V1k: genel tevkifat — üç anahtar birlikte doğrulanır (girdi ?? kayıtlı); açıkken oran ZORUNLU (fail-closed 400).
   *  Doğrulama setFeatureFlags'in başında, HİÇBİR yazmadan önce koşar (aksi hâlde KDV yazılıp 400 dönerdi). */
  private async resolveWithholdingWrite(input: WithholdingInput & PurchaseWithholdingInput, userId?: string): Promise<(() => Promise<void>) | null> {
    const sales = await this.resolveSalesWithholdingWrite(input, userId);
    const purchase = await this.resolvePurchaseWithholdingWrite(input, userId);
    if (!sales && !purchase) return null;
    return async () => {
      if (sales) await sales();
      if (purchase) await purchase();
    };
  }

  private async resolveSalesWithholdingWrite(input: WithholdingInput, userId?: string): Promise<(() => Promise<void>) | null> {
    const hasEnabled = Object.prototype.hasOwnProperty.call(input, "financeWithholdingEnabled");
    const hasNumerator = Object.prototype.hasOwnProperty.call(input, "financeWithholdingNumerator");
    const hasDenominator = Object.prototype.hasOwnProperty.call(input, "financeWithholdingDenominator");
    if (!hasEnabled && !hasNumerator && !hasDenominator) return null;
    // null = girilmemiş pay (0) / varsayılan payda — panelin boş alanı.
    const parsed: Partial<WithholdingFlags> = {
      ...(hasEnabled ? { financeWithholdingEnabled: input.financeWithholdingEnabled } : {}),
      ...(hasNumerator ? { financeWithholdingNumerator: input.financeWithholdingNumerator ?? 0 } : {}),
      ...(hasDenominator ? { financeWithholdingDenominator: input.financeWithholdingDenominator ?? DEFAULT_WITHHOLDING_DENOMINATOR } : {}),
    };
    const next = { ...(await readFinanceWithholdingFlags()), ...parsed };
    const problem = withholdingSettingProblem(next);
    if (problem) throw AppError.badRequest(problem, { code: "WITHHOLDING_SETTING_INVALID" });
    return async () => {
      if (hasEnabled) await this.set(SETTING_KEYS.FINANCE_WITHHOLDING_ENABLED, next.financeWithholdingEnabled, "Satış faturası taslağında genel tevkifat", userId);
      if (hasNumerator) await this.set(SETTING_KEYS.FINANCE_WITHHOLDING_NUMERATOR, next.financeWithholdingNumerator, "Genel tevkifat oranı — pay", userId);
      if (hasDenominator) await this.set(SETTING_KEYS.FINANCE_WITHHOLDING_DENOMINATOR, next.financeWithholdingDenominator, "Genel tevkifat oranı — payda", userId);
    };
  }

  /** F7: fason ALIŞ tevkifatı üçlüsü — satış üçlüsüyle aynı kalıp (girdi ?? kayıtlı, açıkken oran zorunlu, 400 yazmadan önce). */
  private async resolvePurchaseWithholdingWrite(input: PurchaseWithholdingInput, userId?: string): Promise<(() => Promise<void>) | null> {
    const hasEnabled = Object.prototype.hasOwnProperty.call(input, "financePurchaseWithholdingEnabled");
    const hasNumerator = Object.prototype.hasOwnProperty.call(input, "financePurchaseWithholdingNumerator");
    const hasDenominator = Object.prototype.hasOwnProperty.call(input, "financePurchaseWithholdingDenominator");
    if (!hasEnabled && !hasNumerator && !hasDenominator) return null;
    const parsed: Partial<PurchaseWithholdingFlags> = {
      ...(hasEnabled ? { financePurchaseWithholdingEnabled: input.financePurchaseWithholdingEnabled } : {}),
      ...(hasNumerator ? { financePurchaseWithholdingNumerator: input.financePurchaseWithholdingNumerator ?? 0 } : {}),
      ...(hasDenominator ? { financePurchaseWithholdingDenominator: input.financePurchaseWithholdingDenominator ?? DEFAULT_WITHHOLDING_DENOMINATOR } : {}),
    };
    const next = { ...(await readFinancePurchaseWithholdingFlags()), ...parsed };
    const problem = purchaseWithholdingSettingProblem(next);
    if (problem) throw AppError.badRequest(problem, { code: "WITHHOLDING_SETTING_INVALID" });
    return async () => {
      if (hasEnabled) await this.set(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED, next.financePurchaseWithholdingEnabled, "Fason alış faturası taslağında genel tevkifat", userId);
      if (hasNumerator) await this.set(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR, next.financePurchaseWithholdingNumerator, "Fason alış tevkifat oranı — pay", userId);
      if (hasDenominator) await this.set(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR, next.financePurchaseWithholdingDenominator, "Fason alış tevkifat oranı — payda", userId);
    };
  }

  private async assertModuleDependencies(input: Record<string, unknown>): Promise<void> {
    return assertModuleDependenciesImpl.call(this as unknown as SystemSettingServiceThis, input);
  }

  /**
   * LİSANS YAZMA TAVANI: uygulanan tavanın kapattığı modül AÇILAMAZ (403 `LICENSE_MODULE`);
   * kapatmak serbesttir. Gözlemde tavan yoktur. Doğrulama gibi TÜM yazmalardan önce koşar.
   */
  private assertModuleWritesLicensed(input: Record<string, unknown>): void {
    return assertModuleWritesLicensedImpl(input);
  }

  /**
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
  async setFeatureFlags(
    // ⚠️ GİRDİ ÇIKTIDAN DAHA GENİŞ: bazı sayısal ayarlarda `null` "alanı temizle"
    // demektir ve panel bunu gönderir, ama okuma tarafı hiçbir zaman null
    // döndürmez (varsayılana çözülür). İkisini tek tiple anlatmak, ya paneli
    // 400'e düşürür ya da API sözleşmesine olmayan bir null sokar.
    input: Omit<
      Partial<FeatureFlags>,
      "fasonShrinkTolerancePct" | "dokumaWeavingWastePct" | "duplicatesFuzzyThresholdPct" | "shippingAllocWidthToleranceCm" | "shippingReadyTolerancePct" | "tamburPlanGateWidthToleranceCm" | "financeInvoiceQtyTolerancePct" | "financeInvoicePriceTolerancePct" | "financeWithholdingNumerator" | "financeWithholdingDenominator" | "financePurchaseWithholdingNumerator" | "financePurchaseWithholdingDenominator" | "shippingSackSeqStart" | "tezgahEscalationGraceMinutes" | "tezgahAlarmRenotifyMinutes" | "tezgahMaxOpenStopHours" | "tezgahCollectorSilenceMinutes" | "license"
    > & {
      /** null = fabrika varsayılanına dön (1). */
      shippingSackSeqStart?: number | null;
      /** null = fabrika varsayılanına dön (0 dk). */
      tezgahEscalationGraceMinutes?: number | null;
      /** null = fabrika varsayılanına dön (%0). */
      dokumaWeavingWastePct?: number | null;
      /** null = varsayılana dön (10 dk). */
      tezgahAlarmRenotifyMinutes?: number | null;
      /** null = varsayılana dön (12 sa). */
      tezgahMaxOpenStopHours?: number | null;
      /** null = varsayılana dön (10 dk). */
      tezgahCollectorSilenceMinutes?: number | null;
      financeInvoiceQtyTolerancePct?: number | null;
      financeInvoicePriceTolerancePct?: number | null;
      /** null = girilmemiş (pay 0) / varsayılan payda (10). */
      financeWithholdingNumerator?: number | null;
      financeWithholdingDenominator?: number | null;
      /** F7: null = girilmemiş (pay 0) / varsayılan payda (10). */
      financePurchaseWithholdingNumerator?: number | null;
      financePurchaseWithholdingDenominator?: number | null;
      /** null = fabrika varsayılanına dön (1 cm). */
      shippingAllocWidthToleranceCm?: number | null;
      /** null = fabrika varsayılanına dön (%2); `0` geçerli. */
      shippingReadyTolerancePct?: number | null;
      fasonShrinkTolerancePct?: number | null;
      duplicatesFuzzyThresholdPct?: number | null;
      /** null = fabrika varsayılanına dön (10 cm); `0` geçerli. */
      tamburPlanGateWidthToleranceCm?: number | null;
    },
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    return setFeatureFlagsImpl.call(this as unknown as SystemSettingServiceThis, input, userId);
  }
}

// Module-level singleton — helper'lar import edip kullanır.
export const systemSettingService = new SystemSettingService();
// A8: setDocumentsLogo read-merge-write kuyruğu — süreç-içi seri (yalnız method
// gövdesinde okunur; modül değerlendirmesi bittiğinde tanımlı).
let documentsLogoWriteQueue: Promise<unknown> = Promise.resolve();

// Alan modüllerindeki dışa açık adlar — liste `./system-setting/index.ts`te (yalnız özgün dışa aktarımlar).
export * from "./system-setting/index";
