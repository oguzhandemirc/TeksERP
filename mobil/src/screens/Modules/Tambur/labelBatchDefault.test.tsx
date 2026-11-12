// Tambur parti no varsayılanı (Gülkesim 2026-11-10): müşteri ayarı açıkken "Parti no" alanı görünür,
// topun gelen belge partisiyle (label-settings `deliveryNoteBatchNo`) dolu gelir, operatör değiştirir/temizler;
// otomatik değer yeni topun partisine geçer, elle girilen değer ezilmez; ayar kapalıyken alan yok ve gövdeye gitmez.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { renderWithPaper } from '../../../test/render';
import TamburLabelInfoModal from './TamburLabelInfoModal';
import { useTamburFinalLabel } from './useTamburFinalLabel';
import { initialLabelBatch, withAutoSeed, withValue } from './labelBatch';
import { tamburService } from '../../../services/tambur.service';

jest.mock('../../../services/tambur.service', () => ({
  tamburService: { labelSuggestions: jest.fn(), labelSettings: jest.fn(), getLabelOverrides: jest.fn(), putLabelOverrides: jest.fn() },
}));
const tsvc = tamburService as unknown as { labelSuggestions: jest.Mock; labelSettings: jest.Mock };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const settings = (over: Record<string, unknown>) => ({
  customerId: 'c1', widthSource: null, weighRequired: false, splitLengthM: null, printTiming: 'EACH', ownerCustomer: null, ...over,
});

function Harness({ rollId, open = false }: { rollId: string; open?: boolean }) {
  const final = useTamburFinalLabel(rollId, null, 'wo-1');
  return (
    <>
      <Text testID="govde">{String(final.batch.body())}</Text>
      <TamburLabelInfoModal visible={open} workOrderId={null} final={final} onDismiss={() => undefined} />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  tsvc.labelSuggestions.mockResolvedValue({ workOrderId: 'wo-1', customerIds: [], itemNames: [], colorNames: [], batchNos: ['K30'], last: null });
});

describe('withAutoSeed (saf)', () => {
  it('boş değere tohum uygulanır, otomatik değer yeni tohumla değişir', () => {
    const a = withAutoSeed(initialLabelBatch('wo-1'), ' GB77 ');
    expect(a.value).toBe('GB77');
    expect(a.auto).toBe(true);
    expect(withAutoSeed(a, 'GB88').value).toBe('GB88');
  });
  it('elle girilen ya da temizlenen değer ezilmez; boş tohum durumu değiştirmez', () => {
    const typed = withValue(withAutoSeed(initialLabelBatch('wo-1'), 'GB77'), 'OP1');
    expect(withAutoSeed(typed, 'GB88').value).toBe('OP1');
    const cleared = withValue(withAutoSeed(initialLabelBatch('wo-1'), 'GB77'), '');
    expect(withAutoSeed(cleared, 'GB88').value).toBe('');
    const s = initialLabelBatch('wo-1');
    expect(withAutoSeed(s, null)).toBe(s);
  });
  it('aynı değerin yeniden onaylanması (Kaydet) otomatikliği bozmaz', () => {
    const a = withAutoSeed(initialLabelBatch('wo-1'), 'GB77');
    expect(withValue(a, 'GB77').auto).toBe(true);
  });
});

describe('Etiket bilgisi — parti no varsayılanı', () => {
  it('ayar açık: alan görünür, gelen belge partisiyle dolu, gövdeye gider; operatör değiştirir ve temizler', async () => {
    tsvc.labelSettings.mockResolvedValue(settings({ labelBatchEnabled: true, deliveryNoteBatchNo: 'GB77' }));
    const r = renderWithPaper(<Harness rollId="r1" />);
    await flush();
    await waitFor(() => expect(r.getByTestId('govde').props.children).toBe('GB77'));
    // Pencere açılınca alan görünür ve varsayılanı gösterir.
    r.rerender(<Harness rollId="r1" open />);
    await flush();
    expect(r.getByTestId('etiket-batch-deger').props.children).toBe('GB77');

    fireEvent.press(r.getByTestId('etiket-batch'));
    await flush();
    await waitFor(() => expect(r.getByText('K30')).toBeTruthy());
    fireEvent.press(r.getByText('K30'));
    await flush();
    expect(r.getByTestId('etiket-batch-deger').props.children).toBe('K30');
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await flush();
    expect(r.getByTestId('govde').props.children).toBe('K30');

    fireEvent.press(r.getByTestId('etiket-batch-temizle'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await flush();
    expect(r.getByTestId('govde').props.children).toBe('null');
  });

  it('otomatik varsayılan yeni topun gelen belge partisine geçer (elle giriş saf testte)', async () => {
    tsvc.labelSettings.mockImplementation(({ rollId }: { rollId: string }) =>
      Promise.resolve(settings({ labelBatchEnabled: true, deliveryNoteBatchNo: rollId === 'r1' ? 'GB77' : 'GB88' })));
    const r = renderWithPaper(<Harness rollId="r1" />);
    await flush();
    await waitFor(() => expect(r.getByTestId('govde').props.children).toBe('GB77'));
    r.rerender(<Harness rollId="r2" />);
    await flush();
    await waitFor(() => expect(r.getByTestId('govde').props.children).toBe('GB88'));
  });

  it('ayar kapalı (bugünkü davranış): alan yok, gövdeye gitmez', async () => {
    tsvc.labelSettings.mockResolvedValue(settings({ labelBatchEnabled: false, deliveryNoteBatchNo: 'GB77' }));
    const r = renderWithPaper(<Harness rollId="r1" />);
    await flush();
    await waitFor(() => expect(tsvc.labelSettings).toHaveBeenCalled());
    await flush();
    r.rerender(<Harness rollId="r1" open />);
    await flush();
    expect(r.getByTestId('etiket-item')).toBeTruthy();
    expect(r.queryByTestId('etiket-batch')).toBeNull();
    expect(r.getByTestId('govde').props.children).toBe('undefined');
  });
});
