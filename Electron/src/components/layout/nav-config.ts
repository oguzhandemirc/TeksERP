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
   * Bu satırın bağlı olduğu özellik bayrağı. Bayrak KAPALIYSA satır hiç
   * çizilmez — izin taşıyan kullanıcıda bile.
   *
   * ⚠️ Bayrak bir GÖRÜNÜRLÜK süsü değil REJİM kapısıdır: backend de aynı
   * bayrağa bakıp 403 döner (`requireFinanceEnabled`). İki taraf ayrışırsa
   * kullanıcı menüde göremediği ama adresle açabildiği bir modül bulur.
   */
  featureFlag?: "financeEnabled";
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
