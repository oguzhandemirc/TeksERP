// Gülkesim tambur basım ekranı: final etiket şeridi + etiket bilgisi penceresi + "Basılmayanları bas".
// (1) ayarsız müşteri ve özetsiz ekranda şerit çizilmez; (2) bölme önerisi · tartım · END ipucu; özet satırı pencereyi açar;
// (3) pencere: kumaş adı/renk/parti no öneriden ya da serbest → yapışkan değer; diğer İE alanlarında yalnız değişen anahtar PUT;
// (4) panel düğmesi yalnız END'de.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburFinalLabelStrip, { type TamburLabelCardProps } from './TamburFinalLabelStrip';
import TamburLabelInfoModal from './TamburLabelInfoModal';
import WorkOrderOutputPanel from './WorkOrderOutputPanel';
import { DEFAULT_LABEL_SETTINGS } from './finalLabel';
import type { TamburFinalLabelState } from './useTamburFinalLabel';
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
    labelSuggestions: jest.fn(),
  },
}));

const svc = tamburService as unknown as {
  getLabelOverrides: jest.Mock;
  putLabelOverrides: jest.Mock;
  recentOutputRolls: jest.Mock;
  labelSuggestions: jest.Mock;
};

const noop = () => undefined;
// AppModal içeriği SimplePortal ile host'a bir mikrotask gecikmeyle taşınır — olaylar arası boşalt.
const flush = () => act(async () => { await Promise.resolve(); });

