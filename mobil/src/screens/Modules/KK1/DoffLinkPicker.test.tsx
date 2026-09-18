// BEKÇİ — KK1 "Hangi indirmeden?" seçicisi PickerModal (elle liste modalı yok); üstte "Bağsız kaydet" öncü aksiyonu; seçim bağı yazar.
import { act, fireEvent } from '@testing-library/react-native';
import DoffLinkPicker from './DoffLinkPicker';
import { renderWithPaper } from '../../../test/render';

jest.mock('../../../services/doff.service', () => ({
  doffService: { listUnlinked: jest.fn(() => Promise.resolve({ data: [{ id: 'df1', code: 'DF-1', doffedAt: '2026-09-18T01:00:00Z', pieceCount: 2, productionLineNo: 1, machine: { name: 'TZ-01' } }] })) },
}));
jest.mock('../../../components/PickerModal', () => {
  const RN = jest.requireActual('react-native-paper');
  return function PickerModalStub(p: { visible: boolean; title: string; options: { value: string; label: string }[]; leadingAction?: { label: string; onPress: () => void }; onSelect: (v: string) => void }) {
    if (!p.visible) return null;
    return (
      <>
        <RN.Text testID="picker-baslik">{p.title}</RN.Text>
        {p.leadingAction ? <RN.Button onPress={p.leadingAction.onPress}>{p.leadingAction.label}</RN.Button> : null}
        {p.options.map((o) => (
          <RN.Button key={o.value} onPress={() => p.onSelect(o.value)}>{o.label}</RN.Button>
        ))}
      </>
    );
  };
});

describe('DoffLinkPicker', () => {
  it('Evet → "Hangi indirmeden?" PickerModal açar; öncü aksiyon "Bağsız kaydet"; satır seçimi doffEventId yazar', async () => {
    const onChange = jest.fn();
    const u = renderWithPaper(<DoffLinkPicker value={{ weaving: true, doffEventId: null }} onChange={onChange} />);
    await act(async () => {});
    await act(async () => {});
    fireEvent.press(u.getByTestId('doff-link-ac'));
    await act(async () => {});
    expect(u.getByTestId('picker-baslik').props.children).toBe('Bağlanmamış indirmeler (son 3 gün)');
    expect(u.getByText('Bağsız kaydet')).toBeTruthy();
    fireEvent.press(u.getByText(/DF-1/));
    await act(async () => {});
    expect(onChange).toHaveBeenCalledWith({ weaving: true, doffEventId: 'df1' });
    expect(u.queryByTestId('picker-baslik')).toBeNull();
  });
});
