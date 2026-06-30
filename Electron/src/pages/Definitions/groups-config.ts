import {
  Layers,
  Handshake,
  Factory,
  Printer,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type DefinitionGroupKey =
  | "catalog"
  | "partners"
  | "production"
  | "cikti"
  | "system";

export interface DefinitionGroup {
  key: DefinitionGroupKey;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const definitionGroups: DefinitionGroup[] = [
  {
    key: "catalog",
    title: "Ürün Kataloğu",
    description: "Ürünler, kumaş özellikleri, renkler ve kalite sınıfları",
    icon: Layers,
  },
  {
    key: "partners",
    title: "İş Ortakları",
    description: "Müşteriler ve fason firmalar",
    icon: Handshake,
  },
  {
    key: "production",
    title: "Üretim & Kalite",
    description: "İstasyonlar, makineler, rotalar ve hata tipleri",
    icon: Factory,
  },
  {
    key: "cikti",
    title: "Çıktılar",
    description: "Etiketler, irsaliye/çeki belge şablonları ve refakat kartı",
    icon: Printer,
  },
  {
    key: "system",
    title: "Sistem",
    description: "Genel ayarlar, sevk toleransı, termin ve cihazlar",
    icon: Settings,
  },
];
