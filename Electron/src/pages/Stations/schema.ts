import { z } from "zod";
import { StationKind, StationType } from "@/types/enums";

export const stationFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(120),
  type: z.enum([StationType.INTERNAL, StationType.EXTERNAL]),
  kind: z.enum([
    StationKind.RAW_QC,
    StationKind.PROCESS_QC,
    StationKind.TAMBUR,
    StationKind.SUBCONTRACTOR,
    StationKind.PACKAGING,
    StationKind.SHIPPING,
    StationKind.OTHER,
  ]),
  department: z.string().max(60).optional().or(z.literal("")),
  isActive: z.boolean(),
  defaultCategoryId: z.string().nullable().optional(),
});

export type StationFormValues = z.infer<typeof stationFormSchema>;

export const stationFormDefaults: StationFormValues = {
  name: "",
  type: StationType.INTERNAL,
  kind: StationKind.OTHER,
  department: "",
  isActive: true,
  defaultCategoryId: null,
};
