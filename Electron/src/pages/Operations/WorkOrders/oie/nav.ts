// İş emri oluştur gezinme durumu (sekme router `state`'i): seçici → Terbiye formu ya da kısayol formu.
import { TERIM } from "@/lib/terim";

export const WORK_ORDER_NEW_PATH = "/operations/work-orders/new";
export const WEAVING_ORDERS_PATH = "/operations/weaving-orders";

/** `hasKursun` yoksa (eski sekme durumu) gramaj bugünkü gibi gösterilir. */
export type RouteRef = { id: string; name: string; hasKursun?: boolean };
export type OieStart = { kind: "terbiye" } | { kind: "shortcut"; route: RouteRef; noteId?: string };

/** Dokuma iş emirleri sayfası bu durumla açılınca oluşturma diyaloğu kendiliğinden açılır. */
export type WeavingNavState = { openNew?: boolean };

/** "Yeni özel iş emri" (K20): rota şablonları sayfası yeni kayıt diyaloğu açık + "Kısayol" işaretli gelir. */
export const ROUTES_PATH = "/definitions/routes";
export type RoutesNavState = { newShortcut?: boolean };
export const NEW_SHORTCUT_STATE: RoutesNavState = { newShortcut: true };

/** Yeni kayıt sayfa başlığı: kısayolda "<kısayol adı> iş emri", değilse bugünkü başlık. */
export function newWorkOrderTitle(start: OieStart | null | undefined): string {
  if (start?.kind === "shortcut") return `${start.route.name} ${TERIM.terbiyeIsEmri.tekilKucuk}`;
  return `Yeni ${TERIM.terbiyeIsEmri.tekil}`;
}
