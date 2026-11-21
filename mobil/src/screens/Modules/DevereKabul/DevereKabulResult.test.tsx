// =============================================================================
// Devere Dönüş Kabulü — sonuç kartı (Geri gönder satır eylemi, #830) + kamera "Numara yaz" şeridi
// =============================================================================
import { act, fireEvent } from '@testing-library/react-native';
import { ManualCodeFooter, ResultCard } from './DevereKabulResult';
import type { ReceiveDocResult } from '../../../services/devereKabul.service';
import { renderWithPaper } from '../../../test/render';

const result = {
  docNo: 'DK-2611-0001',
  totals: { beamCount: 1, lengthM: '1480' },
  orders: [{ warpingOrderId: 'o1', orderNo: 'FDV-1', receipt: { beams: [{ id: 'wb1', beamNo: 'LV-7', physicalBeamNo: 'TEST-G1', lengthM: '1480' }] } }],
} as unknown as ReceiveDocResult;

describe('ResultCard', () => {
  it('yetkide Geri gönder satır eylemi leventi ve siparişi verir', async () => {
    const onReject = jest.fn();
    const r = renderWithPaper(<ResultCard result={result} onClose={jest.fn()} onReject={onReject} />);
    await act(async () => {});
    expect(r.getByText('Kabul kaydedildi — DK-2611-0001')).toBeTruthy();
    fireEvent.press(r.getByTestId('devere-ret-satir-LV-7'));
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 'wb1', beamNo: 'LV-7' }), { id: 'o1', orderNo: 'FDV-1' });
  });

  it('yetki yoksa satır düğmesi çizilmez; Tamam kartı kapatır', async () => {
    const onClose = jest.fn();
    const r = renderWithPaper(<ResultCard result={result} onClose={onClose} />);
    await act(async () => {});
    expect(r.queryByTestId('devere-ret-satir-LV-7')).toBeNull();
    fireEvent.press(r.getByTestId('devere-kabul-sonuc-kapat'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ManualCodeFooter', () => {
  it('yazılan numara kırpılıp gönderilir; boşken gönderilmez', async () => {
    const onSubmit = jest.fn();
    const r = renderWithPaper(<ManualCodeFooter placeholder="Gövde no" onSubmit={onSubmit} testID="num" />);
    await act(async () => {});
    fireEvent.press(r.getByTestId('num-bul'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.changeText(r.getByTestId('num'), '  LG-00012 ');
    await act(async () => {});
    fireEvent.press(r.getByTestId('num-bul'));
    expect(onSubmit).toHaveBeenCalledWith('LG-00012');
  });
});
