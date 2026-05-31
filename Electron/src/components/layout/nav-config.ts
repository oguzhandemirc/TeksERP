import {
  LayoutDashboard,
  Library,
  ShieldCheck,
  ScrollText,
  ServerCog,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: string;
  adminOnly?: boolean;
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
