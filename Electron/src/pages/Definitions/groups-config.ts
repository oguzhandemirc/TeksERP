import {
  Layers,
  Handshake,
  Factory,
  type LucideIcon,
} from "lucide-react";

export type DefinitionGroupKey =
  | "catalog"
  | "partners"
  | "production";

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
    description: "Ürünler (kumaş · iplik · sarf), özellikler, renkler ve kalite sınıfları",
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
    description: "İstasyonlar, donanım, rotalar, terbiye iş emri şablonları, hata tipleri ve iade nedenleri",
    icon: Factory,
  },
];
