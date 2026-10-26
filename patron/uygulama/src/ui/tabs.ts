// Telefon alt sekmeleri (K3): Pano · Üretim · Siparişler · Finans · Diğer. Yollar SABİT — bildirim rotaları,
// `safeRoute` ve `public/bildirim-sw.js` bunlara bağlı. İzinsiz sekme çizilmez (`href: null`); Pano ve Diğer hep var.
import { moduleNavTitle, moduleVisible, type ModuleKey } from "../lib/access";
import { MODULE_ICON, MORE_ICON, type IconName } from "./icons";
import type { Domain } from "./tokens";

export interface TabDef {
  /** `app/(app)/(tabs)/` altındaki rota adı. */
  readonly name: "pano" | "uretim" | "siparisler" | "finans" | "diger";
  /** Modül sekmesinde `access.ts` gezinme adından türer (tek kaynak). */
  readonly title: string;
  readonly route: string;
  /** Görünürlük bu modülün iznine bağlı; yoksa her hesapta görünür. */
  readonly module?: ModuleKey;
  readonly icon: IconName;
  readonly domain: Domain;
}

export const TABS: readonly TabDef[] = [
  { name: "pano", title: moduleNavTitle("pano"), route: "/pano", module: "pano", icon: MODULE_ICON.pano.icon, domain: "genel" },
  { name: "uretim", title: moduleNavTitle("uretim"), route: "/uretim", module: "uretim", icon: MODULE_ICON.uretim.icon, domain: "uretim" },
  { name: "siparisler", title: moduleNavTitle("siparisler"), route: "/siparisler", module: "siparisler", icon: MODULE_ICON.siparisler.icon, domain: "siparisler" },
  { name: "finans", title: moduleNavTitle("finans"), route: "/finans", module: "finans", icon: MODULE_ICON.finans.icon, domain: "finans" },
  { name: "diger", title: "Diğer", route: "/diger", icon: MORE_ICON, domain: "genel" },
];

export function tabVisible(perms: readonly string[], tab: TabDef): boolean {
  return tab.module === undefined || moduleVisible(perms, tab.module);
}

export function visibleTabs(perms: readonly string[]): TabDef[] {
  return TABS.filter((t) => tabVisible(perms, t));
}

/** Sekmeye sığmayan bölümlerin TEK grup tablosu (UX-4 P2): dar ekranda "Diğer" listesi, geniş ekranda rayın
 *  sekme bölümlerinden sonraki grupları AYNI başlık ve sırayla bundan çizer. */
export const NAV_GROUPS: readonly { readonly title: string; readonly modules: readonly ModuleKey[] }[] = [
  { title: "İş", modules: ["cariler", "sevkiyat", "stok", "raporlar", "gelen-kutusu"] },
  { title: "Hesap", modules: ["bildirimler", "hesaplar", "profil"] },
];

export const MORE_GROUPS = NAV_GROUPS;

/** Geniş ekran rayı: önce sekmelerle AYNI sırada ana bölümler (başlıksız), sonra `NAV_GROUPS`. */
export const RAIL_GROUPS: readonly { readonly title: string | null; readonly modules: readonly ModuleKey[] }[] = [
  { title: null, modules: TABS.flatMap((t) => (t.module ? [t.module] : [])) },
  ...NAV_GROUPS,
];
