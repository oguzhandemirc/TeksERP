// =============================================================================
// MAKİNE KARTLARI — saf katman (görünürlük · K4 uyarısı · form şeması)
// =============================================================================
// K4 (PLAN-makine-durus §5): eşleşmeyen kart duruşu sebepsiz alarm yoluna düşer; "Sebepsiz duruşta alarm"
// kapalıysa (ya da alarm motoru kapalıysa) alarm DOĞMAZ. Varsayılan değişmez — kart ekranı uyarır.
// =============================================================================
import { z } from "zod";
import type { AlarmVisibilityContext } from "@/pages/Operations/LoomAlarms/alarm-regime";

/** Karo / palet girişi. Gövde `return ctx.<alan>` kalır: karo↔manifesto bekçisi metinden okur. */
export function isMachineCollectorsVisible(ctx: AlarmVisibilityContext): boolean {
  return ctx.tezgahEnabled;
}

export interface K4Flags {
  tezgahAlarmEnabled?: boolean;
  tezgahAlarmUnclassifiedEnabled?: boolean;
}

/** Ayarlar okunamadıysa (undefined) uyarı ÇİZİLMEZ — bilinmeyeni "kapalı" diye ilan etmeyiz. */
export function k4Warning(flags: K4Flags | null | undefined): string | null {
  if (!flags || flags.tezgahAlarmEnabled === undefined || flags.tezgahAlarmUnclassifiedEnabled === undefined) return null;
  if (!flags.tezgahAlarmEnabled) {
    return "Tezgah alarmı kapalı: kartın bildirdiği duruşlar için alarm doğmaz. Ayar: Genel Ayarlar › Tezgah izleme › Tezgah alarmı.";
  }
  if (!flags.tezgahAlarmUnclassifiedEnabled) {
    return "\"Sebepsiz duruşta alarm\" kapalı: kod eşlemesi bulunmayan kart duruşları sebepsiz kalır ve alarm doğmaz. Ayar: Genel Ayarlar › Tezgah izleme.";
  }
  return null;
}

/** Backend `COLLECTOR_TYPE_RE` aynası (machine-stop-code-map.service). */
export const COLLECTOR_TYPE_RE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
export const COLLECTOR_TYPE_MESSAGE = "Kart tipi büyük harf, rakam ve . _ - ile en çok 32 karakter olmalı (örn. TEKS-ESP32-V1).";

export const collectorFormSchema = z.object({
  name: z.string().trim().min(1, "Kart adı zorunlu.").max(100, "Kart adı en çok 100 karakter olabilir."),
  collectorType: z.string().trim().regex(COLLECTOR_TYPE_RE, COLLECTOR_TYPE_MESSAGE),
  machineIds: z.array(z.string()).min(1, "Karta en az bir tezgah bağlanmalı.").max(64, "Bir karta en çok 64 tezgah bağlanır."),
});
export type CollectorFormValues = z.infer<typeof collectorFormSchema>;

export function machineList(c: { machines: { machine: { code: string } }[] }): string {
  return c.machines.length ? c.machines.map((m) => m.machine.code).join(", ") : "—";
}
