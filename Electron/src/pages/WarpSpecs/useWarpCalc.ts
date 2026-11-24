import { useFormContext, useWatch } from "react-hook-form";
import { useWarpPlan } from "@/pages/Operations/WarpPlan/service";
import { buildPreviewBody, type BeamInput } from "./preview";
import type { WarpSpecFormValues } from "./schema";

/** Formdaki satırlarla sunucu çözgü hesabı; aynı gövde aynı sorgu anahtarı → satır editörü ve panel tek istek paylaşır. */
export function useWarpCalc(beam?: BeamInput | null) {
  const { control } = useFormContext<WarpSpecFormValues>();
  const yarns = useWatch({ control, name: "yarns" }) ?? [];
  const wastePct = useWatch({ control, name: "wastePct" });
  const body = buildPreviewBody(yarns, wastePct);
  const per1000 = useWarpPlan(body);
  const beamBody = beam ? buildPreviewBody(yarns, wastePct, beam) : null;
  const beamQ = useWarpPlan(beamBody);
  return {
    yarns,
    hasBody: body !== null,
    per1000: body ? (per1000.data?.data ?? null) : null,
    per1000Error: per1000.isError,
    /** Formdaki çözgü kartı firesi (%) — iplik firesi geçtiğinde "uygulanmaz" notu için (B6). */
    specWastePct: body?.specWastePct ?? null,
    beamResult: beamBody ? (beamQ.data?.data ?? null) : null,
  };
}
