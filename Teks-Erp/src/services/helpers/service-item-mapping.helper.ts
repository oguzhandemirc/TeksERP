// =============================================================================
// HİZMET KALEMİ EŞLEMESİ — yazım doğrulaması (Gülkesim dalga 2 · H6)
// =============================================================================
// Özellik/gramaj değeri → SERVICE kalemi eşlemesi yalnız SERVICE türüne yapılır (fail-closed).
// Fiyat çözücüsünden (`service-pricing.helper`) AYRI dosya: ana veri ucu ticaret
// modeline (`itemPrice`) dokunmasın — `test_ticaret_regime_gate` router kapısı ister.
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

/** Eşleme yazımı: verilen kimlikler var ve SERVICE türünde olmalı (fail-closed 400). */
export async function assertServiceItemRefs(ids: Array<string | null | undefined>): Promise<void> {
  const want = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (want.length === 0) return;
  const rows = await prisma.item.findMany({ where: { id: { in: want } }, select: { id: true, itemType: true, name: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of want) {
    const r = byId.get(id);
    if (!r) throw AppError.badRequest("Eşlenen hizmet kalemi bulunamadı", { code: "SERVICE_ITEM_INVALID", itemId: id });
    if (r.itemType !== ItemType.SERVICE) {
      throw AppError.badRequest(`"${r.name}" bir hizmet kalemi değil — eşleme yalnız Hizmet türü kaleme yapılır`, { code: "SERVICE_ITEM_INVALID", itemId: id });
    }
  }
}

/** Gövdedeki `serviceItemId`: undefined = dokunma, ""/null = eşlemeyi kaldır; başka tip 400. */
export function readServiceItemIdField(raw: unknown, label: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") throw AppError.badRequest(`${label} hizmet kalemi geçersiz`, { code: "SERVICE_ITEM_INVALID" });
  return raw;
}

/** Özellik gövdesi + değer satırlarının eşlemesi (yazımdan önce; gövdeyi normalize eder). */
export async function assertServiceMapping(data: Record<string, unknown>, valueRefs: Array<string | null | undefined> = []): Promise<void> {
  if ("serviceItemId" in data) data.serviceItemId = readServiceItemIdField(data.serviceItemId, "Özelliğin");
  await assertServiceItemRefs([data.serviceItemId as string | null | undefined, ...valueRefs]);
}
