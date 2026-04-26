import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Users,
  Factory,
  Cog,
  Route,
  Cylinder,
  ShoppingCart,
  ClipboardList,
  Play,
  CircleDot,
  Truck,
  Shield,
  ScrollText,
  BarChart3,
  ScanLine,
  Ticket,
  PackageCheck,
  Palette,
  Plus,
  AlertTriangle,
  Sparkles,
  Warehouse,
  Layers,
  Trash2,
  Handshake,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permissions?: string[];
  roles?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigationConfig: NavGroup[] = [
  {
    label: "Genel",
    items: [
      {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Tanımlar",
    items: [
      {
        title: "Stok Kartları",
        href: "/items",
        icon: Package,
        permissions: ["station:read"],
      },
      {
        title: "Müşteriler",
        href: "/customers",
        icon: Users,
        permissions: ["customer:read"],
      },
      {
        title: "İstasyonlar",
        href: "/stations",
        icon: Factory,
        permissions: ["station:read"],
      },
      {
        title: "Makineler",
        href: "/machines",
        icon: Cog,
        permissions: ["station:read"],
      },
      {
        title: "Rotalar",
        href: "/routes",
        icon: Route,
        permissions: ["station:read"],
      },
      {
        title: "Hata Tipleri",
        href: "/defect-types",
        icon: AlertTriangle,
        permissions: ["quality:read"],
      },
      {
        title: "Kalite Dereceleri",
        href: "/quality-grades",
        icon: Sparkles,
        permissions: ["quality:read"],
      },
    ],
  },
  {
    label: "Depo",
    items: [
      {
        title: "Toplar (Tümü)",
        href: "/rolls",
        icon: Cylinder,
        permissions: ["roll:read"],
      },
      {
        title: "Ham Depo",
        href: "/depo/ham",
        icon: Layers,
        permissions: ["roll:read"],
      },
      {
        title: "Mamul Depo",
        href: "/depo/mamul",
        icon: Warehouse,
        permissions: ["roll:read"],
      },
      {
        title: "A1 / 2. Kalite",
        href: "/depo/a1",
        icon: Sparkles,
        permissions: ["roll:read"],
      },
      {
        title: "Fire Deposu",
        href: "/depo/fire",
        icon: Trash2,
        permissions: ["roll:read"],
      },
      {
        title: "Numune Kartelası",
        href: "/swatches",
        icon: Palette,
        permissions: ["roll:read"],
      },
    ],
  },
  {
    label: "Satış",
    items: [
      {
        title: "Siparişler",
        href: "/orders",
        icon: ShoppingCart,
        permissions: ["order:read"],
      },
      {
        title: "Fason Üretim Kabul",
        href: "/service-production",
        icon: Handshake,
        permissions: ["roll:write"],
      },
    ],
  },
  {
    label: "Kalite Kontrol",
    items: [
      {
        title: "KK1 — Ham Stok",
        href: "/kk1",
        icon: ScanLine,
        permissions: ["roll:read"],
      },
      {
        title: "Kurşun + KK2",
        href: "/kursun-qc",
        icon: Shield,
        permissions: ["quality:read"],
      },
    ],
  },
  {
    label: "Saha",
    items: [
      {
        title: "İstasyon İşlemleri",
        href: "/station",
        icon: Cog,
        permissions: ["workorder:write"],
      },
      {
        title: "Top Bağlama",
        href: "/field/attach-rolls",
        icon: ClipboardList,
        permissions: ["workorder:write"],
      },
      {
        title: "Refakat Kartı Tarama",
        href: "/field/traveler-scan",
        icon: Ticket,
        permissions: ["workorder:read"],
      },
    ],
  },
  {
    label: "Üretim",
    items: [
      {
        title: "İş Emirleri",
        href: "/work-orders",
        icon: ClipboardList,
        permissions: ["workorder:read"],
      },
      {
        title: "Üretim Akışı",
        href: "/production",
        icon: Play,
        permissions: ["roll:read"],
      },
      {
        title: "Tambur",
        href: "/tambur",
        icon: CircleDot,
        permissions: ["quality:read"],
      },
      {
        title: "Paket / Tartı / Etiket",
        href: "/paketleme",
        icon: PackageCheck,
        permissions: ["roll:read"],
      },
    ],
  },
  {
    label: "Fason",
    items: [
      {
        title: "Sevk Belgeleri",
        href: "/subcontractor/dispatches",
        icon: Truck,
        permissions: ["workorder:read"],
      },
      {
        title: "Yeni Sevk",
        href: "/subcontractor/dispatches/new",
        icon: Plus,
        permissions: ["workorder:write"],
      },
      {
        title: "Kabul Belgeleri",
        href: "/subcontractor/receipts",
        icon: PackageCheck,
        permissions: ["workorder:read"],
      },
      {
        title: "Yeni Kabul",
        href: "/subcontractor/receipts/new",
        icon: Plus,
        permissions: ["workorder:write"],
      },
    ],
  },
  {
    label: "Lojistik",
    items: [
      {
        title: "Sevkiyat",
        href: "/shipping",
        icon: Truck,
        permissions: ["shipment:read"],
      },
    ],
  },
  {
    label: "Raporlama",
    items: [
      {
        title: "Merkezi Raporlar",
        href: "/reports",
        icon: BarChart3,
        permissions: ["order:read"],
      },
    ],
  },
  {
    label: "Yönetim",
    items: [
      {
        title: "Kullanıcılar",
        href: "/users",
        icon: Shield,
        permissions: ["admin:users"],
      },
      {
        title: "Sistem Logları",
        href: "/logs",
        icon: ScrollText,
        permissions: ["admin:users"],
      },
    ],
  },
];
