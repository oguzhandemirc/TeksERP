// Tambur kompakt tek ekran (K5): Kime düğmesi metni, kalite segmenti, geniş tabletteki Etikette kartı
// (öneri/END ipucu kartın içinde, ayrı şerit yok) ve çıkanlar başlığındaki son kesim.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { TargetButton, QualitySegment, targetButtonText } from './TamburCompactPickers';
import TamburFinalLabelStrip, { type TamburLabelCardProps } from './TamburFinalLabelStrip';
import WorkOrderOutputPanel from './WorkOrderOutputPanel';
import { DEFAULT_LABEL_SETTINGS } from './finalLabel';
import { tamburService } from '../../../services/tambur.service';

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
  tamburService: { recentOutputRolls: jest.fn() },
}));

const noop = () => undefined;

describe('targetButtonText', () => {
  it('sipariş satırı > müşteri > Stok', () => {
    expect(targetButtonText({ lineLabel: 'ABC · TERO', customerName: 'XYZ' })).toBe('ABC · TERO');
    expect(targetButtonText({ customerName: 'XYZ' })).toBe('XYZ');
    expect(targetButtonText({})).toBe('Stok (müşterisiz)');
  });
});

describe('TargetButton / QualitySegment', () => {
  it('Kime düğmesi tek dokunuşla seçiciyi açar', () => {
    const onPress = jest.fn();
    const r = renderWithPaper(<TargetButton text="Stok (müşterisiz)" stock onPress={onPress} />);
    fireEvent.press(r.getByTestId('tambur-kime-sec'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('kalite segmenti seçili olanı işaretler, dokunuşta (kalite, aktif mi) döner', () => {
    const onPick = jest.fn();
    const grades = [
      { id: '1', code: 'K1', name: '1. Kalite' },
      { id: '2', code: 'A1', name: 'A1' },
    ];
    const r = renderWithPaper(<QualitySegment grades={grades} value="K1" onPick={onPick} />);
    expect(r.getByTestId('tambur-kalite-K1').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(r.getByTestId('tambur-kalite-A1'));
    expect(onPick).toHaveBeenCalledWith(grades[1], false);
    fireEvent.press(r.getByTestId('tambur-kalite-K1'));
    expect(onPick).toHaveBeenLastCalledWith(grades[0], true);
  });

  it('kalite düğmesinde sondaki parantezli açıklama görünmez; tam ad erişilebilirlik etiketinde', () => {
    const grades = [{ id: '2', code: 'A1', name: 'A1 (Alt Kalite)' }];
    const r = renderWithPaper(<QualitySegment grades={grades} value={null} onPick={noop} />);
    expect(r.getByText('A1')).toBeTruthy();
    expect(r.queryByText('A1 (Alt Kalite)')).toBeNull();
    expect(r.getByTestId('tambur-kalite-A1').props.accessibilityLabel).toBe('A1 (Alt Kalite)');
  });
});

describe('Etikette kartı — geniş tablet', () => {
  const card = (o: Partial<TamburLabelCardProps> = {}): TamburLabelCardProps => ({
    consignee: { text: 'HHL MC (malın sahibi)', onPress: noop },
    templateName: 'Final Top Etiketi',
    rows: [{ key: 'qualityName', label: 'Kalite', value: '1. Kalite', muted: false }],
    summaryText: 'Etiket: SULTAN',
    onPress: noop,
    kg: { visible: true, required: true, text: '', onChange: noop, onTart: noop },
    width: { visible: true, text: '', onChange: noop, placeholder: 'En 150' },
    ...o,
  });

  it('öneri ve END ipucu kartın içinde; ayrı şerit çizilmez; testID’ler korunur', () => {
    const onSuggest = jest.fn();
    const r = renderWithPaper(
      <TamburFinalLabelStrip
        settings={{ ...DEFAULT_LABEL_SETTINGS, splitLengthM: 50, printTiming: 'END' }}
        remaining={120}
        kgText=""
        onKgChange={noop}
        onSuggest={onSuggest}
        card={card()}
        wide
      />,
    );
    expect(r.queryByTestId('tambur-final-etiket-serit')).toBeNull();
    for (const id of ['tambur-etikette-kart', 'tambur-alici-sec', 'tambur-etiket-ozet', 'tambur-tartim-kg', 'tambur-tart', 'tambur-en-cm']) {
      expect(r.getByTestId(id)).toBeTruthy();
    }
    expect(r.getByText('Etiket iş bitince basılır')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-bolme-onerisi'));
    expect(onSuggest).toHaveBeenCalledWith('50');
  });

  it('kendi topta (kimin için yok) kart tek kart; kg/en kapalıyken yan sütun yok', () => {
    const r = renderWithPaper(
      <TamburFinalLabelStrip
        settings={DEFAULT_LABEL_SETTINGS}
        remaining={120}
        kgText=""
        onKgChange={noop}
        onSuggest={noop}
        card={card({ consignee: null, kg: { visible: false, required: false, text: '', onChange: noop }, width: { visible: false, text: '', onChange: noop, placeholder: '' } })}
        wide
      />,
    );
    expect(r.getAllByTestId('tambur-etikette-kart')).toHaveLength(1);
    expect(r.queryByTestId('tambur-alici-sec')).toBeNull();
    expect(r.queryByTestId('tambur-tartim-kg')).toBeNull();
  });
});

describe('Bu işten çıkanlar — son kesim başlıkta', () => {
  it('lastMeasure verilince başlıkta "son: …" ve kaynak etiketi', async () => {
    (tamburService.recentOutputRolls as jest.Mock).mockResolvedValue({ data: [] });
    const r = renderWithPaper(
      <WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} lastMeasure={{ meters: 11, source: 'OPERATOR', barcode: 'T1011260003' }} />,
    );
    const t = await r.findByTestId('tambur-olcum-serit');
    expect(t.props.children).toMatch(/^son: 0003 · 11\.0 m · /);
  });
});
