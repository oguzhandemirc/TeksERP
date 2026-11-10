// Gelen (beyan) alanı bu cihazda açık mı — tek okuyucu: tek İE formu, belge masası ve parti kartları aynı yerden okur.
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import type { DocIncomingField } from '../../../../store/docIncomingFields';

export function useIncomingShown(): (k: DocIncomingField) => boolean {
  const hidden = useDeviceSettingsStore((s) => s.docHiddenIncoming);
  return (k) => !hidden.includes(k);
}
