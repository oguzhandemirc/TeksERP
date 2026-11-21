// =============================================================================
// Devere Dönüş Kabulü — levent satırı sayfası: tartı kipi alanları, zorunlu brüt, yeni gövde sahibi
// =============================================================================
// Test tuzağı: SimplePortal bildirimi mikrotaskta — her basıştan sonra `await act(async () => {})`; `it` başına TEK render.
import { act, fireEvent } from '@testing-library/react-native';
import BeamLineSheet from './BeamLineSheet';
import type { BeamDraft } from './receiveDocPayload';
import type { LineSheet } from './useDevereKabul';
import { renderWithPaper } from '../../../test/render';

const draft = (p: Partial<BeamDraft> = {}): BeamDraft => ({ key: 'k1', body: null, physicalBeamNo: '', lengthM: '1200', grossKg: '', tareKg: '', ...p });
const sheetOf = (d: BeamDraft, editing = false): LineSheet => ({ orderId: 'o1', draft: d, editing });

async function setup(value: LineSheet, weighing: 'OFF' | 'OPTIONAL' | 'REQUIRED') {
  const onSave = jest.fn();
  const onRemove = jest.fn();
  const r = renderWithPaper(<BeamLineSheet value={value} weighing={weighing} subcontractorName="Yılmaz Devere" onSave={onSave} onRemove={onRemove} onDismiss={jest.fn()} />);
  await act(async () => {});
  return { ...r, onSave, onRemove };
}

describe('BeamLineSheet', () => {
  it('OFF: tartı alanları yok, gövde no metni var; Ekle kaydeder', async () => {
    const r = await setup(sheetOf(draft()), 'OFF');
    expect(r.queryByText(/Brüt kg/)).toBeNull();
    expect(r.getByText('Gövde no (isteğe bağlı)')).toBeTruthy();
    fireEvent.press(r.getByTestId('devere-kabul-satir-kaydet'));
    await act(async () => {});
    expect(r.onSave).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', draft: expect.objectContaining({ lengthM: '1200' }) }));
  });

  it('REQUIRED: brütsüz kayıt reddedilir, hata sayfada', async () => {
    const r = await setup(sheetOf(draft({ body: { kind: 'existing', id: 'b1', bodyNo: 'LG-00012', hint: 'Bizim' } })), 'REQUIRED');
    expect(r.getByText('Brüt kg (zorunlu)')).toBeTruthy();
    expect(r.queryByText('Gövde no (isteğe bağlı)')).toBeNull();
    fireEvent.press(r.getByTestId('devere-kabul-satir-kaydet'));
    await act(async () => {});
    expect(r.onSave).not.toHaveBeenCalled();
    expect(r.getByText(/dönüş tartısı zorunlu/)).toBeTruthy();
  });

  it('yeni gövde: sahip seçimi; Deverecinin → devereci adı görünür', async () => {
    const r = await setup(sheetOf(draft({ body: { kind: 'new', bodyNo: 'YD-22', ownerKind: 'OURS' } })), 'OPTIONAL');
    expect(r.getByText('Gövde YD-22 (yeni)')).toBeTruthy();
    fireEvent.press(r.getByText('Deverecinin'));
    await act(async () => {});
    expect(r.getByText('Sahip: Yılmaz Devere')).toBeTruthy();
    fireEvent.press(r.getByTestId('devere-kabul-satir-kaydet'));
    await act(async () => {});
    expect(r.onSave.mock.calls[0][0].draft.body).toEqual({ kind: 'new', bodyNo: 'YD-22', ownerKind: 'WARPER' });
  });

  it('yeniden sarım adayı: seçim yalnız aday varken; seçince metre aday boyuyla dolar', async () => {
    const onSave = jest.fn();
    const r = renderWithPaper(<BeamLineSheet value={sheetOf(draft())} weighing="OFF" subcontractorName="X" reworkCandidates={[{ beamId: 'wb1', beamNo: 'LV-7', lengthM: '950.000', bodyNo: 'LG-3', rejectionDocNo: 'DR-2611-0001' }]} onSave={onSave} onRemove={jest.fn()} onDismiss={jest.fn()} />);
    await act(async () => {});
    fireEvent.press(r.getByTestId('devere-kabul-rework-LV-7'));
    await act(async () => {});
    fireEvent.press(r.getByTestId('devere-kabul-satir-kaydet'));
    await act(async () => {});
    expect(onSave.mock.calls[0][0].draft).toMatchObject({ reworkOfBeamId: 'wb1', lengthM: '950' });
  });

  it('aday yoksa yeniden sarım seçimi çizilmez', async () => {
    const r = await setup(sheetOf(draft()), 'OFF');
    expect(r.queryByText('Yeniden sarım mı?')).toBeNull();
  });

  it('düzeltmede satır silinebilir', async () => {
    const r = await setup(sheetOf(draft(), true), 'OPTIONAL');
    fireEvent.press(r.getByText('Satırı sil'));
    await act(async () => {});
    expect(r.onRemove).toHaveBeenCalledWith('o1', 'k1');
  });
});
