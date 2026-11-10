// İE detay başlığının eylem yerleşimi — saf (JSX'siz): her eylemin görünürlüğü + grup → öğe eşlemesi.
// Görünürlük koşulları eski düz düğmelerle birebir; yalnız yerleşim değişir (boş grup çizilmez, tek öğeli grup düz düğme).
import { matchesPermission } from "@/types/auth";
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

export interface HeaderGroup {
  id: HeaderGroupId;
  label: string;
  actions: readonly HeaderActionId[];
  /** Menüde bunlardan önce ayırıcı çizilir (yıkıcı eylemler en altta, ayrı). */
  destructive?: readonly HeaderActionId[];
}

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

export type HeaderSlot =
  | { kind: "button"; group: HeaderGroupId; action: HeaderActionId }
  | { kind: "menu"; group: HeaderGroupId; label: string; items: HeaderMenuItem[] };

export type HeaderMenuItem = { kind: "item"; action: HeaderActionId; destructive: boolean } | { kind: "separator" };

export function layoutHeaderActions(visible: HeaderActionVisibility): HeaderSlot[] {
  const slots: HeaderSlot[] = [];
  for (const g of HEADER_ACTION_GROUPS) {
    const shown = g.actions.filter((a) => visible[a]);
    if (shown.length === 0) continue;
    const [only] = shown;
    if (shown.length === 1 && only) {
      slots.push({ kind: "button", group: g.id, action: only });
      continue;
    }
    const destructive = new Set(g.destructive ?? []);
    const items: HeaderMenuItem[] = [];
    let separated = false;
    for (const a of shown) {
      const d = destructive.has(a);
      if (d && !separated && items.length > 0) {
        items.push({ kind: "separator" });
        separated = true;
      }
      items.push({ kind: "item", action: a, destructive: d });
    }
    slots.push({ kind: "menu", group: g.id, label: g.label, items });
  }
  return slots;
}
