// =============================================================================
// DURUŞ KODU EŞLEME — saf katman (görünürlük · form şeması · gövde · sebep seçenekleri)
// =============================================================================
// Anahtar = kart tipi + ham kod (+ isteğe bağlı tezgah üst-yazımı); doğuştan sonra DEĞİŞMEZ — düzenlemede
// yalnız sebep gider (backend `.strict()`). Sebep yalnız aktif, kayıp sınıflı `MACHINE_STOP` (sebep-katalogu).
// =============================================================================
import { z } from "zod";
import type { AlarmVisibilityContext } from "@/pages/Operations/LoomAlarms/alarm-regime";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import { COLLECTOR_TYPE_MESSAGE, COLLECTOR_TYPE_RE } from "@/pages/MachineCollectors/collector-model";
import type { MachineStopCodeMap } from "./types";

/** Karo / palet girişi. Gövde `return ctx.<alan>` kalır: karo↔manifesto bekçisi metinden okur. */
export function isMachineStopCodeMapsVisible(ctx: AlarmVisibilityContext): boolean {
  return ctx.tezgahEnabled;
}

/** Kapsam seçicisinde "kart tipi geneli" — gövdede `machineId: null`. */
export const SCOPE_ALL = "ALL";

export const codeMapFormSchema = z.object({
  collectorType: z.string().trim().regex(COLLECTOR_TYPE_RE, COLLECTOR_TYPE_MESSAGE),
  rawStopCode: z.string().trim().min(1, "Ham duruş kodu zorunlu.").max(32, "Ham duruş kodu en çok 32 karakter olabilir."),
  scope: z.string().min(1),
  stopReasonId: z.string().min(1, "Duruş sebebi seçin."),
});
export type CodeMapFormValues = z.infer<typeof codeMapFormSchema>;

export function formDefaults(initial: MachineStopCodeMap | null): CodeMapFormValues {
  return initial
    ? { collectorType: initial.collectorType, rawStopCode: initial.rawStopCode, scope: initial.machineId ?? SCOPE_ALL, stopReasonId: initial.stopReasonId }
    : { collectorType: "", rawStopCode: "", scope: SCOPE_ALL, stopReasonId: "" };
}

/** Oluşturmada tam anahtar; düzenlemede YALNIZ sebep (anahtar alanı gönderilirse sunucu 400 der). */
export function buildCodeMapPayload(v: CodeMapFormValues, initial: MachineStopCodeMap | null): Record<string, unknown> {
  if (initial) return { stopReasonId: v.stopReasonId };
  return {
    collectorType: v.collectorType.trim(),
    rawStopCode: v.rawStopCode.trim(),
    machineId: v.scope === SCOPE_ALL ? null : v.scope,
    stopReasonId: v.stopReasonId,
  };
}

/** Seçilebilir sebepler: aktif + kayıp sınıflı (sunucu aksini `STOP_REASON_INVALID`/`STOP_LOSS_CLASS_MISSING` ile reddeder). */
export function selectableReasons(presets: readonly ReasonPreset[]): ReasonPreset[] {
  return presets.filter((p) => p.kind === "MACHINE_STOP" && p.isActive && !!p.stopLossClass);
}
