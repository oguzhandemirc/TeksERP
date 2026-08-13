import {
  Package,
  Users2,
  Factory,
  Cog,
  Route as RouteIcon,
  FlaskConical,
  AlertTriangle,
  Award,
  Palette,
  Sparkles,
  Tag,
  Building2,
  Settings2,
  Tags,
  Undo2,
  Warehouse,
  FileText,
  Printer,
  Ruler,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";
import type { DefinitionGroupKey } from "./groups-config";
import { DOCUMENT_DESIGN_READ } from "@/lib/permissions";

export interface DefinitionTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: DefinitionGroupKey;
  permission?: string;
  /**
   * Bunlardan HERHANGİ biri yeterli. `permission` ile birlikte verilmez —
   * route guard'ıyla (`ProtectedRoute requireAnyPermission`) aynı listeyi
   * taşımalı, yoksa kart görünür ama tıklayınca /forbidden'a düşer.
   */
  permissionAny?: string[];
}

export const definitionTiles: DefinitionTile[] = [
  {
    key: "items",
    title: "Kumaşlar",
    description: "Stok kalemleri ve varyantlar",
    icon: Package,
    to: "/definitions/items",
    group: "catalog",
    permission: "item:read",
  },
  {
    key: "fabric-properties",
    title: "Kumaş Özellikleri",
    description: "Yanmazlık, su geçirmezlik gibi kazanımlar",
    icon: Sparkles,
    to: "/definitions/fabric-properties",
    group: "catalog",
    permission: "property:read",
  },
  {
    key: "colors",
    title: "Renkler",
    description: "Boyahane renk kataloğu",
    icon: Palette,
    to: "/definitions/colors",
    group: "catalog",
    permission: "property:read", // Y7 fix: backend color.routes property:read ister
  },
  {
    key: "quality-grades",
    title: "Kalite Sınıfları",
    description: "Sistem sabit kalite kademeleri (salt okunur)",
    icon: Award,
    to: "/definitions/quality-grades",
    group: "catalog",
    permission: "quality:read",
  },
  {
    key: "return-reasons",
    title: "İade Nedenleri",
    description: "Müşteri iadesi neden kataloğu",
    icon: Undo2,
    to: "/definitions/return-reasons",
    // Ürün niteliği değil, kalite/iade olay kodu — Hata Tipleri ile aynı grupta.
    group: "production",
    permission: "return:read",
  },
  {
    key: "warehouses",
    title: "Depolar",
    description: "Fiziksel depo tanımları + varsayılan depo",
    icon: Warehouse,
    to: "/definitions/warehouses",
    group: "production",
    // ⚠️ İzin route ile BİREBİR (`content-routes.tsx`): ayrışırsa kart görünür,
    // tıklayınca /forbidden'a düşer.
    permission: "warehouse:read",
  },
  {
    key: "customers",
    title: "Müşteriler",
    description: "Müşteri ve tedarikçi firmalar",
    icon: Users2,
    to: "/definitions/customers",
    group: "partners",
    permission: "customer:read",
  },
  {
    key: "subcontractors",
    title: "Fason Firmalar",
    description: "Dış hizmet sağlayan firmalar ve verdikleri hizmetler",
    icon: Building2,
    to: "/definitions/subcontractors",
    group: "partners",
    permission: "subcontractor:read",
  },
  {
    key: "subcontractor-categories",
    title: "Fason Kategorileri",
    description: "Boyahane, baskı, yıkama gibi hizmet türleri",
    icon: Tag,
    to: "/definitions/subcontractor-categories",
    group: "partners",
    permission: "subcontractor:read",
  },
  {
    key: "stations",
    title: "Üretim İstasyonları",
    description: "İstasyonlar + makineleri + (fason) renk/özellik yetenekleri — tek yerde, bilgi",
    icon: Factory,
    to: "/definitions/stations",
    group: "production",
    permission: "station:read",
  },
  {
    key: "peripherals",
    title: "Donanım",
    description: "Yazıcı + kantar/metraj cihazları (ağ/Bluetooth/USB/seri) — tür, dil/komut, adres",
    icon: Printer,
    to: "/definitions/peripherals",
    group: "production",
    permission: "station:read",
  },
  {
    key: "labels",
    title: "Etiketler",
    description: "Etiket boyutları (mm) + düzenleri (alan yerleşimi / uzman yazıcı kodu).",
    icon: Tags,
    to: "/definitions/labels",
    group: "cikti",
    permission: "station:read",
  },
  {
    key: "routes",
    title: "Üretim Rotaları",
    description: "Şablon iş akışları ve istasyon sıraları",
    icon: RouteIcon,
    to: "/definitions/routes",
    group: "production",
    permission: "station:read",
  },
  {
    key: "product-recipes",
    title: "İş Emri Şablonları",
    description: "Kumaş + renk + özellik + en + rota — hazır iş emri şablonları",
    icon: FlaskConical,
    to: "/definitions/product-recipes",
    group: "production",
    permission: "station:read",
  },
  {
    key: "defect-types",
    title: "Hata Tipleri",
    description: "Kalite kontrol hata tanımları",
    icon: AlertTriangle,
    to: "/definitions/defect-types",
    group: "production",
    permission: "quality:read",
  },
  {
    key: "document-templates",
    title: "Belge Şablonları",
    description: "İrsaliye/çeki içeriği: bölüm aç-kapa, başlık, künye, imza, alt not (canlı önizleme)",
    icon: FileText,
    to: "/definitions/document-templates",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "traveler-card",
    title: "Refakat Kartı",
    description: "Refakat kartında basılan firma adı/künyesi ve görünecek bölümler",
    icon: Printer,
    to: "/definitions/traveler-card",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "traveler-card-studio",
    title: "Refakat Kartı Şablonları",
    description: "Bölümleri sırala/aç-kapa ya da uzman modunda kartın tüm HTML'ini kendin yaz",
    icon: LayoutTemplate,
    to: "/definitions/traveler-card-studio",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "free-documents",
    title: "Serbest Belgeler",
    description: "Sisteme bağlı olmayan serbest belgeler — üst yazı, tutanak, dekont, duyuru",
    icon: FileText,
    to: "/definitions/free-documents",
    group: "cikti",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
];
