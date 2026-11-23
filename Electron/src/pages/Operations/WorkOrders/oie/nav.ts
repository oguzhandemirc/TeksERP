// İş emri oluştur gezinme durumu (sekme router `state`'i): seçici → Terbiye formu ya da kısayol formu.
import { TERIM } from "@/lib/terim";

export const WORK_ORDER_NEW_PATH = "/operations/work-orders/new";
export const WEAVING_ORDERS_PATH = "/operations/weaving-orders";

/** `hasKursun` yoksa (eski sekme durumu) gramaj bugünkü gibi gösterilir. `id: null` = rotasız (K29 "Okutmayla"). */
export type RouteRef = { id: string | null; name: string; hasKursun?: boolean };

/** K29 S14b: rota uygulaması "Okutmayla" iken seçicideki rotasız seçenek — iş emri adımsız açılır, istasyon okutması ekler. */
export const SCAN_ROUTE_NAME = "Sahada belirlenir (rotasız)";
export const SCAN_ROUTE_HINT = "Rota seçilmez; adımlar istasyonda okutuldukça eklenir.";
export const SCAN_ROUTE_REF: RouteRef = { id: null, name: SCAN_ROUTE_NAME };
export const isScanRouteRef = (r: RouteRef): boolean => r.id === null;
export type OieStart = { kind: "terbiye" } | { kind: "shortcut"; route: RouteRef; noteId?: string };

/** "Dokuma İş Emri oluştur" seçicisi (İE ayrımı 2026-11-23): Standart + özel dokuma şablonları. */
export const WEAVING_ORDER_NEW_PATH = "/operations/weaving-orders/new";

/** Dokuma iş emirleri sayfası bu durumla açılınca oluşturma diyaloğu kendiliğinden açılır; `preset` = özel şablonun ön-dolgusu. */
export type WeavingNavState = { openNew?: boolean; preset?: WeavingFormPreset };

/** Şablondan gelen form alanları (formun metin biçiminde; boş alan gönderilmez = formun varsayılanı). */
export type WeavingFormPreset = Partial<Record<"itemId" | "subcontractorId" | "plannedM" | "notes", string>> & {
  executionKind?: "IN_HOUSE" | "SUBCONTRACTED";
};

/** "Yeni özel iş emri" (K20): rota şablonları sayfası yeni kayıt diyaloğu açık + "Kısayol" işaretli gelir. */
export const ROUTES_PATH = "/definitions/routes";
export type RoutesNavState = { newShortcut?: boolean };
export const NEW_SHORTCUT_STATE: RoutesNavState = { newShortcut: true };

/** Yeni kayıt sayfa başlığı: kısayolda "<kısayol adı> iş emri", değilse bugünkü başlık. */
export function newWorkOrderTitle(start: OieStart | null | undefined): string {
  if (start?.kind === "shortcut") return `${start.route.name} ${TERIM.terbiyeIsEmri.tekilKucuk}`;
  return `Yeni ${TERIM.terbiyeIsEmri.tekil}`;
}
