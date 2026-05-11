import {
  Package,
  Users2,
  Factory,
  Cog,
  Route as RouteIcon,
  AlertTriangle,
  Award,
  Palette,
  Truck,
  Sparkles,
  Tag,
  Building2,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export interface DefinitionTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
}

export const definitionTiles: DefinitionTile[] = [
  {
    key: "items",
    title: "Ürünler",
    description: "Stok kalemleri ve varyantlar",
    icon: Package,
    to: "/definitions/items",
    permission: "item:read",
  },
  {
    key: "customers",
    title: "Müşteriler",
    description: "Müşteri ve tedarikçi firmalar",
    icon: Users2,
    to: "/definitions/customers",
    permission: "customer:read",
  },
  {
    key: "stations",
    title: "İstasyonlar",
    description: "Üretim istasyonları ve fason birimleri",
    icon: Factory,
    to: "/definitions/stations",
    permission: "station:read",
  },
  {
    key: "machines",
    title: "Makineler",
    description: "İstasyonlardaki makine envanteri",
    icon: Cog,
    to: "/definitions/machines",
    permission: "station:read",
  },
  {
    key: "routes",
    title: "Üretim Rotaları",
    description: "Şablon iş akışları ve istasyon sıraları",
    icon: RouteIcon,
    to: "/definitions/routes",
    permission: "station:read",
  },
  {
    key: "defect-types",
    title: "Hata Tipleri",
    description: "Kalite kontrol hata tanımları",
    icon: AlertTriangle,
    to: "/definitions/defect-types",
    permission: "quality:read",
  },
  {
    key: "quality-grades",
    title: "Kalite Sınıfları",
    description: "A1, A2 vb. kalite kademeleri",
    icon: Award,
    to: "/definitions/quality-grades",
    permission: "quality:read",
  },
  {
    key: "colors",
    title: "Renkler",
    description: "Boyahane renk kataloğu",
    icon: Palette,
    to: "/definitions/colors",
    permission: "item:read",
  },
  {
    key: "fabric-properties",
    title: "Kumaş Özellikleri",
    description: "Yanmazlık, su geçirmezlik gibi kazanımlar",
    icon: Sparkles,
    to: "/definitions/fabric-properties",
    permission: "property:read",
  },
  {
    key: "subcontractor-categories",
    title: "Fason Kategorileri",
    description: "Boyahane, baskı, yıkama gibi hizmet türleri",
    icon: Tag,
    to: "/definitions/subcontractor-categories",
    permission: "subcontractor:read",
  },
  {
    key: "subcontractors",
    title: "Fason Firmalar",
    description: "Dış hizmet sağlayan firmalar ve verdikleri hizmetler",
    icon: Building2,
    to: "/definitions/subcontractors",
    permission: "subcontractor:read",
  },
  {
    key: "station-capabilities",
    title: "İstasyon Yetenekleri",
    description: "Hangi istasyon hangi rengi/özelliği uygulayabiliyor",
    icon: Settings2,
    to: "/definitions/station-capabilities",
    permission: "station:read",
  },
  {
    key: "shipping-tolerance",
    title: "Sevk Eksiklik Toleransı",
    description: "Sipariş kapatma için izin verilen eksik metraj",
    icon: Truck,
    to: "/definitions/shipping-tolerance",
    permission: "admin:settings",
  },
];
