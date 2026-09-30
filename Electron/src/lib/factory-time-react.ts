import { useSyncExternalStore } from "react";
import { getFactoryTimezone, onFactoryTimezoneChange } from "@/lib/factory-time";

/** Etkin fabrika saat dilimi; dilim değişince çağıran bileşen yeniden çizilir. */
export function useFactoryTimezone(): string {
  return useSyncExternalStore(onFactoryTimezoneChange, getFactoryTimezone, getFactoryTimezone);
}
