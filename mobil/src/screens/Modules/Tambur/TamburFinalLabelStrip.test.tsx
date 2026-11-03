// Gülkesim S5 tambur basım ekranı: final etiket şeridi + etiket bilgisi penceresi + "Basılmayanları bas".
// (1) ayarsız müşteri ve İE'siz ekranda şerit hiç çizilmez (bugünkü ekran);
// (2) bölme önerisi çipi kesim metresine yazar; tartım açıkken kg kutusu görünür; END ipucu;
// (3) etiket bilgisi: yalnız değişen anahtar + "boş bas" PUT'a gider; (4) panel düğmesi yalnız END'de.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburFinalLabelStrip from './TamburFinalLabelStrip';
import TamburLabelInfoModal from './TamburLabelInfoModal';
import WorkOrderOutputPanel from './WorkOrderOutputPanel';
import { DEFAULT_LABEL_SETTINGS } from './finalLabel';
import { tamburService } from '../../../services/tambur.service';
import type { Roll } from '../../../types/models';

jest.mock('../../../components/NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; onChangeText: (v: string) => void; testID?: string }) => (
      <TextInput testID={p.testID} value={p.value} onChangeText={p.onChangeText} />
    ),
  };
});

jest.mock('../../../services/tambur.service', () => ({
  tamburService: {
    getLabelOverrides: jest.fn(),
    putLabelOverrides: jest.fn(),
    recentOutputRolls: jest.fn(),
  },
}));

const svc = tamburService as unknown as {
  getLabelOverrides: jest.Mock;
  putLabelOverrides: jest.Mock;
  recentOutputRolls: jest.Mock;
};

const noop = () => undefined;
// AppModal içeriği SimplePortal ile host'a bir mikrotask gecikmeyle taşınır — olaylar arası boşalt.
const flush = () => act(async () => { await Promise.resolve(); });

describe('TamburFinalLabelStrip', () => {
  it('ayarsız müşteri + İE yok → hiçbir şey çizilmez', () => {
    const r = renderWithPaper(
      <TamburFinalLabelStrip settings={DEFAULT_LABEL_SETTINGS} remaining={120} kgText="" onKgChange={noop} onSuggest={noop} />,
    );
    expect(r.queryByTestId('tambur-final-etiket-serit')).toBeNull();
  });

  it('bölme önerisi kesim metresine yazar; tartım kutusu; END ipucu; etiket bilgisi düğmesi', () => {
    const onSuggest = jest.fn();
    const onKg = jest.fn();
    const onInfo = jest.fn();
    const r = renderWithPaper(
      <TamburFinalLabelStrip
        settings={{ ...DEFAULT_LABEL_SETTINGS, weighRequired: true, splitLengthM: 50, printTiming: 'END' }}
        remaining={120}
        kgText=""
        onKgChange={onKg}
        onSuggest={onSuggest}
        onOpenLabelInfo={onInfo}
      />,
    );
    fireEvent.press(r.getByTestId('tambur-bolme-onerisi'));
    expect(onSuggest).toHaveBeenCalledWith('50');
    fireEvent.changeText(r.getByTestId('tambur-tartim-kg'), '12,5');
    expect(onKg).toHaveBeenCalledWith('12,5');
    expect(r.getByText('Etiket iş bitince basılır')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-etiket-bilgisi'));
    expect(onInfo).toHaveBeenCalled();
  });

  it('kalan bölme ölçüsünden küçükse öneri yok', () => {
    const r = renderWithPaper(
      <TamburFinalLabelStrip settings={{ ...DEFAULT_LABEL_SETTINGS, splitLengthM: 50 }} remaining={40} kgText="" onKgChange={noop} onSuggest={noop} onOpenLabelInfo={noop} />,
    );
    expect(r.queryByTestId('tambur-bolme-onerisi')).toBeNull();
    expect(r.queryByTestId('tambur-tartim-kg')).toBeNull();
  });
});

describe('TamburLabelInfoModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('desen ekle + renk boş bas → yalnız değişen anahtarlar PUT edilir', async () => {
    svc.getLabelOverrides.mockResolvedValue({
      workOrderId: 'wo1',
      workOrderNumber: 'IE-1',
      overrides: { widthCm: '150' },
      keys: [
        { key: 'deliveryNoteItemText', label: 'Desen', type: 'text' },
        { key: 'deliveryNoteColorText', label: 'Renk', type: 'text' },
        { key: 'widthCm', label: 'En (cm)', type: 'number' },
      ],
      updatedAt: '2026-11-03T00:00:00.000Z',
    });
    svc.putLabelOverrides.mockResolvedValue({ workOrderId: 'wo1', workOrderNumber: 'IE-1', overrides: {}, keys: [], updatedAt: 'x' });
    const onDismiss = jest.fn();
    const r = renderWithPaper(<TamburLabelInfoModal workOrderId="wo1" visible onDismiss={onDismiss} />);
    await waitFor(() => expect(r.getByTestId('etiket-bilgisi-deliveryNoteItemText')).toBeTruthy());
    fireEvent.changeText(r.getByTestId('etiket-bilgisi-deliveryNoteItemText'), 'FLORAL 12');
    await flush();
    fireEvent.press(r.getByTestId('etiket-bilgisi-bos-deliveryNoteColorText'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await waitFor(() => expect(svc.putLabelOverrides).toHaveBeenCalled());
    expect(svc.putLabelOverrides).toHaveBeenCalledWith('wo1', {
      overrides: { deliveryNoteItemText: 'FLORAL 12', deliveryNoteColorText: '' },
      updatedAt: '2026-11-03T00:00:00.000Z',
    });
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});

describe('WorkOrderOutputPanel — Basılmayanları bas', () => {
  const rolls = [
    { id: 'r1', barcode: 'T1', initialQty: 50, createdAt: '2026-11-03T08:00:00Z', labelPrintedAt: null },
    { id: 'r2', barcode: 'T2', initialQty: 50, createdAt: '2026-11-03T08:05:00Z', labelPrintedAt: '2026-11-03T08:06:00Z' },
  ] as unknown as Roll[];

  beforeEach(() => svc.recentOutputRolls.mockResolvedValue({ data: rolls }));

  it('END (prop verildi) → basılmamış toplar kuyruğa', async () => {
    const onBulk = jest.fn();
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} onPrintUnprinted={onBulk} />);
    await waitFor(() => expect(r.getByTestId('wo-output-basilmayanlari-bas')).toBeTruthy());
    expect(r.getByText('Basılmayanları bas (1)')).toBeTruthy();
    fireEvent.press(r.getByTestId('wo-output-basilmayanlari-bas'));
    expect(onBulk.mock.calls[0][0].map((x: Roll) => x.id)).toEqual(['r1']);
  });

  it('EACH (prop yok) → düğme yok (bugünkü panel)', async () => {
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} />);
    await waitFor(() => expect(r.getByText('T1')).toBeTruthy());
    expect(r.queryByTestId('wo-output-basilmayanlari-bas')).toBeNull();
  });
});
