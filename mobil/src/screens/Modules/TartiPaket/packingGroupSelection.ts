// Paketleme grubu SEÇİMİ — "Hemen Sevk Et" kümesi ve görünür çuval listesi TEK
// yüklemden süzülür (ikisi ayrı yazılırsa operatör gördüğünden başkasını sevk eder).
// Bayrak KAPALI ya da seçim YOK → girdi AYNEN (aynı referans) döner = bugünkü
// davranış: havuzun tamamı. Grup KURMA/DÜZENLEME tablette yok (panel işi); tablet
// yalnız backend'in gönderdiği `packingGroupId`yi okur ve seçer.
export type PackingGroupSelection = { kind: 'GROUP'; id: string } | { kind: 'UNGROUPED' } | null;

export const UNGROUPED: PackingGroupSelection = { kind: 'UNGROUPED' };

/** Eski backend `packingGroupId` GÖNDERMEZ (`undefined`) — gruplanmamış sayılır. */
const groupOf = (s: { packingGroupId?: string | null }): string | null => s.packingGroupId ?? null;

export function sacksInSelection<T extends { packingGroupId?: string | null }>(
  sacks: T[],
  selection: PackingGroupSelection,
  enabled: boolean,
): T[] {
  if (!enabled || selection === null) return sacks;
  if (selection.kind === 'UNGROUPED') return sacks.filter((s) => groupOf(s) === null);
  return sacks.filter((s) => groupOf(s) === selection.id);
}

/**
 * Seçili grup canlı listeden DÜŞTÜYSE (son çuvalı sevk edildi / dağıtıldı) seçim
 * sıfırlanır — ölü gruba kilitli kalan buton "0 çuval" ile donup kalırdı.
 */
export function reconcileSelection(
  selection: PackingGroupSelection,
  liveGroupIds: ReadonlySet<string>,
): PackingGroupSelection {
  if (selection?.kind === 'GROUP' && !liveGroupIds.has(selection.id)) return null;
  return selection;
}

/** Buton etiketi — grup seçiliyse adı taşır ki operatör NEYİ sevk ettiğini görsün. */
export function shipButtonLabel(input: {
  confirmationEnabled: boolean;
  count: number;
  selectionName: string | null;
}): string {
  const base = input.confirmationEnabled ? 'Sevkiyat Kur' : 'Hemen Sevk Et';
  const name = input.selectionName ? ` · ${input.selectionName}` : '';
  return `${base}${name}${input.count > 0 ? ` (${input.count})` : ''}`;
}

export function selectionName(
  selection: PackingGroupSelection,
  groups: readonly { id: string; name: string }[],
): string | null {
  if (selection === null) return null;
  if (selection.kind === 'UNGROUPED') return 'Gruplanmamış';
  return groups.find((g) => g.id === selection.id)?.name ?? null;
}
