import type { CrudService } from "@/services/crudService";
import { fabricTypeService, fiberTypeService } from "./service";
import type { ClassTypeRow } from "./types";

export type ClassTypeKind = "fabric" | "fiber";

interface KindConfig {
  title: string;
  description: string;
  entity: string;
  entityLower: string;
  /** "N … kullanılıyor" ismi: kumaş türü kartlarda, lif türü iplik satırlarında. */
  usageNoun: string;
  usageHeader: string;
  queryKey: string;
  nameMax: number;
  namePlaceholder: string;
  hasAbbreviation: boolean;
  service: CrudService<ClassTypeRow>;
}

export const CLASS_TYPE_KINDS: Record<ClassTypeKind, KindConfig> = {
  fabric: {
    title: "Kumaş Türleri",
    description: "Kumaş kartında seçilen tür: Tül, Fon, Blackout, Döşemelik…",
    entity: "Kumaş türü",
    entityLower: "kumaş türü",
    usageNoun: "kumaş kartında",
    usageHeader: "Kumaş kartı",
    queryKey: "fabric-types",
    nameMax: 60,
    namePlaceholder: "ör. Tül",
    hasAbbreviation: false,
    service: fabricTypeService as unknown as CrudService<ClassTypeRow>,
  },
  fiber: {
    title: "Lif Türleri",
    description: "İplik kartının lif bileşiminde seçilen lifler; kumaş kompozisyonu bunlardan hesaplanır.",
    entity: "Lif türü",
    entityLower: "lif türü",
    usageNoun: "iplik kartında",
    usageHeader: "İplik kartı",
    queryKey: "fiber-types",
    nameMax: 40,
    namePlaceholder: "ör. Polyester",
    hasAbbreviation: true,
    service: fiberTypeService as unknown as CrudService<ClassTypeRow>,
  },
};
