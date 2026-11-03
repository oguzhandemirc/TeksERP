// S16b tek form: belge okutulmadan "oluştur" kapalı; okuma sonucu inputlara dolar ("belgeden" rozeti); desen/renk önerisi
// çiple onaylanır; kayıt form ucuna ek alanlarla gider, PER_PARTY'de hedef metraj/kg gitmez.
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ProductionRoute } from '../../../../services/route.service';
import type { DocRow, ExtraFormBody } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';

let mockRows: DocRow[] = [];
let mockOpts: { extraBody?: (r: DocRow) => ExtraFormBody } | undefined;
const mockSaveAll = jest.fn();
const mockAdd = jest.fn();
jest.mock('./useWoRows', () => ({
  useWoRows: (_r: unknown, opts: typeof mockOpts) => {
    mockOpts = opts;
    return {
      rows: mockRows,
      mode: 'WITH_WORK_ORDER',
      saving: false,
      counts: { ready: mockRows.filter((r) => r.form && !r.result).length },
      saveAll: mockSaveAll,
      removeRow: jest.fn(),
      addNote: jest.fn(),
      duplicate: null,
      dismissDuplicate: jest.fn(),
      confirmDuplicate: jest.fn(),
    };
  },
}));
jest.mock('./DocRowCard', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { row: DocRow }) => <Text testID="satir-karti">{p.row.noteNo}</Text> };
});
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ pages: [], progress: { uploaded: new Set() }, sending: false, headerLocked: false, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: 0 }),
}));
jest.mock('../usePageSource', () => ({ usePageSource: () => ({ add: () => mockAdd(), busy: false }) }));
jest.mock('../PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../services/inboundDoc.service', () => ({ inboundDocService: { tabletContext: async () => ({ data: { customers: [] } }) } }));
jest.mock('../../../../services/route.service', () => ({ routeService: { getAll: async () => ({ data: [] }) } }));
jest.mock('../../../../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
jest.mock('../../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: false } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ColorSelectField', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string | null }) => <Text testID="renk-alani">{p.value ?? 'bos'}</Text> };
});

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
const row = (x: Partial<DocRow> = {}): DocRow =>
  ({
    noteId: 'n1',
    noteNo: 'GB-1',
    runKey: 1,
    gramajTouched: false,
    result: null,
    form,
    detail: {
      id: 'n1',
      noteNo: 'GB-1',
      status: 'DRAFT',
      formFields: { en: '150', hedefMetraj: '1.200,5', hedefKg: 300, desenText: 'DSN-7', renkText: 'Ekru' },
      suggestions: { targetItem: { id: 'i1', name: 'Tül Beyaz', code: 'T-1' }, targetColor: { id: 'c1', name: 'Ekru' } },
    },
    ...x,
  }) as unknown as DocRow;

const ui = (r: ProductionRoute | null = route) => <UnifiedWoForm initialRoute={r} routeLocked={r !== null} onNew={jest.fn()} />;

beforeEach(() => {
  mockRows = [];
  mockOpts = undefined;
  jest.clearAllMocks();
});

describe('UnifiedWoForm', () => {
  it('⭐ belge okutulmadan "oluştur" KAPALI + ipucu; belge alanları yer tutucu; Belge okut tarayıcıyı açar', () => {
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/Belge okut/);
    expect(s.getByTestId('ie-form-belge-yer-tutucu')).toBeTruthy();
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('⭐ okuma sonucu inputlara dolar + "belgeden" rozeti; metraj/kg bayrak kapalıyken de belgeden geldiği için görünür', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('1200.5');
    expect(s.getByTestId('ie-form-hedef-kg').props.value).toBe('300');
    expect(s.getByTestId('belgeden-targetQuantity')).toBeTruthy();
    expect(s.getByTestId('satir-karti')).toBeTruthy();
    expect(s.getByText('Belgeyi değiştir')).toBeTruthy();
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
  });

  it('⭐ öneri çipi: "Evet" → hedef kumaş / renk seçili, çip kalkar; öneri alana kendiliğinden yazılmaz', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    const chip = await s.findByTestId('ie-form-desen-oneri');
    expect(chip).toHaveTextContent(/DSN-7.*Tül Beyaz \(T-1\) mi\? Evet/);
    expect(s.getByTestId('renk-alani').props.children).toBe('bos');
    fireEvent.press(chip);
    fireEvent.press(s.getByTestId('ie-form-renk-oneri'));
    expect(s.queryByTestId('ie-form-desen-oneri')).toBeNull();
    expect(s.queryByTestId('ie-form-renk-oneri')).toBeNull();
    expect(s.getByTestId('renk-alani').props.children).toBe('c1');
    expect(s.getByText('Tül Beyaz')).toBeTruthy();
  });

  it('⭐ kayıt: ek alanlar form ucunun gövdesine; PER_PARTY satırda hedef metraj/kg GİTMEZ', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    fireEvent.press(await s.findByTestId('ie-form-desen-oneri'));
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    fireEvent.press(s.getByTestId('ie-form-olustur'));
    expect(mockSaveAll).toHaveBeenCalledTimes(1);
    expect(mockOpts?.extraBody?.(mockRows[0])).toEqual({ targetItemId: 'i1', width: 160, targetQuantity: 1200.5, targetWeight: 300 });
    const perParty = row({ form: { ...form, multi: { mode: 'PER_PARTY', rows: [] } } } as unknown as Partial<DocRow>);
    const b = mockOpts?.extraBody?.(perParty);
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
    expect(b).toMatchObject({ width: 160 });
  });

  it('düz karo (rota seçilmedi): belge okunsa da "Rotayı seçin." ile kapalı', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui(null));
    await waitFor(() => expect(s.getByTestId('ie-form-ipucu').props.children).toBe('Rotayı seçin.'));
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
  });
});
