// Telefon alt sekmeleri (K3): Pano · Üretim · Siparişler · Finans · Diğer. Yollar SABİT — bildirim rotaları,
// `safeRoute` ve `public/bildirim-sw.js` bunlara bağlı. İzinsiz sekme çizilmez (`href: null`); Pano ve Diğer hep var.
import { moduleVisible, type ModuleKey } from "../lib/access";
import { MODULE_ICON, MORE_ICON, type IconName } from "./icons";
import type { Domain } from "./tokens";

export interface TabDef {
  /** `app/(app)/(tabs)/` altındaki rota adı. */
  readonly name: "pano" | "uretim" | "siparisler" | "finans" | "diger";
  readonly title: string;
  readonly route: string;
  /** Görünürlük bu modülün iznine bağlı; yoksa her hesapta görünür. */
  readonly module?: ModuleKey;
  readonly icon: IconName;
  readonly domain: Domain;
}

export const TABS: readonly TabDef[] = [
  { name: "pano", title: "Pano", route: "/pano", module: "pano", icon: MODULE_ICON.pano.icon, domain: "genel" },
  { name: "uretim", title: "Üretim", route: "/uretim", module: "uretim", icon: MODULE_ICON.uretim.icon, domain: "uretim" },
  { name: "siparisler", title: "Siparişler", route: "/siparisler", module: "siparisler", icon: MODULE_ICON.siparisler.icon, domain: "siparisler" },
  { name: "finans", title: "Finans", route: "/finans", module: "finans", icon: MODULE_ICON.finans.icon, domain: "finans" },
  { name: "diger", title: "Diğer", route: "/diger", icon: MORE_ICON, domain: "genel" },
];

export function tabVisible(perms: readonly string[], tab: TabDef): boolean {
  return tab.module === undefined || moduleVisible(perms, tab.module);
}

export function visibleTabs(perms: readonly string[]): TabDef[] {
  return TABS.filter((t) => tabVisible(perms, t));
}

/** "Diğer" listesi: sekmeye sığmayan bölümler, gruplu. */
export const MORE_GROUPS: readonly { readonly title: string; readonly modules: readonly ModuleKey[] }[] = [
  { title: "İş", modules: ["cariler", "sevkiyat", "stok", "teklifler", "standart-maliyetler", "raporlar"] },
  { title: "Eylem", modules: ["gelen-kutusu"] },
  { title: "Hesap", modules: ["bildirimler", "hesaplar", "profil"] },
];

/** Geniş ekran rayı: önce sekmelerle AYNI sırada ana bölümler, sonra başlıklı gruplar (gelen kutusu "İş" altında). */
export const RAIL_GROUPS: readonly { readonly title: string | null; readonly modules: readonly ModuleKey[] }[] = [
  { title: null, modules: TABS.flatMap((t) => (t.module ? [t.module] : [])) },
  { title: "İş", modules: ["cariler", "sevkiyat", "stok", "teklifler", "standart-maliyetler", "raporlar", "gelen-kutusu"] },
  { title: "Hesap", modules: ["bildirimler", "hesaplar", "profil"] },
];
