// =============================================================================
// BEKÇİ — Fason Dokuma Kabul: Top kabul SAYFALI (İrsaliye · Top i · Özet), kalite katalogdan; Levent döndü tek kart
// =============================================================================
//   §1 ilk sayfa İrsaliye; İleri → Top 1; boş metre ile İleri → hata O SAYFADA, Özet'e geçmez
//   §2 geçerli satır → Özet: top sayısı + satır özeti; Kaydet "N topu kabul et" → receive.mutate
//   §3 "Top ekle" sayfa ekler (adım göstergesinde Top 2); "Bu topu sil" tek satırda kilitli
//   §4 kalite alanı PickerModal açar (serbest metin YOK); Levent döndü: levent seçilmeden kayıt kilitli
// Test tuzağı: SimplePortal bildirimi mikrotaskta — her basıştan sonra `await act(async () => {})`; `it` başına TEK render.
// =============================================================================
import { act, fireEvent } from '@testing-library/react-native';
import { ReceiveModal, ReturnModal } from './FasonDokumaModals';
import { EMPTY_RECEIPT_ROW, type ReceiptRowForm } from './receiptPayload';
import type { FasonDokumaState } from './useFasonDokuma';
import { renderWithPaper } from '../../../test/render';

jest.mock('../../../services/qualityGrade.service', () => ({
  qualityGradeService: { list: jest.fn(() => Promise.resolve({ data: [{ id: 'g1', code: '1.KALITE', name: '1. Kalite' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })) },
}));
// PickerModal gerçek liste yerine iskelet: başlık + öncü aksiyon + seçenekler (kendi bekçisi PickerModal.test).
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

const ORDER = {
  id: 'w1', weavingOrderNumber: 'DK-7', status: 'IN_PROGRESS', item: { name: 'PATOS' }, color: { name: 'Krem' }, subcontractor: { name: 'Boyahane' },
  openDispatches: [{ dispatchId: 'd1', dispatchNo: 'SV-1', beams: [{ id: 'b1', beamNo: 'LV-1', sentM: 500 }] }],
};

function fakeState(over: Partial<{ rows: ReceiptRowForm[]; modal: 'receive' | 'return' | null; failed: string[] }> = {}): FasonDokumaState {
  let rows = over.rows ?? [{ ...EMPTY_RECEIPT_ROW }];
  const state = {
    context: { data: { weavingOrders: [ORDER] }, isError: false, isLoading: false },
    isOnline: true, offlineReason: null, refresh: jest.fn(),
    orders: [ORDER], order: ORDER, setOrderId: jest.fn(),
    modal: over.modal ?? 'receive', setModal: jest.fn(),
    get rows() { return rows; },
    setRows: jest.fn((next: ReceiptRowForm[]) => { rows = next; }),
    manifestNo: 'IRS-9', setManifestNo: jest.fn(), failedMessages: over.failed ?? [],
    receive: { mutate: jest.fn(), isPending: false }, returnBeam: { mutate: jest.fn(), isPending: false }, busy: false,
  };
  return state as unknown as FasonDokumaState;
}

async function press(u: ReturnType<typeof renderWithPaper>, id: string) {
  fireEvent.press(u.getByTestId(id));
  await act(async () => {});
}

describe('ReceiveModal — sayfalı Top kabul', () => {
  it('§1 İrsaliye sayfası; İleri → Top 1; boş metre ile İleri → "Metre pozitif olmalı" aynı sayfada, Kaydet yok', async () => {
    const u = renderWithPaper(<ReceiveModal state={fakeState()} />);
    await act(async () => {});
    expect(u.getByText('DK-7 — dönen topları kabul et')).toBeTruthy();
    expect(u.getByTestId('kabul-irsaliye')).toBeTruthy();
    await press(u, 'paged-ileri');
    expect(u.getByText('Metre *')).toBeTruthy();
    await press(u, 'paged-ileri');
    expect(u.getByTestId('paged-hata').props.children).toBe('Metre pozitif olmalı');
    expect(u.getByText('Metre *')).toBeTruthy();
    expect(u.queryByTestId('paged-kaydet')).toBeNull();
  });

  it('§2 geçerli satır → Özet (top sayısı, satır özeti); Kaydet "1 topu kabul et" → receive.mutate', async () => {
    const state = fakeState({ rows: [{ initialQty: '120', width: '150', weightKg: '', qualityGrade: '1.KALITE', colorId: null }] });
    const u = renderWithPaper(<ReceiveModal state={state} />);
    await act(async () => {});
    await press(u, 'paged-ileri');
    await press(u, 'paged-ileri');
    expect(u.getByText('Top sayısı')).toBeTruthy();
    expect(u.getByText('120 m · en 150 · — kg · 1. Kalite')).toBeTruthy();
    expect(u.getByText('1 topu kabul et')).toBeTruthy();
    await press(u, 'paged-kaydet');
    expect(state.receive.mutate).toHaveBeenCalledTimes(1);
  });

  it('§3 "Top ekle" satır ekler (setRows 2 satır); tek satırda "Bu topu sil" kilitli', async () => {
    const state = fakeState();
    const u = renderWithPaper(<ReceiveModal state={state} />);
    await act(async () => {});
    await press(u, 'paged-ileri');
    expect(u.getByTestId('kabul-satir-sil').props.accessibilityState?.disabled).toBe(true);
    await press(u, 'kabul-satir-ekle');
    expect(state.setRows).toHaveBeenCalledWith([{ ...EMPTY_RECEIPT_ROW }, { ...EMPTY_RECEIPT_ROW }]);
  });

  it('§4 Kalite alanı PickerModal açar; "Belirsiz" öncü aksiyonu ve katalog seçeneği satıra yazar', async () => {
    const state = fakeState();
    const u = renderWithPaper(<ReceiveModal state={state} />);
    await act(async () => {});
    await press(u, 'paged-ileri');
    fireEvent.press(u.getByText('Belirsiz'));
    await act(async () => {});
    expect(u.getByTestId('picker-baslik').props.children).toBe('Kalite');
    fireEvent.press(u.getByText('1. Kalite'));
    await act(async () => {});
    expect(state.setRows).toHaveBeenLastCalledWith([{ ...EMPTY_RECEIPT_ROW, qualityGrade: '1.KALITE' }]);
    expect(u.queryByTestId('picker-baslik')).toBeNull();
  });
});

describe('ReturnModal — tek kart', () => {
  it('§4 levent seçilmeden "Dönüşü kaydet" kilitli; alan PickerModal açar', async () => {
    const u = renderWithPaper(<ReturnModal state={fakeState({ modal: 'return' })} />);
    await act(async () => {});
    expect(u.getByText('DK-7 — levent döndü')).toBeTruthy();
    expect(u.getByTestId('donus-kaydet').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(u.getByText('Levent seç'));
    await act(async () => {});
    expect(u.getByTestId('picker-baslik').props.children).toBe('Dönen levent');
    expect(u.getByText('LV-1')).toBeTruthy();
  });
});

