// Etiket bilgisi penceresi (2026-11-10): tek geniş pencere — "Diğer etiket alanları" katlanmaz, açılır açılmaz görünür;
// üstte topun "Parti no"su varken İE-geneli `batchNumber` satırı düşer (iki "Parti no" yok); Vazgeç solda, Kaydet sağda.
import React from 'react';
import { act, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburLabelInfoModal from './TamburLabelInfoModal';
import { useTamburFinalLabel } from './useTamburFinalLabel';
import { visibleOverrideKeys } from './labelTexts';
import { tamburService } from '../../../services/tambur.service';

jest.mock('../../../services/tambur.service', () => ({
  tamburService: { labelSuggestions: jest.fn(), labelSettings: jest.fn(), getLabelOverrides: jest.fn(), putLabelOverrides: jest.fn() },
}));
const tsvc = tamburService as unknown as { labelSuggestions: jest.Mock; labelSettings: jest.Mock; getLabelOverrides: jest.Mock };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const KEYS = [
  { key: 'itemName', label: 'Ürün adı', type: 'text' as const },
  { key: 'widthCm', label: 'En (cm)', type: 'number' as const },
  { key: 'deliveryNoteRollNo', label: 'Müşteri top no', type: 'text' as const },
  { key: 'orderNumber', label: 'Sipariş no', type: 'text' as const },
  { key: 'batchNumber', label: 'Parti no', type: 'text' as const },
];

function Harness({ open = false }: { open?: boolean }) {
  const final = useTamburFinalLabel('r1', null, 'wo-1');
  return <TamburLabelInfoModal visible={open} workOrderId="wo-1" final={final} onDismiss={() => undefined} />;
}

const settings = (labelBatchEnabled: boolean) => ({
  customerId: 'c1', widthSource: null, weighRequired: false, splitLengthM: null, printTiming: 'EACH', ownerCustomer: null, labelBatchEnabled,
});

async function openWith(batch: boolean) {
  tsvc.labelSettings.mockResolvedValue(settings(batch));
  const r = renderWithPaper(<Harness />);
  await flush();
  await waitFor(() => expect(tsvc.labelSettings).toHaveBeenCalled());
  await flush();
  r.rerender(<Harness open />);
  await flush();
  await waitFor(() => expect(r.getByTestId('etiket-bilgisi-widthCm')).toBeTruthy());
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  tsvc.labelSuggestions.mockResolvedValue({ workOrderId: 'wo-1', customerIds: [], itemNames: [], colorNames: [], batchNos: [], last: null });
  tsvc.getLabelOverrides.mockResolvedValue({ keys: KEYS, overrides: {}, updatedAt: null });
});

describe('visibleOverrideKeys (saf)', () => {
  it('ad/renk hep düşer; parti alanı açıkken batchNumber da düşer', () => {
    expect(visibleOverrideKeys(KEYS, true).map((k) => k.key)).toEqual(['widthCm', 'deliveryNoteRollNo', 'orderNumber']);
    expect(visibleOverrideKeys(KEYS, false).map((k) => k.key)).toEqual(['widthCm', 'deliveryNoteRollNo', 'orderNumber', 'batchNumber']);
  });
});

describe('Etiket bilgisi — geniş tek pencere', () => {
  it('iş emri alanları dokunmadan görünür; parti alanı açıkken tek "Parti no"', async () => {
    const r = await openWith(true);
    expect(r.getByTestId('etiket-diger-alanlar')).toBeTruthy();
    expect(r.getByTestId('etiket-bilgisi-deliveryNoteRollNo')).toBeTruthy();
    expect(r.getByTestId('etiket-bilgisi-orderNumber')).toBeTruthy();
    expect(r.getByTestId('etiket-batch')).toBeTruthy();
    expect(r.queryByTestId('etiket-bilgisi-batchNumber')).toBeNull();
    expect(r.queryByText(/Diğer etiket alanları/)).toBeNull();
  });

  it('parti alanı kapalıyken İE-geneli Parti no satırı görünür (tek parti alanı yine o)', async () => {
    const r = await openWith(false);
    expect(r.queryByTestId('etiket-batch')).toBeNull();
    expect(r.getByTestId('etiket-bilgisi-batchNumber')).toBeTruthy();
  });

  it('alt çubuk: Vazgeç solda, Kaydet sağda', async () => {
    const r = await openWith(true);
    const order = r.getAllByText(/^(Vazgeç|Kaydet)$/).map((n) => n.props.children);
    expect(order).toEqual(['Vazgeç', 'Kaydet']);
    expect(r.getByTestId('etiket-bilgisi-vazgec')).toBeTruthy();
  });
});
