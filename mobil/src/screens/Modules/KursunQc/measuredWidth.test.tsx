// D4-E2b bekçisi — tablet "Ölçülen en (cm)" alanı (isteğe bağlı; boşsa gövdede anahtar YOK).
// Negatif sonda: parseMeasuredWidth boş metne 0 döndürünce "boş → anahtar yok" testi kırmızı.
import React from 'react';
import { Button } from 'react-native-paper';
import { fireEvent } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../test/render';
import MeasuredWidthField from './MeasuredWidthField';
import { measuredWidthErrorText, parseMeasuredWidth, widthCaptureEnabled, withMeasuredWidth } from './measuredWidth';
import { useMeasuredWidth } from './useMeasuredWidth';

// jest.mock çağrıları babel-jest ile içe aktarımların üstüne taşınır.
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

type Body = { rollId: string; stepId: string; measuredWidthCm?: number };

/** Ekranın kurduğu düzenin aynası: alan + "Tamamla" → attach → complete. */
function Harness({ summary, complete }: { summary: { capturesWidth?: boolean } | null; complete: (b: Body) => void }) {
  const w = useMeasuredWidth(widthCaptureEnabled(summary), 'r1');
  return (
    <>
      <MeasuredWidthField state={w} />
      <Button testID="tamamla" onPress={() => { const v = w.attach({ rollId: 'r1', stepId: 's1' }); if (v) complete(v); }}>Tamamla</Button>
    </>
  );
}

describe('Ölçülen en alanı — görünürlük', () => {
  it.each([[null], [{}], [{ capturesWidth: false }]])('capturesWidth yok/false (%p) → alan YOK, gövde bayt-aynı', (summary) => {
    const complete = jest.fn();
    const r = renderWithPaper(<Harness summary={summary} complete={complete} />);
    expect(r.queryByTestId('olculen-en-alani')).toBeNull();
    fireEvent.press(r.getByTestId('tamamla'));
    expect(complete).toHaveBeenCalledWith({ rollId: 'r1', stepId: 's1' });
  });

  it('capturesWidth=true → alan var, "Ölçülen en (cm)" etiketiyle', () => {
    const r = renderWithPaper(<Harness summary={{ capturesWidth: true }} complete={jest.fn()} />);
    expect(r.getByTestId('olculen-en-alani')).toBeTruthy();
    expect(r.getAllByText('Ölçülen en (cm)').length).toBeGreaterThan(0);
  });
});

describe('Ölçülen en alanı — gövde', () => {
  it('⭐ boş gönderimde istek gövdesinde measuredWidthCm anahtarı YOK', () => {
    const complete = jest.fn();
    const r = renderWithPaper(<Harness summary={{ capturesWidth: true }} complete={complete} />);
    fireEvent.press(r.getByTestId('tamamla'));
    expect(complete).toHaveBeenCalledTimes(1);
    const body = complete.mock.calls[0][0] as Body;
    expect('measuredWidthCm' in body).toBe(false);
    expect(body).toEqual({ rollId: 'r1', stepId: 's1' });
  });

  it('⭐ 280 girilince gövdede measuredWidthCm=280', () => {
    const complete = jest.fn();
    const r = renderWithPaper(<Harness summary={{ capturesWidth: true }} complete={complete} />);
    fireEvent.changeText(r.getByTestId('olculen-en-giris'), '280');
    fireEvent.press(r.getByTestId('tamamla'));
    expect(complete).toHaveBeenCalledWith({ rollId: 'r1', stepId: 's1', measuredWidthCm: 280 });
  });

  it('0 / sayı olmayan → istek GİTMEZ, Türkçe uyarı', () => {
    const complete = jest.fn();
    const r = renderWithPaper(<Harness summary={{ capturesWidth: true }} complete={complete} />);
    fireEvent.changeText(r.getByTestId('olculen-en-giris'), '0');
    fireEvent.press(r.getByTestId('tamamla'));
    expect(complete).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Ölçülen en geçersiz' }));
  });

  it('saf: parse boş=null, virgül ondalık; withMeasuredWidth null → aynı nesne', () => {
    expect(parseMeasuredWidth('  ')).toEqual({ ok: true, value: null });
    expect(parseMeasuredWidth('279,5')).toEqual({ ok: true, value: 279.5 });
    expect(parseMeasuredWidth('abc').ok).toBe(false);
    const v = { rollId: 'r1' };
    expect(withMeasuredWidth(v, null)).toBe(v);
  });
});

describe('Ölçülen en — sunucu hataları Türkçe', () => {
  it('⭐ 400 WIDTH_CAPTURE_DISABLED → Türkçe mesaj', () => {
    const err = { status: 400, message: 'Bu istasyon en ölçmez', details: { code: 'WIDTH_CAPTURE_DISABLED' } };
    expect(measuredWidthErrorText(err)).toBe('Bu istasyon en ölçmüyor — ölçülen en gönderilemez. Alanı boş bırakıp yeniden deneyin.');
  });
  it('400 WIDTH_OUT_OF_RANGE → sunucunun sayılı Türkçe metni aynen', () => {
    const message = "Ölçülen en 0'dan büyük ve en fazla 310 cm olmalı (mevcut en 300 cm + eşik 10 cm)";
    expect(measuredWidthErrorText({ status: 400, message, details: { code: 'WIDTH_OUT_OF_RANGE' } })).toBe(message);
  });
  it('en dışı hata → null (genel metin)', () => {
    expect(measuredWidthErrorText({ status: 400, message: 'x', details: { code: 'OTHER' } })).toBeNull();
    expect(measuredWidthErrorText(new Error('ağ'))).toBeNull();
  });
});
