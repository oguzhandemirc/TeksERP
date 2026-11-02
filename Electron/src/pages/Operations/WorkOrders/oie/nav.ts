// İş emri oluştur gezinme durumu (sekme router `state`'i): seçici → Terbiye formu ya da kısayol formu.
import { TERIM } from "@/lib/terim";

export const WORK_ORDER_NEW_PATH = "/operations/work-orders/new";
export const WEAVING_ORDERS_PATH = "/operations/weaving-orders";

export type RouteRef = { id: string; name: string };
export type OieStart = { kind: "terbiye" } | { kind: "shortcut"; route: RouteRef; noteId?: string };

/** Dokuma iş emirleri sayfası bu durumla açılınca oluşturma diyaloğu kendiliğinden açılır. */
export type WeavingNavState = { openNew?: boolean };

/** Yeni kayıt sayfa başlığı: kısayolda "<kısayol adı> iş emri", değilse bugünkü başlık. */
export function newWorkOrderTitle(start: OieStart | null | undefined): string {
  if (start?.kind === "shortcut") return `${start.route.name} iş emri`;
  return `Yeni ${TERIM.terbiyeIsEmri.tekil}`;
}
