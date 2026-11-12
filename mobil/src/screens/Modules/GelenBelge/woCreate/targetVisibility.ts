// Hedef kumaş / hedef renk sorusunun görünürlüğü (SAF). Fason (müşteri malı) İE'de hedef kumaş sorulmaz (değer müşteri/İE
// varsayılan kartından ya da belgenin eşlenen kartından gider); hedef renk siparişten gelir, rota renk vermiyorsa sorulmaz.
import type { ProductionRoute } from '../../../../services/route.service';
import { routeApplyCaps } from '../../HizliIsEmri/routeCaps';
import type { WoFieldKey } from './woFieldCatalog';
import type { WoFormExtras } from './woForm';
import { isScanRoute } from './woFromDoc';
import type { DocIncomingDeclared } from '../../../../services/inboundDoc.service';

export type ColorQuestion = 'ORDER' | 'HIDDEN' | 'ASK';

/** Rotada renk verebilen adım var mı (Hızlı İE ile aynı yüklem: istasyon VEYA varsayılan kategori `appliesColor`). */
export const routeCanApplyColor = (route: ProductionRoute | null | undefined): boolean => routeApplyCaps(route ?? null).canApplyColor;

/**
 * ORDER: siparişe bağlı, renk siparişten (soru yok) · HIDDEN: siparişsiz + gerçek rota + renk veren adım yok ·
 * ASK: rotasız ("Sahada belirlenir") / rota henüz yok / renk veren adım var → isteğe bağlı soru.
 */
export function targetColorQuestion(a: { orderLinked: boolean; route: ProductionRoute | null | undefined }): ColorQuestion {
  if (a.orderLinked) return 'ORDER';
  if (!a.route || isScanRoute(a.route)) return 'ASK';
  return routeCanApplyColor(a.route) ? 'ASK' : 'HIDDEN';
}

/** Formdan gizlenen hedef alanları (Fason: kumaş; renk: ORDER ya da HIDDEN). */
export function hiddenTargetFields(a: { fason: boolean; orderLinked: boolean; route: ProductionRoute | null | undefined }): WoFieldKey[] {
  const out: WoFieldKey[] = [];
  if (a.fason) out.push('hedefKumas');
  if (targetColorQuestion(a) !== 'ASK') out.push('hedefRenk');
  return out;
}

/** Gövdeye hedef renk girer mi: yalnız sorulabiliyorsa ya da siparişten geliyorsa; gizlenmiş soruda önceden seçilen değer gitmez. */
export const sendsTargetColor = (a: { orderLinked: boolean; route: ProductionRoute | null | undefined }): boolean => targetColorQuestion(a) !== 'HIDDEN';

/** Fason'da hedef kumaş boşsa belgenin eşlenen kartı (en öne); yoksa null = sunucu müşteri/İE varsayılan kartını uygular. */
export function fasonItemPrefill(a: { fason: boolean; extras: Pick<WoFormExtras, 'targetItemId'>; declared: DocIncomingDeclared | undefined }): { targetItemId: string; targetItemLabel: string } | null {
  const s = a.declared?.suggestedItem;
  if (!a.fason || a.extras.targetItemId || !s) return null;
  return { targetItemId: s.id, targetItemLabel: s.name };
}
