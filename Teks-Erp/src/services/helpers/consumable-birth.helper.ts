// =============================================================================
// TAMBUR ÇIKTI TOPU — top başına sarf (poşet; 2026-11-10 GK sarf K1)
// =============================================================================
// Ayrı dosya: topun aktif özellik okuması (`ACTIVE_ROLL_PROPERTY`) fatura kapısı zincirini getirir; sarf
// defterinin genel yazarı (`consumable-stock.helper`) kurşun/kuşak çağıranlarına bu zinciri taşımasın.
// Bu dosya yalnız TALEBİ hesaplar; satırı defterin tek yazarı yazar (`writeBirthConsumptionTx`), ters kaydı
// `reverseBirthConsumptionTx` (ikisi de consumable-stock.helper).
// =============================================================================
import { ConsumableNormBasis, Prisma, type ServiceConsumableNorm } from "@prisma/client";
import { resolveConsumableStockEnabled } from "../system-setting.service";
import { consumableNormsValidAt, pickNormsForValue } from "./cost-rate-validity.helper";
import { ACTIVE_ROLL_PROPERTY } from "./property-revoke.helper";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";
import { pickServiceItemId } from "./service-item-pick.helper";
import { sequentialTx } from "./tx-sequential-relations.helper";
import { normDemands, writeBirthConsumptionTx, type ConsumableWarning } from "./consumable-stock.helper";

type Tx = Prisma.TransactionClient;

/**
 * Tambur ÇIKTI topu doğunca top başına sarf (K1): çocuğun istasyondan aldığı bayrakların hizmet kalemi
 * (`pickServiceItemId`; kurşun ve çeşitleri hariç — onlar iz yolunda) × geçerli PER_ROLL normu × 1, çeşit
 * seçimi `pickNormsForValue`. PER_METER normu burada OKUNMAZ (doğumda metre düşümü bugün yoktu — bayt-aynı).
 * Tek çağıran `applyTamburCapabilitiesTx` (tambur doğuş boğazı, `birth: "OUTPUT"`). Tekrar no-op (`@@unique([birthRollId, itemId])`).
 */
export async function consumeForTamburBirthTx(
  tx: Tx,
  a: { rollId: string; propertyIds: string[]; userId?: string | null },
): Promise<ConsumableWarning[]> {
  if (a.propertyIds.length === 0 || !(await resolveConsumableStockEnabled(tx))) return [];
  const props = await sequentialTx(tx).rollProperty.findMany({
    where: { rollId: a.rollId, propertyId: { in: a.propertyIds }, ...ACTIVE_ROLL_PROPERTY },
    select: {
      valueId: true,
      value: { select: { serviceItemId: true } },
      property: { select: { code: true, serviceItemId: true, variantOf: { select: { code: true, serviceItemId: true } } } },
    },
    orderBy: [{ propertyId: "asc" }],
  });
  // Hizmet başına TEK seçim: bayrak satırı ile çeşit (ör. tambur katı) satırı aynı kalemi verir → çift sayılmaz.
  const valueByService = new Map<string, string | null>();
  for (const p of props) {
    if (p.property.code === KURSUN_PROPERTY_CODE || p.property.variantOf?.code === KURSUN_PROPERTY_CODE) continue;
    const serviceItemId = pickServiceItemId({ value: p.value?.serviceItemId, property: p.property.serviceItemId, parentFlag: p.property.variantOf?.serviceItemId });
    if (serviceItemId) valueByService.set(serviceItemId, p.valueId ?? valueByService.get(serviceItemId) ?? null);
  }
  const at = new Date();
  const chosen: ServiceConsumableNorm[] = [];
  for (const [serviceItemId, valueId] of valueByService) {
    const norms = pickNormsForValue(await consumableNormsValidAt(tx, serviceItemId, at), valueId);
    chosen.push(...norms.filter((n) => n.basis === ConsumableNormBasis.PER_ROLL));
  }
  // Metre 0: yalnız PER_ROLL seçildi, normDemands kalemi toplar (iki bayrak aynı sarfı isterse tek satır).
  return writeBirthConsumptionTx(tx, a.rollId, normDemands(chosen, new Prisma.Decimal(0)), a.userId);
}
