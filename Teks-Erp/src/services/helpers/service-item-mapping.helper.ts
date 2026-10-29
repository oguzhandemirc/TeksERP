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
import { assertItemUsable } from "./item-usage.helper";

/**
 * Eşleme yazımı: verilen kimlikler var ve SERVICE türünde olmalı (fail-closed 400); YENİ eşleme
 * pasif/devreden çıkan kaleme yapılamaz (K1, 2026-10-29) — eşleme TANIMDIR (`item-usage` B sınıfı
 * `DEFINITION`, fiyat/reçete gibi). `keep`: kaydın ZATEN taşıdığı eşlemeler — başka alanı düzenlemek
 * eski (sonradan pasife alınmış) eşlemeyi yeniden doğrulayıp kaydı kilitlemesin.
 */
export async function assertServiceItemRefs(
  ids: Array<string | null | undefined>,
  keep: ReadonlySet<string> = new Set(),
): Promise<void> {
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
    if (!keep.has(id)) await assertItemUsable(prisma, id, "DEFINITION");
  }
}

/** Özelliğin ve değerlerinin bugün taşıdığı hizmet kalemi eşlemeleri (`keep` kümesi). */
export async function readLinkedServiceItemIds(propertyId: string): Promise<Set<string>> {
  const prop = await prisma.fabricProperty.findUnique({ where: { id: propertyId }, select: { serviceItemId: true } });
  const vals = await prisma.fabricPropertyValue.findMany({
    where: { propertyId, serviceItemId: { not: null } },
    select: { serviceItemId: true },
  });
  return new Set([prop?.serviceItemId, ...vals.map((v) => v.serviceItemId)].filter((v): v is string => !!v));
}

/** Gövdedeki `serviceItemId`: undefined = dokunma, ""/null = eşlemeyi kaldır; başka tip 400. */
export function readServiceItemIdField(raw: unknown, label: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") throw AppError.badRequest(`${label} hizmet kalemi geçersiz`, { code: "SERVICE_ITEM_INVALID" });
  return raw;
}

/** Özellik gövdesi + değer satırlarının eşlemesi (yazımdan önce; gövdeyi normalize eder). */
export async function assertServiceMapping(
  data: Record<string, unknown>,
  valueRefs: Array<string | null | undefined> = [],
  propertyId?: string,
): Promise<void> {
  if ("serviceItemId" in data) data.serviceItemId = readServiceItemIdField(data.serviceItemId, "Özelliğin");
  const keep = propertyId ? await readLinkedServiceItemIds(propertyId) : new Set<string>();
  await assertServiceItemRefs([data.serviceItemId as string | null | undefined, ...valueRefs], keep);
}
