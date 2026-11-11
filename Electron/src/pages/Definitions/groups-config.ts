import {
  Layers,
  Handshake,
  Factory,
  ScanText,
  type LucideIcon,
} from "lucide-react";
import { TERIM } from "@/lib/terim";

export type DefinitionGroupKey =
  | "catalog"
  | "partners"
  | "production"
  | "incoming";

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
    get description() { return `İstasyonlar, donanım, rotalar, ${TERIM.terbiyeIsEmri.tekilKucuk} şablonları, hata tipleri ve iade nedenleri`; },
    icon: Factory,
  },
  {
    key: "incoming",
    title: "Gelen Belge Kurulumu",
    description: "Müşteri irsaliyesi okuma: belge tipleri, yeni tip tanıtma ve müşteriye göre varsayılan ürün",
    icon: ScanText,
  },
];
