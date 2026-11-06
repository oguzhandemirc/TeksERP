// =============================================================================
// TeksERP — İŞ EMRİ VARSAYILAN STOK KARTI (`workorder.defaultTargetItemId`)
// =============================================================================
// Hedef kumaşı boş bırakılan iş emri bu kartla açılır. ÖZEL olan GENELİ yener (1e kararı 2026-11-06):
//   elle seçim > müşteri varsayılanı (DeliveryNoteCustomerDefault) > İE varsayılanı (bu ayar) > gelen belge fabrika varsayılanı.
// Panel stoğa üretimde müşteri/belge yoktur → elle > İE varsayılanı. Ayar boş = bugünkü davranış. Kart kapısı gelen belge
// varsayılanlarıyla AYNI (`itemProblem`); kullanılamayan kart sessizce başka karta DÜŞMEZ → 409 (fail-closed).
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { TERIM } from "../constants/terim";
import { itemProblem } from "./gelen-belge-ayar.service";
import { resolveEffectiveDefaultItem } from "./gelen-belge-varsayilan.service";
import { readWorkOrderDefaultTargetItemId, SETTING_KEYS, systemSettingService } from "./system-setting.service";

export interface WorkOrderDefaultItemView {
  id: string;
  code: string;
  name: string;
  /** null = kullanılabilir; dolu = İE açılışında 409 verecek sebep (pasif, birleşmiş, tür …). */
  problem: string | null;
}

/** Boş hedefin dolacağı kartın kaynağı (ipucu + audit işareti). */
export type DefaultTargetSource = "CUSTOMER" | "WORK_ORDER" | "FACTORY";

async function viewOf(id: string): Promise<WorkOrderDefaultItemView> {
  const { row, problem } = await itemProblem(id);
  return { id, code: row?.code ?? "", name: row?.name ?? "(silinmiş ürün)", problem };
}

export async function getWorkOrderDefaultItem(): Promise<WorkOrderDefaultItemView | null> {
  const id = await readWorkOrderDefaultTargetItemId();
  return id ? viewOf(id) : null;
}

/** Yazım: top doğuramayan kart 400 `WORK_ORDER_DEFAULT_ITEM_INVALID`; null temizler (boş metin; audit `set` içinde). */
export async function setWorkOrderDefaultItem(itemId: string | null, userId: string): Promise<WorkOrderDefaultItemView | null> {
  if (itemId !== null) {
    const { problem } = await itemProblem(itemId);
    if (problem) throw AppError.badRequest(`Varsayılan stok kartı olarak kaydedilemez: ${problem}`, { code: "WORK_ORDER_DEFAULT_ITEM_INVALID" });
  }
  await systemSettingService.set(
    SETTING_KEYS.WORKORDER_DEFAULT_TARGET_ITEM_ID,
    itemId ?? "",
    `${TERIM.terbiyeIsEmri.cumleBasi.yalin} varsayılan stok kartı (hedef kumaşı boş bırakılan ${TERIM.terbiyeIsEmri.tekilKucuk} bu kartla açılır)`,
    userId,
  );
  return getWorkOrderDefaultItem();
}

/** İE açılışı: ayar boş → null (bugünkü davranış); dolu ama kullanılamaz → 409 `WORK_ORDER_DEFAULT_ITEM_UNUSABLE`. */
export async function resolveWorkOrderDefaultItemForCreate(): Promise<{ id: string; name: string } | null> {
  const id = await readWorkOrderDefaultTargetItemId();
  if (!id) return null;
  const { row, problem } = await itemProblem(id);
  if (problem || !row) {
    throw AppError.conflict(
      `${TERIM.terbiyeIsEmri.cumleBasi.yalin} varsayılan stok kartı kullanılamıyor: ${problem ?? "Ürün bulunamadı."} Hedef kumaşı seçin ya da ${settingScreenPath("work-orders")} ekranından varsayılan kartı düzeltin.`,
      { code: "WORK_ORDER_DEFAULT_ITEM_UNUSABLE", itemId: id },
    );
  }
  return { id, name: row.name };
}

/**
 * Belgeden İE (formda hedef boş): sahibin müşteri varsayılanı varsa İE varsayılanı UYGULANMAZ (onay zinciri müşteriyi
 * kullanır); yoksa İE varsayılanı; o da boşsa undefined → onay fabrika varsayılanına düşer.
 */
export async function resolveNoteWorkOrderDefaultItem(ownerCustomerId: string | null): Promise<{ id: string; name: string; source: "WORK_ORDER_DEFAULT" } | undefined> {
  if (ownerCustomerId && (await prisma.deliveryNoteCustomerDefault.findUnique({ where: { customerId: ownerCustomerId }, select: { id: true } }))) return undefined;
  const wo = await resolveWorkOrderDefaultItemForCreate();
  return wo ? { ...wo, source: "WORK_ORDER_DEFAULT" } : undefined;
}

/**
 * İpucu ("Boş bırakılırsa: <kart>") — açılışla AYNI sıra. `forNote` yoksa panel stoğa üretim (yalnız İE varsayılanı);
 * varsa belge yolu: müşteri > İE > fabrika. Yazmaz; kullanılamaz kart `problem`le döner (açılış 409 verir).
 */
export async function getEffectiveDefaultTarget(opts: { forNote: boolean; customerId: string | null }): Promise<{ item: WorkOrderDefaultItemView | null; source: DefaultTargetSource | null }> {
  if (opts.forNote && opts.customerId) {
    const own = await prisma.deliveryNoteCustomerDefault.findUnique({ where: { customerId: opts.customerId }, select: { defaultItemId: true } });
    if (own) return { item: await viewOf(own.defaultItemId), source: "CUSTOMER" };
  }
  const wo = await getWorkOrderDefaultItem();
  if (wo) return { item: wo, source: "WORK_ORDER" };
  if (!opts.forNote) return { item: null, source: null };
  const eff = await resolveEffectiveDefaultItem(null);
  return eff.itemId ? { item: await viewOf(eff.itemId), source: "FACTORY" } : { item: null, source: null };
}
