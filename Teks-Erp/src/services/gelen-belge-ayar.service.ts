// =============================================================================
// TeksERP — Gelen belge AYARLARI (hizmet ekseni E3; TASARIM-KARARI §8 HİZMET EKSENİ (1))
// =============================================================================
// Altı fabrika ayarı, TEK yazar `PUT /api/gelen-belge/ayarlar` (ham `PUT /api/admin/settings/:key` bu anahtarları
// REDDEDER — doğrulamasız düz metin yazıp ürün kapısını dolanmasın):
//   · `gelenBelge.defaultItemId` — ürünü seçilmemiş satır onayda bu ürünle doğar (boş = bugünkü: 400 UNRESOLVED)
//   · `gelenBelge.unreviewedApproval` — needsReview satır varken onay: WARN (varsayılan, geçer) | BLOCK (409)
//   · `gelenBelge.autoWorkOrder` — onaydan sonra net gruplara iş emri kendiliğinden (boş/false = bugünkü: elle)
//   · `gelenBelge.defaultRouteTemplateId` — rota önerisinin fabrika varsayılanı (boş = bugünkü: yalnız müşteri kaynakları)
//   · `gelenBelge.routeSuggestionPriority` — CUSTOMER_FIRST (varsayılan, bugünkü) | FACTORY_FIRST
//   · `gelenBelge.handwritingOutlierFactor` — el yazısı şüpheli metre oranı K (2–20; boş = 4, yalnız uyarı)
// Ürün kapısı tek karar: yaşam döngüsü `assertItemUsable(NEW_STOCK)` + top doğurabilen tür ALLOWLIST'i
// (`ROLL_BEARING_ITEM_TYPES`; yeni tür — ör. SERVICE — eklendiği gün kendiliğinden dışarıda kalır).
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { TERIM } from "../constants/terim";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { factoryRouteProblem } from "./gelen-belge-rota-onerisi.service";
import { DEFAULT_OUTLIER_FACTOR, OUTLIER_FACTOR_MAX, OUTLIER_FACTOR_MIN } from "../lib/gelen-belge/taslak";
import {
  DEFAULT_UNREVIEWED_APPROVAL,
  UNREVIEWED_APPROVAL_VALUES,
  SETTING_KEYS,
  readIncomingDocAutoWorkOrder,
  readIncomingDocDefaultRouteId,
  readRouteSuggestionPriority,
  DEFAULT_ROUTE_SUGGESTION_PRIORITY,
  ROUTE_SUGGESTION_PRIORITY_VALUES,
  type RouteSuggestionPriority,
  readIncomingDocDefaultItemId,
  readHandwritingOutlierFactor,
  readUnreviewedApprovalMode,
  systemSettingService,
  type UnreviewedApprovalMode,
} from "./system-setting.service";

/** Top doğurabilen ürün türleri — `InventoryService.createInitialEntry` kapısıyla aynı küme (yalnız kumaş). */
export const ROLL_BEARING_ITEM_TYPES: readonly ItemType[] = [ItemType.FABRIC];

/** Ham ayar ucunun yazamadığı anahtarlar (kendi doğrulamalı ucu var). */
export const INCOMING_DOC_DEDICATED_SETTING_KEYS: ReadonlySet<string> = new Set([
  SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL,
  SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID,
  SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY,
  SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR,
]);

export interface DefaultItemView {
  id: string;
  code: string;
  name: string;
  /** null = top doğurabilir; dolu = neden doğuramaz (pasif, birleşmiş, tür …). */
  problem: string | null;
}

