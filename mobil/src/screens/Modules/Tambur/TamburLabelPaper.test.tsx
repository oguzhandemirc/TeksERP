// Etiket kâğıdı (2026-11-11): sistemin kesimde atadığı alan (barkod metni) kırmızı "boş" değil, gri "kesimde atanır"
// ve dokunulamaz; gerçekten değersiz veri alanı (Kg) kırmızı "— boş" kalır ve düzenlenir.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburLabelPaper from './TamburLabelPaper';
import type { TamburLabelPreview } from '../../../services/tambur.service';

const base = { type: 'text', y: 10, hMm: 3, bold: false, align: 'left', rot: 0, wr: 1, text: '' } as const;
const preview = {
  kind: 'FINISHED',
  templateId: 't1',
  templateName: 'Standart',
  widthMm: 100,
  heightMm: 58,
  sourceWidthCm: null,
  rows: null,
  elements: [
    { ...base, x: 4, bind: 'barcode', auto: true },
    // Eski backend: auto yok, sistem alanı empty işaretli gelir → tablet yine gri çizer.
    { ...base, x: 4, y: 20, bind: 'printedAt', empty: true },
    { ...base, x: 60, bind: 'weightKg', empty: true },
  ],
} as unknown as TamburLabelPreview;

function paper() {
  const onEdit = jest.fn();
  // isEditable her şeye true dese de sistem alanı dokunulamaz kalmalı.
  const r = renderWithPaper(<TamburLabelPaper preview={preview} fallbackRows={[]} isEditable={() => true} onEdit={onEdit} stale={false} />);
  fireEvent(r.getByTestId('tambur-etiket-onizleme'), 'layout', { nativeEvent: { layout: { width: 500, height: 290 } } });
  return { r, onEdit };
}

describe('TamburLabelPaper — sistem alanı ↔ veri alanı', () => {
  it('sistem alanı gri "kesimde atanır", kırmızı boş değil, dokunulamaz', () => {
    const { r } = paper();
    expect(r.getByTestId('onizleme-oto-barcode')).toHaveTextContent('kesimde atanır');
    expect(r.getByTestId('onizleme-oto-printedAt')).toHaveTextContent('kesimde atanır');
    expect(r.queryByTestId('onizleme-bos-barcode')).toBeNull();
    expect(r.queryByTestId('onizleme-alan-barcode')).toBeNull();
    expect(r.queryByTestId('onizleme-alan-printedAt')).toBeNull();
    expect(r.queryByText(/Alan — boş/)).toBeNull();
  });

  it('veri alanı kırmızı "— boş" kalır ve düzenlenir', () => {
    const { r, onEdit } = paper();
    expect(r.getByTestId('onizleme-bos-weightKg')).toHaveTextContent('Kg — boş');
    fireEvent.press(r.getByTestId('onizleme-alan-weightKg'));
    expect(onEdit).toHaveBeenCalledWith('weightKg', expect.anything());
  });
});
