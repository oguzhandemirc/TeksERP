import type { UseFormReturn } from "react-hook-form";
import type { StationFormValues } from "./schema";

/** İstasyon duruş kapısı: kapalıyken tablet "Duruş" çizmez, sunucu yeni açılışı reddeder. */
export function StationMachineStopField({ form }: { form: UseFormReturn<StationFormValues> }) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="station-machine-stop" {...form.register("machineStopEnabled")} /> Duruş bildirimi
      </label>
      <p className="-mt-1 pl-6 text-xs text-muted-foreground">
        Kapalıysa bu istasyonun tabletinde &quot;Duruş&quot; düğmesi çıkmaz ve yeni duruş açılamaz; açık kalmış duruş yine kapatılabilir.
      </p>
    </>
  );
}