export interface IncomingDocSettings {
  defaultItem: DefaultItemView | null;
  unreviewedApproval: UnreviewedApprovalMode;
  defaultUnreviewedApproval: UnreviewedApprovalMode;
  /** Onaydan sonra net desen gruplarına iş emri kendiliğinden açılır mı (varsayılan false). */
  autoWorkOrder: boolean;
  /** Rota önerisinin fabrika varsayılanı; null = ayar boş. `problem` dolu = onay anında kullanılmaz (atlanır + neden). */
  defaultRoute: { id: string; name: string; problem: string | null } | null;
  routeSuggestionPriority: RouteSuggestionPriority;
  defaultRouteSuggestionPriority: RouteSuggestionPriority;
  /** El yazısı şüpheli metre oranı K (medyanın 1/K altı ya da K katı üstü); yeni okumaya uygulanır. */
  handwritingOutlierFactor: number;
  defaultHandwritingOutlierFactor: number;
  handwritingOutlierFactorRange: { min: number; max: number };
}

/**
 * Ürün top doğurabilir mi — null = evet, metin = Türkçe sebep. Bulunamayan ürün de sebeptir. Fabrika ve müşteri
 * varsayılanının (E4) TEK kapısı: yazımda 400, onay anında 409.
 */
export async function itemProblem(itemId: string): Promise<{ row: { code: string; name: string } | null; problem: string | null }> {
  const row = await prisma.item.findUnique({ where: { id: itemId }, select: { code: true, name: true, itemType: true } });
  if (!row) return { row: null, problem: "Ürün bulunamadı." };
  if (!ROLL_BEARING_ITEM_TYPES.includes(row.itemType)) {
    return { row, problem: `"${row.name}" top olarak girilemez; yalnız kumaş ürünü seçilebilir.` };
  }
  try {
    await assertItemUsable(prisma, itemId, "NEW_STOCK");
  } catch (err) {
    if (err instanceof AppError) return { row, problem: err.message };
    throw err;
  }
  return { row, problem: null };
}

async function defaultRouteView(): Promise<IncomingDocSettings["defaultRoute"]> {
  const id = await readIncomingDocDefaultRouteId();
  if (!id) return null;
  const { name, problem } = await factoryRouteProblem(id);
  return { id, name: name ?? "(silinmiş rota)", problem };
}

export async function getIncomingDocSettings(): Promise<IncomingDocSettings> {
  const id = await readIncomingDocDefaultItemId();
  let defaultItem: DefaultItemView | null = null;
  if (id) {
    const { row, problem } = await itemProblem(id);
    defaultItem = { id, code: row?.code ?? "", name: row?.name ?? "(silinmiş ürün)", problem };
  }
  return {
    defaultItem,
    unreviewedApproval: await readUnreviewedApprovalMode(),
    defaultUnreviewedApproval: DEFAULT_UNREVIEWED_APPROVAL,
    autoWorkOrder: await readIncomingDocAutoWorkOrder(),
    defaultRoute: await defaultRouteView(),
    routeSuggestionPriority: await readRouteSuggestionPriority(),
    defaultRouteSuggestionPriority: DEFAULT_ROUTE_SUGGESTION_PRIORITY,
    handwritingOutlierFactor: await readHandwritingOutlierFactor(),
    defaultHandwritingOutlierFactor: DEFAULT_OUTLIER_FACTOR,
    handwritingOutlierFactorRange: { min: OUTLIER_FACTOR_MIN, max: OUTLIER_FACTOR_MAX },
  };
}

export interface IncomingDocSettingsInput {
  /** null = temizle (bugünkü davranışa dön). */
  defaultItemId?: string | null;
  unreviewedApproval?: UnreviewedApprovalMode;
  autoWorkOrder?: boolean;
  /** null = temizle (bugünkü davranış). */
  defaultRouteTemplateId?: string | null;
  routeSuggestionPriority?: RouteSuggestionPriority;
  /** null = temizle (varsayılan oran). */
  handwritingOutlierFactor?: number | null;
}