describe('TamburFinalLabelStrip', () => {
  it('ayarsız müşteri + özet yok → hiçbir şey çizilmez', () => {
    const r = renderWithPaper(
      <TamburFinalLabelStrip settings={DEFAULT_LABEL_SETTINGS} remaining={120} kgText="" onKgChange={noop} onSuggest={noop} />,
    );
    expect(r.queryByTestId('tambur-final-etiket-serit')).toBeNull();
    expect(r.queryByTestId('tambur-etiket-ozet')).toBeNull();
  });

  it('bölme önerisi kesim metresine yazar; tartım kutusu; END ipucu; "Etiket bilgisi" düğmesi şeritte YOK (CutActionBar\'da)', () => {
    const onSuggest = jest.fn();
    const onKg = jest.fn();
    const r = renderWithPaper(
      <TamburFinalLabelStrip
        settings={{ ...DEFAULT_LABEL_SETTINGS, weighRequired: true, splitLengthM: 50, printTiming: 'END' }}
        remaining={120}
        kgText=""
        onKgChange={onKg}
        onSuggest={onSuggest}
      />,
    );
    fireEvent.press(r.getByTestId('tambur-bolme-onerisi'));
    expect(onSuggest).toHaveBeenCalledWith('50');
    fireEvent.changeText(r.getByTestId('tambur-tartim-kg'), '12,5');
    expect(onKg).toHaveBeenCalledWith('12,5');
    expect(r.getByText('Etiket iş bitince basılır')).toBeTruthy();
    expect(r.queryByTestId('tambur-etiket-bilgisi')).toBeNull();
  });

  it('etiket özeti tek satır; dokununca pencereyi açan fonksiyon çağrılır (ayarsız müşteride de)', () => {
    const onPress = jest.fn();
    const r = renderWithPaper(
      <TamburFinalLabelStrip settings={DEFAULT_LABEL_SETTINGS} remaining={120} kgText="" onKgChange={noop} onSuggest={noop}
        labelSummary={{ text: 'Etiket: SULTAN · EKRU · P1', onPress }} />,
    );
    expect(r.getByText('Etiket: SULTAN · EKRU · P1')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-etiket-ozet'));
    expect(onPress).toHaveBeenCalled();
  });

  it('kalan bölme ölçüsünden küçükse öneri yok', () => {
    const r = renderWithPaper(
      <TamburFinalLabelStrip settings={{ ...DEFAULT_LABEL_SETTINGS, splitLengthM: 50 }} remaining={40} kgText="" onKgChange={noop} onSuggest={noop} />,
    );
    expect(r.queryByTestId('tambur-bolme-onerisi')).toBeNull();
    expect(r.queryByTestId('tambur-tartim-kg')).toBeNull();
  });
});

function fakeFinal(over: { batchEnabled?: boolean; itemName?: string; colorName?: string; batch?: string } = {}) {
  const texts = { itemName: over.itemName ?? '', colorName: over.colorName ?? '', set: jest.fn(), body: () => ({}) };
  const batch = {
    enabled: over.batchEnabled ?? false, value: over.batch ?? '', setValue: jest.fn(), body: () => undefined, recordUse: jest.fn(),
    stripText: '', stripParts: { value: null, countText: null }, warning: null,
  };
  return {
    settings: DEFAULT_LABEL_SETTINGS, kgText: '', setKgText: noop, weightKg: () => undefined, error: () => null, blocked: () => false,
    batch, texts, suggestionParams: { workOrderId: 'wo1' },
  } as unknown as TamburFinalLabelState & { texts: typeof texts; batch: typeof batch };
}

describe('TamburFinalLabelStrip — Etikette kartı (2026-11-10)', () => {
  const card = (o: Partial<TamburLabelCardProps> = {}): TamburLabelCardProps => ({
    consignee: null,
    templateName: 'Final Top Etiketi',
    rows: [
      { key: 'consigneeName', label: 'Alıcı', value: 'ABC', muted: false },
      { key: 'widthCm', label: 'En', value: '—', muted: true },
    ],
    summaryText: 'Etiket: SULTAN',
    onPress: noop,
    kg: { visible: false, required: false, text: '', onChange: noop },
    width: { visible: false, text: '', onChange: noop, placeholder: 'En (cm)' },
    ...o,
  });
  const strip = (c: TamburLabelCardProps, weighRequired = false) => renderWithPaper(
    <TamburFinalLabelStrip settings={{ ...DEFAULT_LABEL_SETTINGS, weighRequired }} remaining={120} kgText="" onKgChange={noop} onSuggest={noop}
      labelSummary={{ text: 'ESKİ ÖZET', onPress: noop }} card={c} />,
  );

  it('kart özetin yerini alır: yalnız verilen satırlar (başlık + değer bloğu); kendi topta "kimin için" yok', () => {
    const r = strip(card());
    expect(r.getByTestId('tambur-etikette-kart')).toBeTruthy();
    expect(r.getByTestId('tambur-etikette-consigneeName').props.accessibilityLabel).toBe('Alıcı: ABC');
    expect(r.getByText('ABC')).toBeTruthy();
    expect(r.getByTestId('tambur-etikette-widthCm').props.accessibilityLabel).toBe('En: —');
    expect(r.queryByText('ESKİ ÖZET')).toBeNull();
    expect(r.queryByTestId('tambur-alici-sec')).toBeNull();
  });

  it('emanette "kimin için" satırı görünür; satır da "Değiştir" düğmesi de seçiciyi açar', () => {
    const onPress = jest.fn();
    const r = strip(card({ consignee: { text: 'HHL MC (malın sahibi)', onPress } }));
    expect(r.getByText('HHL MC (malın sahibi)')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-alici-sec'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(r.getByText('Değiştir')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-alici-degistir'));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('"Şablon: …" yazısı yok; yerine "Etiketi değiştir" düğmesi etiket bilgisi/şablon penceresini açar', () => {
    const onPress = jest.fn();
    const r = strip(card({ onPress }));
    expect(r.queryByText(/Şablon:/)).toBeNull();
    expect(r.getByText('Etiketi değiştir')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-etiket-degistir'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('eski backend (rows null) → özet metni kartın içinde', () => {
    const r = strip(card({ rows: null }));
    expect(r.getByText('Etiket: SULTAN')).toBeTruthy();
  });

  it('K2: kg görünürse kartta kutu + Tart; şeritteki kg kutusu çift çizilmez', () => {
    const onTart = jest.fn();
    const onChange = jest.fn();
    const r = strip(card({ kg: { visible: true, required: true, text: '', onChange, onTart } }), true);
    expect(r.getAllByTestId('tambur-tartim-kg')).toHaveLength(1);
    fireEvent.press(r.getByTestId('tambur-tart'));
    expect(onTart).toHaveBeenCalled();
    fireEvent.changeText(r.getByTestId('tambur-tartim-kg'), '9');
    expect(onChange).toHaveBeenCalledWith('9');
  });

  it('kg/en görünmezse kutular yok; tartısız cihazda Tart yok', () => {
    expect(strip(card()).queryByTestId('tambur-tartim-kg')).toBeNull();
    const r = strip(card({ kg: { visible: true, required: false, text: '', onChange: noop }, width: { visible: true, text: '', onChange: noop, placeholder: 'En 150' } }));
    expect(r.queryByTestId('tambur-tart')).toBeNull();
    expect(r.getByTestId('tambur-en-cm')).toBeTruthy();
  });
});

describe('TamburLabelInfoModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    svc.labelSuggestions.mockResolvedValue({
      workOrderId: 'wo1', customerIds: ['c1'], itemNames: ['SULTAN', 'LALE'], colorNames: ['EKRU'], batchNos: ['P1'], last: null,
    });
  });

  it('parti ayarı kapalı → iki kutu; boş kutu kaynak ipucunu gösterir', async () => {
    const r = renderWithPaper(<TamburLabelInfoModal workOrderId="wo1" visible onDismiss={noop} final={fakeFinal()} defaults={{ itemName: 'EMANET KUMAŞ' }} />);
    await flush();
    expect(r.getByTestId('etiket-item')).toBeTruthy();
    expect(r.getByTestId('etiket-color')).toBeTruthy();
    expect(r.queryByTestId('etiket-batch')).toBeNull();
    expect(r.getByTestId('etiket-item-deger').props.children).toBe('Boş: EMANET KUMAŞ');
  });

  it('öneriden seç + serbest yaz → Kaydet yapışkan değere yazar (ad, renk, parti)', async () => {
    const final = fakeFinal({ batchEnabled: true });
    const onDismiss = jest.fn();
    const r = renderWithPaper(<TamburLabelInfoModal workOrderId="wo1" visible onDismiss={onDismiss} final={final} />);
    await flush();
    fireEvent.press(r.getByTestId('etiket-item'));
    await waitFor(() => expect(r.getByText('LALE')).toBeTruthy());
    fireEvent.press(r.getByText('LALE'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-color'));
    await flush();
    fireEvent.press(r.getByText('Kendim yazayım'));
    await flush();
    fireEvent.changeText(r.getByTestId('etiket-serbest-input'), 'KREM');
    await flush();
    fireEvent.press(r.getByTestId('etiket-serbest-kullan'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-batch'));
    await waitFor(() => expect(r.getByText('P1')).toBeTruthy());
    fireEvent.press(r.getByText('P1'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(final.texts.set).toHaveBeenCalledWith({ itemName: 'LALE', colorName: 'KREM' });
    expect(final.batch.setValue).toHaveBeenCalledWith('P1');
    expect(svc.putLabelOverrides).not.toHaveBeenCalled();
  });

  it('Diğer etiket alanları: ad/renk anahtarları gösterilmez; yalnız değişen anahtar PUT edilir', async () => {
    svc.getLabelOverrides.mockResolvedValue({
      workOrderId: 'wo1',
      workOrderNumber: 'IE-1',
      overrides: { widthCm: '150', deliveryNoteItemText: 'ESKİ DESEN' },
      keys: [
        { key: 'deliveryNoteItemText', label: 'Desen', type: 'text' },
        { key: 'colorName', label: 'Renk adı', type: 'text' },
        { key: 'widthCm', label: 'En (cm)', type: 'number' },
        { key: 'deliveryNoteRollNo', label: 'Müşteri top no', type: 'text' },
      ],
      updatedAt: '2026-11-03T00:00:00.000Z',
    });
    svc.putLabelOverrides.mockResolvedValue({ workOrderId: 'wo1', workOrderNumber: 'IE-1', overrides: {}, keys: [], updatedAt: 'x' });
    const onDismiss = jest.fn();
    const r = renderWithPaper(<TamburLabelInfoModal workOrderId="wo1" visible onDismiss={onDismiss} final={fakeFinal()} />);
    await flush();
    fireEvent.press(r.getByTestId('etiket-diger-alanlar'));
    await waitFor(() => expect(r.getByTestId('etiket-bilgisi-widthCm')).toBeTruthy());
    expect(r.queryByTestId('etiket-bilgisi-deliveryNoteItemText')).toBeNull();
    expect(r.queryByTestId('etiket-bilgisi-colorName')).toBeNull();
    fireEvent.press(r.getByTestId('etiket-bilgisi-bos-deliveryNoteRollNo'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await waitFor(() => expect(svc.putLabelOverrides).toHaveBeenCalled());
    expect(svc.putLabelOverrides).toHaveBeenCalledWith('wo1', {
      overrides: { deliveryNoteRollNo: '' },
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
