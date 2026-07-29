import {
  Layers,
  Handshake,
  Factory,
  Printer,
  type LucideIcon,
} from "lucide-react";

export type DefinitionGroupKey =
  | "catalog"
  | "partners"
  | "production"
  | "cikti";

export interface DefinitionGroup {
  key: DefinitionGroupKey;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const definitionGroups: DefinitionGroup[] = [
  {
    key: "catalog",
    title: "Kumaş Kataloğu",
    description: "Kumaşlar, özellikler, renkler ve kalite sınıfları",
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
    description: "İstasyonlar, donanım, rotalar, iş emri şablonları, hata tipleri ve iade nedenleri",
    icon: Factory,
  },
  {
    key: "cikti",
    title: "Çıktılar",
    description: "Etiketler, irsaliye/çeki belge şablonları ve refakat kartı",
    icon: Printer,
  },
];