/** Yazım: ürün doğrulaması 400 `GELEN_BELGE_DEFAULT_ITEM_INVALID`; audit `systemSettingService.set` içinde. */
export async function updateIncomingDocSettings(input: IncomingDocSettingsInput, userId: string): Promise<IncomingDocSettings> {
  if (input.defaultItemId !== undefined) {
    if (input.defaultItemId !== null) {
      const { problem } = await itemProblem(input.defaultItemId);
      if (problem) {
        throw AppError.badRequest(`Varsayılan ürün olarak kaydedilemez: ${problem}`, { code: "GELEN_BELGE_DEFAULT_ITEM_INVALID" });
      }
    }
    // Temizleme boş metin yazar (okuyucu UUID olmayanı null okur); satır silinmez — ayar geçmişi audit'te kalır.
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, input.defaultItemId ?? "", "Gelen belge varsayılan ürünü (ürünü seçilmemiş satır bu ürünle girer)", userId);
  }
  if (input.unreviewedApproval !== undefined) {
    if (!UNREVIEWED_APPROVAL_VALUES.includes(input.unreviewedApproval)) {
      throw AppError.badRequest("Geçersiz seçenek: WARN ya da BLOCK olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, input.unreviewedApproval, "Gelen belge: gözden geçirilmemiş hücre varken onay (WARN/BLOCK)", userId);
  }
  if (input.autoWorkOrder !== undefined) {
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, input.autoWorkOrder, `Gelen belge: onaydan sonra net desen gruplarına ${TERIM.terbiyeIsEmri.tekilKucuk} kendiliğinden açılır`, userId);
  }
  if (input.defaultRouteTemplateId !== undefined) {
    if (input.defaultRouteTemplateId !== null) {
      const { problem } = await factoryRouteProblem(input.defaultRouteTemplateId);
      if (problem) {
        throw AppError.badRequest(`Fabrika varsayılan rotası olarak kaydedilemez: ${problem}.`, { code: "GELEN_BELGE_DEFAULT_ROUTE_INVALID" });
      }
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID, input.defaultRouteTemplateId ?? "", `Gelen belge: ${TERIM.terbiyeIsEmri.tekilKucuk} rota önerisinin fabrika varsayılanı`, userId);
  }
  if (input.routeSuggestionPriority !== undefined) {
    if (!ROUTE_SUGGESTION_PRIORITY_VALUES.includes(input.routeSuggestionPriority)) {
      throw AppError.badRequest("Geçersiz seçenek: CUSTOMER_FIRST ya da FACTORY_FIRST olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY, input.routeSuggestionPriority, "Gelen belge: rota önerisi önceliği (CUSTOMER_FIRST/FACTORY_FIRST)", userId);
  }
  if (input.handwritingOutlierFactor !== undefined) {
    const k = input.handwritingOutlierFactor;
    if (k !== null && !(Number.isFinite(k) && k >= OUTLIER_FACTOR_MIN && k <= OUTLIER_FACTOR_MAX)) {
      throw AppError.badRequest(`Şüpheli değer oranı ${OUTLIER_FACTOR_MIN} ile ${OUTLIER_FACTOR_MAX} arasında olmalı.`, { code: "VALIDATION_ERROR" });
    }
    // Temizleme boş metin yazar (okuyucu sayı olmayanı varsayılana düşürür).
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR, k ?? "", "Gelen belge: el yazısı şüpheli metre oranı (medyanın 1/K altı ya da K katı üstü)", userId);
  }
  return getIncomingDocSettings();
}

/** Ürünü kaynağıyla etkin varsayılan sayan çözücü (E4) için: fabrika ayarındaki ürün kimliği, boşsa null. */
export const readFactoryDefaultItemId = readIncomingDocDefaultItemId;

/** Onay anı FAIL-CLOSED hatası — kaynak (`CUSTOMER` sahibin varsayılanı · `FACTORY` fabrika ayarı) details'te. */
export function defaultItemUnusable(source: "CUSTOMER" | "FACTORY", itemId: string, problem: string | null): AppError {
  const fix = source === "CUSTOMER" ? "Müşteri Varsayılan Ürünleri ekranından sahibin varsayılan ürününü düzeltin" : `${settingScreenPath("gelen-belge")} ekranından varsayılan ürünü düzeltin`;
  return AppError.conflict(`Gelen belge varsayılan ürünü kullanılamıyor: ${problem ?? "Ürün bulunamadı."} Satırlarda ürün seçin ya da ${fix}.`, { code: "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE", itemId, source });
}
