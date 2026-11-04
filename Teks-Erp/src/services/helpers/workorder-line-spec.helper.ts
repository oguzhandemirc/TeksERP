// =============================================================================
// Bir iş emri TEK kumaş + TEK renk üretir — bağlı sipariş kalemleri için tek kapı.
// =============================================================================
// Saha vakası (2026-11): tek iş emrine BEYAZ + EKRU kalem bağlandı, hedef renk NULL
// kaldı, mal boyahaneye renksiz gitti. Eski denetim yalnız `targetColorId === undefined`
// iken koşuyordu; tablet hep `null` gönderdiği için atlanıyordu. Bu helper hedefe
// BAKMAZ: kalem kümesinde birden fazla kumaş ya da null-olmayan renk varsa her yolda
// 400 (create · quickStart · replace · sonradan bağlama). Kural TEK yerde;
// `test_wo_mixed_color_guard` §0 çağrı noktalarını AST ile ölçer.
// =============================================================================
import { AppError } from "../../utils/app-error";
import { TERIM } from "../../constants/terim";

export const WO_LINES_MIXED_COLOR_CODE = "WO_LINES_MIXED_COLOR";
export const WO_LINES_MIXED_ITEM_CODE = "WO_LINES_MIXED_ITEM";

export interface WorkOrderSpecLine {
  itemId: string;
  colorId: string | null;
  itemName?: string | null;
  colorName?: string | null;
  orderNumber?: string | null;
}

/** "BEYAZ (S-1, S-2) · EKRU (S-3)" — hangi kalemin hangi tarafta olduğunu söyler. */
function describeGroups(lines: WorkOrderSpecLine[], key: (l: WorkOrderSpecLine) => string, label: (l: WorkOrderSpecLine) => string): string {
  const groups = new Map<string, { label: string; orders: Set<string> }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k) ?? { label: label(l), orders: new Set<string>() };
    if (l.orderNumber) g.orders.add(l.orderNumber);
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => (g.orders.size > 0 ? `${g.label} (${[...g.orders].join(", ")})` : g.label))
    .join(" · ");
}

/**
 * İş emrine bağlanacak (+ bağlı) kalemler tek kumaş ve en çok bir null-olmayan renk
 * içermeli; değilse 400 `WO_LINES_MIXED_ITEM` / `WO_LINES_MIXED_COLOR`.
 * Renksiz (null) kalem renkli kalemle karışabilir — hedef rengi o renkli kalem belirler.
 */
export function assertWorkOrderLinesSingleSpec(lines: readonly WorkOrderSpecLine[]): void {
  const items = new Set(lines.map((l) => l.itemId));
  if (items.size > 1) {
    throw AppError.badRequest(
      `Bir ${TERIM.terbiyeIsEmri.tekilKucuk} tek kumaş üretir — seçilen sipariş kalemleri farklı kumaşlar içeriyor: ` +
        `${describeGroups([...lines], (l) => l.itemId, (l) => l.itemName ?? "—")}. Her kumaş için ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} açın.`,
      { code: WO_LINES_MIXED_ITEM_CODE, itemIds: [...items] },
    );
  }
  const colored = lines.filter((l) => l.colorId != null);
  const colors = new Set(colored.map((l) => l.colorId as string));
  if (colors.size > 1) {
    throw AppError.badRequest(
      `Bir ${TERIM.terbiyeIsEmri.tekilKucuk} tek renk üretir — seçilen sipariş kalemleri farklı renkler içeriyor: ` +
        `${describeGroups(colored, (l) => l.colorId as string, (l) => l.colorName ?? "—")}. Her renk için ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} açın.`,
      { code: WO_LINES_MIXED_COLOR_CODE, colorIds: [...colors] },
    );
  }
}
