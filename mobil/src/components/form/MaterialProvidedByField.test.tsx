// F7b "Ana hammaddeyi kim verdi?" — tek yardımcı (seçenek + gövde parçası) ve iki formun ortak bileşeni.
// Negatif sonda: `materialProvidedByBody` null'da da anahtar koyunca "Bilinmiyor anahtarsız" vakası kırmızı.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { MaterialProvidedByField } from './MaterialProvidedByField';
import { MATERIAL_PROVIDER_OPTIONS, materialProvidedByBody, parseMaterialProvider } from '../../lib/materialProvider';
import { WO_FIELDS, fieldApplicable, valuedFields } from '../../screens/Modules/GelenBelge/woCreate/woFieldCatalog';
import { initialFormState } from '../../screens/Modules/GelenBelge/woCreate/woForm';

describe('materialProvider (tek kaynak)', () => {
  it('panel ile aynı dört seçenek; Bilinmiyor = null', () => {
    expect(MATERIAL_PROVIDER_OPTIONS.map((o) => o.label)).toEqual(['Bilinmiyor', 'Müşteri', 'Bu fabrika', 'Karışık']);
    expect(MATERIAL_PROVIDER_OPTIONS.map((o) => o.value)).toEqual([null, 'CUSTOMER', 'US', 'MIXED']);
  });
  it('gövde: seçiliyse anahtar, Bilinmiyor/yok anahtarsız', () => {
    expect(materialProvidedByBody('MIXED')).toEqual({ materialProvidedBy: 'MIXED' });
    // toStrictEqual: undefined değerli anahtar da sayılır (toEqual onu yutar).
    expect(materialProvidedByBody(null)).toStrictEqual({});
    expect(materialProvidedByBody(undefined)).toStrictEqual({});
  });
  it('ham değer: tanınmayan → null', () => {
    expect(parseMaterialProvider('US')).toBe('US');
    expect(parseMaterialProvider('BIZ')).toBeNull();
    expect(parseMaterialProvider(null)).toBeNull();
  });
});

describe('alan kataloğu', () => {
  const ctx = { showQuantity: false, showWidth: false, hasTambur: false, hasKursun: false, hasRouteSteps: false };
  it('alan katalogda, kapatılabilir ve koşulsuz (her türde sorulur — panel emsali)', () => {
    const def = WO_FIELDS.find((f) => f.key === 'malzemeVeren');
    expect(def?.required).toBe(false);
    expect(def?.when).toBeUndefined();
    expect(fieldApplicable('malzemeVeren', ctx)).toBe(true);
  });
  it('seçilmişse "değerli" sayılır (gizliyken sessiz gönderim yok)', () => {
    const e = initialFormState().extras;
    expect(valuedFields(e, { stepsEdited: false })).not.toContain('malzemeVeren');
    expect(valuedFields({ ...e, materialProvidedBy: 'US' }, { stepsEdited: false })).toContain('malzemeVeren');
  });
});

describe('MaterialProvidedByField', () => {
  it('dokunma değeri verir; Bilinmiyor null döner', () => {
    const onChange = jest.fn();
    render(<PaperProvider><MaterialProvidedByField value="CUSTOMER" onChange={onChange} /></PaperProvider>);
    fireEvent.press(screen.getByTestId('ie-form-malzeme-US'));
    expect(onChange).toHaveBeenLastCalledWith('US');
    fireEvent.press(screen.getByTestId('ie-form-malzeme-yok'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Ana hammaddeyi kim verdi?')).toBeTruthy();
  });
});
