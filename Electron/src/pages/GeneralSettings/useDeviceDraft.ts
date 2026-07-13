import { useRef, useState } from "react";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import type { MachineConfig } from "@/lib/machine-config";

type DeviceKey = "scaleDevice" | "labelPrinter" | "scanner";

/**
 * "Bu Bilgisayar" cihaz alt-sekmeleri için TASLAK sarmalayıcı. useMachineConfig
 * her değişikliği anında yerel depoya yazar; bu hook değişiklikleri yerel taslakta
 * biriktirir ve yalnız `save()`'te commit eder (setConfig). Tara/Test aksiyonları
 * taslak değerini okur → önce dene, sonra kaydet (yarım/yanlış değer yazılmaz).
 * dirty JSON karşılaştırmasıyla (küçük düz config nesneleri).
 */
export function useDeviceDraft<K extends DeviceKey>(key: K) {
  const { config, setConfig, ready } = useMachineConfig();
  const savedStr = JSON.stringify(config[key] ?? {});
  const [draft, setDraft] = useState<NonNullable<MachineConfig[K]>>(
    () => JSON.parse(savedStr) as NonNullable<MachineConfig[K]>,
  );
  // Kayıtlı değer değişince (kaydetme sonrası ya da dış değişim / geç yükleme) taslağı
  // AYNI render'da eşitle — effect gecikmesindeki "bir kare kirli" titremesini önler.
  const prevSaved = useRef(savedStr);
  if (prevSaved.current !== savedStr) {
    prevSaved.current = savedStr;
    setDraft(JSON.parse(savedStr) as NonNullable<MachineConfig[K]>);
  }

  const dirty = JSON.stringify(draft) !== savedStr;
  const patch = (p: Partial<NonNullable<MachineConfig[K]>>) =>
    setDraft((d) => ({ ...d, ...p }));
  const save = () => setConfig({ [key]: draft } as Partial<MachineConfig>);
  const reset = () => setDraft(JSON.parse(savedStr) as NonNullable<MachineConfig[K]>);

  return { draft, setDraft, patch, dirty, save, reset, ready };
}
