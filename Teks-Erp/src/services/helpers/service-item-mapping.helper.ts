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

/** Bir eşleme alanı: `kept` = bu KAYIT bugün zaten bu kalemi taşıyor (muafiyet kayıt başınadır). */
interface ServiceItemRef {
  id: string | null | undefined;
  kept?: boolean;
}

/**
 * Eşleme yazımı: verilen kimlikler var ve SERVICE türünde olmalı (fail-closed 400); YENİ eşleme
 * pasif/devreden çıkan kaleme yapılamaz (K1, 2026-10-29) — eşleme TANIMDIR (`item-usage` B sınıfı
 * `DEFINITION`, fiyat/reçete gibi). Muafiyet KAYIT BAŞINA: yalnız kaydın kendi taşıdığı eşleme
 * yeniden doğrulanmaz; kardeş değerin pasif kalemi başka kayda yeni eşleme olarak yazılamaz.
 */
async function assertServiceItemRefs(refs: ServiceItemRef[]): Promise<void> {
  const fresh = new Set<string>();
  const all = new Set<string>();
  for (const r of refs) {
    if (typeof r.id !== "string" || r.id.length === 0) continue;
    all.add(r.id);
    if (!r.kept) fresh.add(r.id);
  }
  const want = [...all];
  if (want.length === 0) return;
  const rows = await prisma.item.findMany({ where: { id: { in: want } }, select: { id: true, itemType: true, name: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of want) {
    const r = byId.get(id);
    if (!r) throw AppError.badRequest("Eşlenen hizmet kalemi bulunamadı", { code: "SERVICE_ITEM_INVALID", itemId: id });
    if (r.itemType !== ItemType.SERVICE) {
      throw AppError.badRequest(`"${r.name}" bir hizmet kalemi değil — eşleme yalnız Hizmet türü kaleme yapılır`, { code: "SERVICE_ITEM_INVALID", itemId: id });
    }
    if (fresh.has(id)) await assertItemUsable(prisma, id, "DEFINITION");
  }
}

/** Özelliğin ve değerlerinin (kod → kalem) bugün taşıdığı hizmet kalemi eşlemeleri. */
async function readLinkedServiceItems(propertyId: string): Promise<{ own: string | null; byCode: Map<string, string> }> {
  const prop = await prisma.fabricProperty.findUnique({ where: { id: propertyId }, select: { serviceItemId: true } });
  const vals = await prisma.fabricPropertyValue.findMany({
    where: { propertyId, serviceItemId: { not: null } },
    select: { code: true, serviceItemId: true },
  });
  return { own: prop?.serviceItemId ?? null, byCode: new Map(vals.map((v) => [v.code, v.serviceItemId as string])) };
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
  valueRefs: Array<{ code: string; serviceItemId?: string | null }> = [],
  propertyId?: string,
): Promise<void> {
  if ("serviceItemId" in data) data.serviceItemId = readServiceItemIdField(data.serviceItemId, "Özelliğin");
  const linked = propertyId ? await readLinkedServiceItems(propertyId) : { own: null, byCode: new Map<string, string>() };
  const own = data.serviceItemId as string | null | undefined;
  await assertServiceItemRefs([
    { id: own, kept: own != null && own === linked.own },
    ...valueRefs.map((v) => ({ id: v.serviceItemId, kept: v.serviceItemId != null && linked.byCode.get(v.code) === v.serviceItemId })),
  ]);
}
