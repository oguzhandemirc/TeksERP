// Okutma hedefi seçimi (saf): seçili çuval ya da çuvalsız (null).
import type { HandheldLoadState } from '../../../../services/handheldShipment.service';

/** Çuvala dokunuş: seçili değilse seçer, seçiliyse kaldırır. */
export function toggleSelection(current: string | null, sackId: string): string | null {
  return current === sackId ? null : sackId;
}

/** Sunucu durumunda artık olmayan çuval seçili kalmaz (düşen/silinen çuval). */
export function reconcileSelection(current: string | null, state: HandheldLoadState | undefined): string | null {
  if (current === null || !state) return current;
  return state.sacks.some((s) => s.id === current) ? current : null;
}

/** Okutmanın gideceği yer etiketi. */
export function targetLabel(state: HandheldLoadState | undefined, selected: string | null): string {
  if (selected === null) return 'Çuvalsız';
  return state?.sacks.find((s) => s.id === selected)?.sackNo ?? 'Çuvalsız';
}
