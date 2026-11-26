// Fason F7b — "Ana hammaddeyi kim verdi?" seçenek satırı (tek form + Hızlı İE sihirbazı aynı bileşen). Büyük eşit
// düğmeler (ChoiceRow); "Bilinmiyor" = null = bugünkü davranış. Değer bilgi + satış tevkifatı önerisine girdi.
import React from 'react';
import { ChoiceRow } from './ChoiceRow';
import { MATERIAL_PROVIDER_OPTIONS, parseMaterialProvider, type MaterialProvider } from '../../lib/materialProvider';

interface Props {
  value: MaterialProvider | null;
  onChange: (next: MaterialProvider | null) => void;
  disabled?: boolean;
}

export function MaterialProvidedByField({ value, onChange, disabled }: Props) {
  return (
    <ChoiceRow
      label="Ana hammaddeyi kim verdi?"
      aside="bilgi amaçlı"
      rowTestID="ie-form-malzeme-satir"
      options={MATERIAL_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label, testID: `ie-form-malzeme-${o.value ?? 'yok'}` }))}
      value={value}
      onChange={(v) => onChange(parseMaterialProvider(v))}
      disabled={disabled}
      testID="ie-form-malzeme"
    />
  );
}
