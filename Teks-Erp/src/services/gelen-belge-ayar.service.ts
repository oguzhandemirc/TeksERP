// =============================================================================
// TeksERP — Gelen belge AYARLARI (hizmet ekseni E3; TASARIM-KARARI §8 HİZMET EKSENİ (1))
// =============================================================================
// İki fabrika ayarı, TEK yazar `PUT /api/gelen-belge/ayarlar` (ham `PUT /api/admin/settings/:key` bu anahtarları
// REDDEDER — doğrulamasız düz metin yazıp ürün kapısını dolanmasın):
//   · `gelenBelge.defaultItemId` — ürünü seçilmemiş satır onayda bu ürünle doğar (boş = bugünkü: 400 UNRESOLVED)
//   · `gelenBelge.unreviewedApproval` — needsReview satır varken onay: WARN (varsayılan, geçer) | BLOCK (409)
// Ürün kapısı tek karar: yaşam döngüsü `assertItemUsable(NEW_STOCK)` + top doğurabilen tür ALLOWLIST'i
// (`ROLL_BEARING_ITEM_TYPES`; yeni tür — ör. SERVICE — eklendiği gün kendiliğinden dışarıda kalır).
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { assertItemUsable } from "./helpers/item-usage.helper";
import {
  DEFAULT_UNREVIEWED_APPROVAL,
  UNREVIEWED_APPROVAL_VALUES,
  SETTING_KEYS,
  readIncomingDocDefaultItemId,
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
}

/** Ürün top doğurabilir mi — null = evet, metin = Türkçe sebep. Bulunamayan ürün de sebeptir. */
async function itemProblem(itemId: string): Promise<{ row: { code: string; name: string } | null; problem: string | null }> {
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
  };
}

export interface IncomingDocSettingsInput {
  /** null = temizle (bugünkü davranışa dön). */
  defaultItemId?: string | null;
  unreviewedApproval?: UnreviewedApprovalMode;
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
  return getIncomingDocSettings();
}

/**
 * Onay ön kontrolü için: ayar boşsa null. Doluysa ürün o AN top doğurabilmeli — pasifleşmiş/birleşmiş/silinmiş
 * ürün sessizce atlanmaz, 409 `GELEN_BELGE_DEFAULT_ITEM_UNUSABLE` (FAIL-CLOSED; operatör ya ürün seçer ya ayarı düzeltir).
 */
export async function resolveDefaultItemForApproval(): Promise<{ id: string; name: string } | null> {
  const id = await readIncomingDocDefaultItemId();
  if (!id) return null;
  const { row, problem } = await itemProblem(id);
  if (problem || !row) {
    throw AppError.conflict(`Gelen belge varsayılan ürünü kullanılamıyor: ${problem ?? "Ürün bulunamadı."} Satırlarda ürün seçin ya da ${settingScreenPath("gelen-belge")} ekranından varsayılan ürünü düzeltin.`, { code: "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE", itemId: id });
  }
  return { id, name: row.name };
}
