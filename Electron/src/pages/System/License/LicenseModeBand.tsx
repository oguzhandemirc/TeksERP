import { cn } from "@/lib/utils";
import type { LicenseDetail } from "@/types/license";
import { TIER_LABEL } from "./labels";

/** Merdivenin üç basamağı; NORMAL ve DURDURULMUS basamak değildir (normal = hiçbiri vurgulu değil). */
const STEPS = ["UYARI", "EK_SURE", "KISITLI"] as const;

/**
 * Kip + kademe bandı: zorlamada vurgulanan basamak UYGULANAN kademedir; gözlemde fabrikaya uygulanan hep NORMAL
 * olduğundan hesaplanan basamak soluk gösterilir ("zorlamada burada olurdu").
 */
export function LicenseModeBand({ d }: { d: LicenseDetail }) {
  const s = d.durum;
  const enforce = s.kip === "zorla";
  const tier = enforce ? s.uygulananKademe : s.hesaplananKademe;
  return (
    <div data-testid="lisans-kip-bandi" className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
      <span
        data-testid="lisans-kip"
        className={cn("rounded px-2 py-0.5 font-medium", enforce ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
      >
        {enforce ? "Zorlama" : "Gözlem"}
      </span>
      {STEPS.map((step) => {
        const on = tier === step;
        return (
          <span
            key={step}
            data-testid={`lisans-basamak-${step}`}
            data-etkin={on ? "1" : "0"}
            className={cn(
              "rounded px-2 py-0.5",
              !on && "text-muted-foreground",
              on && enforce && (step === "KISITLI" ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"),
              on && !enforce && "border border-dashed",
            )}
          >
            {TIER_LABEL[step]}
          </span>
        );
      })}
      {s.ekSureKalanGun !== null && <span className="text-muted-foreground">· ek süre {s.ekSureKalanGun} gün</span>}
      {!enforce && tier !== "NORMAL" && <span className="text-muted-foreground">· gözlemde uygulanmaz</span>}
    </div>
  );
}
