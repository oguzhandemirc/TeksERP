// Pano tıklama hedefleri — HER adres route'un kendi iznini taşır (`content-routes.tsx` ile birebir);
// tıklanabilirlik `usePanoErisim().canGo` ile izin + yol modülü + rapor kapısından ölçülür.
import {
  ClipboardPlus,
  Factory,
  FilePlus2,
  FileStack,
  PackageCheck,
  PackageOpen,
  Send,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { RouteTarget } from "@/hooks/useRouteAccess";
import { TERIM } from "@/lib/terim";
import type { PanoHareket } from "./types";

/** Pano hedefi = ortak yol hedefi (`useRouteAccess`). */
export type PanoTarget = RouteTarget;

const FASON_KOKPITI: PanoTarget = { to: "/operations/fason-kokpiti", izin: ["subcontractor:read", "workorder:read"] };

export const KPI_TARGETS = {
  uretim: { to: "/reports/quality/scorecard", izin: ["report:quality"] },
  sevk: { to: "/operations/shipments", izin: ["shipping:read"] },
  siparis: { to: "/operations/orders", izin: ["order:read"] },
  fason: FASON_KOKPITI,
  stok: { to: "/reports/inventory/scorecard", izin: ["report:inventory"] },
  ciro: { to: "/reports/sales/destination-mix", izin: ["report:sales"] },
  tahsilat: { to: "/finance/payments", izin: ["finance:read"] },
} as const satisfies Record<string, PanoTarget>;

export const BOX_TARGETS = {
  tezgah: { to: "/operations/weaving-floor", izin: ["loom:live-view"] },
  stokOzeti: { to: "/operations/rolls", izin: ["roll:read"] },
  fasonOzeti: FASON_KOKPITI,
  onayBekleyenBelge: { to: "/operations/gelen-belgeler", izin: ["gelen-belge:read"] },
  sevkeHazir: { to: "/operations/sevke-hazir-isler", izin: ["shipping:read"] },
  uretimeGonderilmemis: { to: "/operations/orders?filter[woState]=NONE", izin: ["order:read"] },
  alacak: { to: "/reports/finance/aging", izin: ["report:finance"] },
  urun: { to: "/definitions/items", izin: ["item:read"] },
  musteriSiparis: { to: "/reports/sales/order-intake", izin: ["report:sales"] },
  musteriSevk: { to: "/reports/sales/shipment-scorecard", izin: ["report:sales"] },
  istasyonUretim: { to: "/reports/production/wip", izin: ["report:production"] },
  isEmri: { to: "/operations/work-orders", izin: ["workorder:read"] },
  kalite: { to: "/reports/quality/scorecard", izin: ["report:quality"] },
  fire: { to: "/reports/quality/scrap-scorecard", izin: ["report:quality"] },
  stokHareket: { to: "/reports/inventory/scorecard", izin: ["report:inventory"] },
  nakit: { to: "/reports/finance/cash-book", izin: ["report:finance"] },
  alis: { to: "/operations/purchase-orders", izin: ["purchase-order:read", "purchase-order:write"] },
  dokuma: { to: "/operations/weaving-orders", izin: ["weavingorder:read"] },
  sevkiyat: { to: "/operations/shipments", izin: ["shipping:read"] },
} as const satisfies Record<string, PanoTarget>;

/** Hareket satırı → kaydın ekranı. Fason sevk/kabulün kendi ekranı yok: iş emri detayı, dokuma işinde kokpit. */
export function movementTarget(h: Pick<PanoHareket, "hedef">): PanoTarget {
  const id = encodeURIComponent(h.hedef.id);
  switch (h.hedef.tur) {
    case "order":
      return { to: `/operations/orders?focus=${id}`, izin: ["order:read"] };
    case "shipment":
      return { to: `/operations/shipments/${id}`, izin: ["shipping:read"] };
    case "directShipment":
      return { to: `/operations/shipments/direct/${id}`, izin: ["shipping:read"] };
    case "subcontractorDispatch":
    case "subcontractorReceipt":
      return h.hedef.isEmriId
        ? { to: `/operations/work-orders/${encodeURIComponent(h.hedef.isEmriId)}`, izin: ["workorder:read"] }
        : FASON_KOKPITI;
    case "goodsReceipt":
      return { to: `/operations/goods-receipts?focus=${id}`, izin: ["goods-receipt:read"] };
    case "deliveryNote":
      return { to: `/operations/gelen-belgeler/${id}`, izin: ["gelen-belge:read"] };
  }
}

export interface HizliEylem extends PanoTarget {
  key: string;
  label: string;
  /** Simge altındaki dar etiket (iki satır); yoksa `label`. Tam ad ipucu/erişilebilir adda kalır. */
  kisa?: string;
  icon: LucideIcon;
  tone: IconTileTone;
}

/** Sık işler — yazma izni (route'un ya da ekrandaki düğmenin izni); kapalı modülde yol kapısı gizler. */
export const HIZLI_EYLEMLER: readonly HizliEylem[] = [
  { key: "order-new", label: "Yeni sipariş", icon: ClipboardPlus, tone: "blue", to: "/operations/orders?action=new", izin: ["order:write"] },
  { key: "wo-new", get label() { return `${TERIM.terbiyeIsEmri.tekil} oluştur`; }, get kisa() { return TERIM.terbiyeIsEmri.tekil; }, icon: Factory, tone: "orange", to: "/operations/work-orders/new", izin: ["workorder:write"] },
  { key: "gr-new", label: "Mal kabul", icon: PackageCheck, tone: "teal", to: "/operations/goods-receipts?action=new", izin: ["goods-receipt:write"] },
  { key: "ready", label: "Sevke hazır", icon: Truck, tone: "green", to: "/operations/sevke-hazir-isler", izin: ["shipping:write"] },
  { key: "notes", label: "Gelen belgeler", icon: FileStack, tone: "sky", to: "/operations/gelen-belgeler", izin: ["gelen-belge:read"] },
  { key: "quote-new", label: "Yeni teklif", icon: FilePlus2, tone: "rose", to: "/cost/quotes/new", izin: ["quote:write"] },
  { key: "rolls", label: "Kumaş stoğu", icon: PackageOpen, tone: "violet", to: "/operations/rolls", izin: ["roll:read"] },
  { key: "fason", label: "Fason kokpiti", icon: Send, tone: "amber", ...FASON_KOKPITI },
];
