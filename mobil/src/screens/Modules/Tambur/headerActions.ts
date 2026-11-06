// Tambur tablet başlığındaki aksiyon çiplerinin yerleşimi — saf karar.
// Dar tablette (SM-X210 yatay ~1280 dp) bütün çipler satıra sığmıyor, başlık
// ve makine/duruş çipleri sıfıra ezilip üst üste biniyordu (prova 2026-11-06 p66).
// Seyrek kullanılan yetkili aksiyonlar bu genişliğin altında "Diğer" menüsüne iner.

export type TamburHeaderAction =
  | 'list'
  | 'scan'
  | 'doc'
  | 'recent'
  | 'recut'
  | 'orderLink'
  | 'fieldFix'
  | 'manual'
  | 'standalone';

export interface TamburHeaderInput {
  width: number;
  manualMode: boolean;
  docLookupEnabled: boolean;
  canLinkOrders: boolean;
  canFieldFix: boolean;
  hasActiveJob: boolean;
}

/** Bu genişliğin altında seyrek aksiyonlar "Diğer" menüsüne katlanır. */
export const TAMBUR_HEADER_COLLAPSE_BELOW_DP = 1500;

export function tamburHeaderActions(i: TamburHeaderInput): {
  inline: TamburHeaderAction[];
  overflow: TamburHeaderAction[];
} {
  const all: TamburHeaderAction[] = [];
  if (!i.manualMode) {
    all.push('list', 'scan');
    if (i.docLookupEnabled) all.push('doc');
  }
  all.push('recent');
  if (!i.manualMode) all.push('recut');
  if (i.canLinkOrders && i.hasActiveJob && !i.manualMode) all.push('orderLink');
  if (i.canFieldFix && i.hasActiveJob && !i.manualMode) all.push('fieldFix');
  if (i.canFieldFix) all.push('manual');
  if (!i.manualMode) all.push('standalone');

  if (i.width >= TAMBUR_HEADER_COLLAPSE_BELOW_DP) return { inline: all, overflow: [] };

  // AÇIK manuel mod bir DURUMDUR, aksiyon değil — menüye gizlenmez.
  const foldable = new Set<TamburHeaderAction>(['orderLink', 'fieldFix', 'standalone']);
  if (!i.manualMode) foldable.add('manual');
  const overflow = all.filter((a) => foldable.has(a));
  // Menüde tek öğe kalırsa katlamak yer kazandırmaz.
  if (overflow.length < 2) return { inline: all, overflow: [] };
  return { inline: all.filter((a) => !foldable.has(a)), overflow };
}
