import {
  LayoutDashboard,
  Library,
  ShieldCheck,
  ScrollText,
  ServerCog,
  ClipboardList,
  Calculator,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: string;
  adminOnly?: boolean;
  /** Opsiyonel sayısal rozet (bekleyen iş / uyarı). Veri bağlandığında dolar. */
  badge?: number;
  /**
   * Bu satırın bağlı olduğu MODÜL anahtarı. Bayrak KAPALIYSA satır hiç
   * çizilmez — izin taşıyan kullanıcıda bile.
   *
   * ⚠️ Bayrak bir GÖRÜNÜRLÜK süsü değil REJİM kapısıdır: backend de aynı
   * bayrağa bakıp 403 döner (`requireFinanceEnabled` · `requireTicaretEnabled` …).
   * İki taraf ayrışırsa kullanıcı menüde göremediği ama adresle açabildiği bir
   * modül bulur.
   *
   * ⚠️ DEĞER `OperationsVisibilityContext` ALAN ADIDIR ve karar O BAĞLAMDAN
   * okunur (`Sidebar.visible` · komut paleti). Union 2026-09-03'te beş modüle
   * genişledi; genişletmenin ÖN KOŞULU Sidebar'daki jenerik `?? false`
   * varsayılanının kaldırılmasıydı: `productionEnabled`ın backend varsayılanı
   * AÇIK, yani `?? false` ile okunsaydı fabrikada üretim menüsü bayrak
   * yüklenene kadar KAYBOLUR ve gözle görülür bir titreme doğardı ("sıfır
   * görünür fark" kuralının doğrudan ihlali).
   *
   * ⚠️ MENÜDE BUGÜN ÜRETİM SATIRI YOK: üretim ekranlarına "Operasyon" ve
   * "Tanımlar" hub'larından giriliyor ve o iki satır ÇEKİRDEKTİR (bayrağa
   * bağlanamaz — bağlansaydı üretim kapalı bir kurulumda depo/sipariş/sevkiyat
   * karoları da menüden kaybolurdu). Üretim kapısı bu yüzden HUB KAROLARINDA
   * uygulanır (`Operations/production-regime.ts` · `Definitions/production-regime.ts`),
   * menü satırında değil.
   */
  featureFlag?:
    | "financeEnabled"
    | "productionEnabled"
    | "ticaretEnabled"
    | "iplikEnabled"
    | "depoMultiEnabled";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Genel",
    items: [
      { label: "Anasayfa", to: "/", icon: LayoutDashboard },
      { label: "Tanımlar", to: "/definitions", icon: Library },
      { label: "Operasyon", to: "/operations", icon: ClipboardList },
      { label: "Raporlar", to: "/reports", icon: ScrollText },
      {
        label: "Muhasebe",
        to: "/finance",
        icon: Calculator,
        permission: "finance:read",
        featureFlag: "financeEnabled",
      },
    ],
  },
  {
    label: "Yönetim",
    items: [
      {
        label: "Yetkilendirme",
        to: "/access",
        icon: ShieldCheck,
        adminOnly: true,
      },
      {
        label: "Sistem",
        to: "/system",
        icon: ServerCog,
        adminOnly: true,
      },
    ],
  },
];
