// İE eylem yerleşimi — saf (JSX'siz): görünürlük + grup → öğe eşlemesi; detay başlığı VE liste yan paneli buradan.
// Görünürlük koşulları tek yerde; yüzeyler yalnız grup kümesinde ayrışır (boş grup çizilmez, tek öğeli grup düz düğme).
import { matchesPermission } from "@/types/auth";
import { SYSTEM_PRINT_HISTORY_ACCESS } from "@/lib/permissions";
import { canUnlinkOrder } from "./unlink-order";
import type { WorkOrder } from "./types";

export type HeaderActionId =
  | "addBatch"
  | "fasonReceive"
  | "linkOrder"
  | "unlinkOrder"
  | "changeColor"
  | "changeWidth"
  | "documents"
  | "events"
  | "complete"
  | "cancel";

export type HeaderGroupId = "uretim" | "degistir" | "kayitlar" | "durum";

export interface ActionGroup<A extends string, G extends string> {
  id: G;
  label: string;
  actions: readonly A[];
  /** Yıkıcı öğe (kırmızı); `separateFrom` verilmezse ayırıcı da bunlardan önce çizilir. */
  destructive?: readonly A[];
  /** Menüde bunların ilk görüneninden önce ayırıcı çizilir. */
  separateFrom?: readonly A[];
}

export type HeaderGroup = ActionGroup<HeaderActionId, HeaderGroupId>;

export const HEADER_ACTION_GROUPS: readonly HeaderGroup[] = [
  { id: "uretim", label: "Üretim", actions: ["addBatch", "fasonReceive", "linkOrder", "unlinkOrder"] },
  { id: "degistir", label: "Değiştir", actions: ["changeColor", "changeWidth"] },
  { id: "kayitlar", label: "Kayıtlar", actions: ["documents", "events"] },
  { id: "durum", label: "Durum", actions: ["complete", "cancel"], destructive: ["cancel"] },
];

export type HeaderActionVisibility = Record<HeaderActionId, boolean>;

type WoForActions = Pick<WorkOrder, "status" | "type" | "targetItemId" | "targetColorId" | "orderLinks">;

const isOpen = (s: string) => s === "PLANNED" || s === "IN_PROGRESS";
const isClosed = (s: string) => s === "COMPLETED" || s === "CANCELLED" || s === "SUPERSEDED";

/** "Parti Ekle" — başlık ve yan panel AYNI kural: açık iş emri (Planlandı/Üretimde); izin ayrıca `workorder:write`. */
export const canAddBatch = (wo: Pick<WorkOrder, "status">): boolean => isOpen(wo.status);

/** Düzenle (birincil, grupsuz): PLANNED/IN_PROGRESS + `workorder:write`. */
export function canEditWorkOrder(wo: Pick<WorkOrder, "status">, permissions: readonly string[]): boolean {
  return isOpen(wo.status) && matchesPermission(permissions, "workorder:write");
}

export function headerActionVisibility(wo: WoForActions, permissions: readonly string[]): HeaderActionVisibility {
  const write = matchesPermission(permissions, "workorder:write");
  // Plan değişikliği (renk/en) bitmiş/iptal/devredilmiş iş emrinde KAPALI (2026-08-21); backend 409 ile aynı kuralı uygular.
  const canChangePlan = write && !isClosed(wo.status);
  return {
    addBatch: write && canAddBatch(wo),
    fasonReceive: write,
    linkOrder: write,
    unlinkOrder: canUnlinkOrder(wo, permissions),
    changeColor: canChangePlan,
    changeWidth: canChangePlan,
    documents: true,
    events: true,
    // Manuel kapatma yalnız üretimdeki (IN_PROGRESS) WO'ya sunulur.
    complete: write && wo.status === "IN_PROGRESS",
    cancel: write && !isClosed(wo.status),
  };
}

export type ActionMenuItem<A extends string> = { kind: "item"; action: A; destructive: boolean } | { kind: "separator" };
export type ActionSlot<A extends string, G extends string> =
  | { kind: "button"; group: G; action: A }
  | { kind: "menu"; group: G; label: string; items: ActionMenuItem<A>[] };

export type HeaderSlot = ActionSlot<HeaderActionId, HeaderGroupId>;
export type HeaderMenuItem = ActionMenuItem<HeaderActionId>;

export function layoutHeaderActions(visible: HeaderActionVisibility): HeaderSlot[] {
  return layoutActionGroups(HEADER_ACTION_GROUPS, visible);
}

// ── Liste yan paneli (quick view): üç düğme — "Detayı Aç" (grupsuz) + Düzenle ▾ + Diğer ▾ ──
export type SheetActionId = HeaderActionId | "edit" | "printHistory";
export type SheetGroupId = "duzenle" | "diger";
export type SheetActionVisibility = Record<SheetActionId, boolean>;

export const SHEET_ACTION_GROUPS: readonly ActionGroup<SheetActionId, SheetGroupId>[] = [
  { id: "duzenle", label: "Düzenle", actions: ["edit", "linkOrder", "unlinkOrder", "changeColor", "changeWidth", "addBatch"] },
  {
    id: "diger",
    label: "Diğer",
    actions: ["fasonReceive", "documents", "events", "printHistory", "complete", "cancel"],
    separateFrom: ["complete", "cancel"],
    destructive: ["cancel"],
  },
];

/** Başlık görünürlüğü + panelin iki ek öğesi; `editable` = çağıran düzenleme yolu verdi mi. */
export function sheetActionVisibility(
  wo: WoForActions,
  permissions: readonly string[],
  editable: boolean,
): SheetActionVisibility {
  return {
    ...headerActionVisibility(wo, permissions),
    edit: editable && canEditWorkOrder(wo, permissions),
    // Baskı geçmişi sayfasıyla AYNI izin kümesi (PrintHistoryLink ile eş).
    printHistory: SYSTEM_PRINT_HISTORY_ACCESS.some((p) => matchesPermission(permissions, p)),
  };
}

export function layoutSheetActions(visible: SheetActionVisibility): ActionSlot<SheetActionId, SheetGroupId>[] {
  return layoutActionGroups(SHEET_ACTION_GROUPS, visible);
}

export function layoutActionGroups<A extends string, G extends string>(
  groups: readonly ActionGroup<A, G>[],
  visible: Record<A, boolean>,
): ActionSlot<A, G>[] {
  const slots: ActionSlot<A, G>[] = [];
  for (const g of groups) {
    const shown = g.actions.filter((a) => visible[a]);
    if (shown.length === 0) continue;
    const [only] = shown;
    if (shown.length === 1 && only) {
      slots.push({ kind: "button", group: g.id, action: only });
      continue;
    }
    const destructive = new Set<A>(g.destructive ?? []);
    const separateFrom = new Set<A>(g.separateFrom ?? g.destructive ?? []);
    const items: ActionMenuItem<A>[] = [];
    let separated = false;
    for (const a of shown) {
      const d = destructive.has(a);
      if (separateFrom.has(a) && !separated && items.length > 0) {
        items.push({ kind: "separator" });
        separated = true;
      }
      items.push({ kind: "item", action: a, destructive: d });
    }
    slots.push({ kind: "menu", group: g.id, label: g.label, items });
  }
  return slots;
}
