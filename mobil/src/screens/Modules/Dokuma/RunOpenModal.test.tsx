// =============================================================================
// BEKÇİ — Koşum aç SAYFALI kip (2026-09-18 iskeleti): sayfa başına tek konu, İleri'de doğrulama O sayfada, son sayfa ÖZET + Kaydet
// =============================================================================
//   §1 ilk sayfa üç seçici alanı (Dokuma işi · Desen · Renk); Kaydet YOK
//   §2 İleri → Ayarlar; geçersiz devir ile İleri → hata aynı sayfada, Özet'e geçilmez
//   §3 geçerli formla İleri, İleri → Özet satırları; Kaydet → `submitOpen`
// Test tuzağı (d5 ölçtü): SimplePortal bildirimi mikrotaskta — her basıştan sonra `await act(async () => {})`; `it` başına TEK render.
// =============================================================================
import { act, fireEvent } from '@testing-library/react-native';
import RunOpenModal from './RunOpenModal';
import { EMPTY_RUN_FORM, type RunOpenForm } from './runPayload';
import type { RunPanelState } from './useRunPanel';
import { renderWithPaper } from '../../../test/render';

jest.mock('../../../services/item.service', () => ({ itemService: { getAll: jest.fn() } }));
jest.mock('../../../services/color.service', () => ({ colorService: { listPublicForPicker: jest.fn() } }));
jest.mock('../../../hooks/useTruncationWarning', () => ({ useTruncationWarning: () => undefined }));

function fakeState(form: Partial<RunOpenForm> = {}): RunPanelState {
  return {
    openModal: true,
    setOpenModal: jest.fn(),
    closeTarget: null,
    setCloseTarget: jest.fn(),
    form: { ...EMPTY_RUN_FORM, ...form },
    setForm: jest.fn(),
    selectOrder: jest.fn(),
    weavingRequired: false,
    suggestedFrom: null,
    orders: [],
    ordersLoading: false,
    ordersError: false,
    submitOpen: jest.fn(),
    opening: false,
    submitClose: jest.fn(),
    closing: false,
    revoke: jest.fn(),
    revoking: false,
    collision: null,
    dismissCollision: jest.fn(),
    resendAsNew: jest.fn(),
  } as unknown as RunPanelState;
}

async function press(u: ReturnType<typeof renderWithPaper>, id: string) {
  fireEvent.press(u.getByTestId(id));
  await act(async () => {});
}

describe('RunOpenModal — sayfalı kip', () => {
  it('§1 ilk sayfa: Dokuma işi · Desen · Renk alanları; Kaydet yok, İleri var', async () => {
    const u = renderWithPaper(<RunOpenModal state={fakeState()} />);
    await act(async () => {});
    expect(u.getByText('Koşum aç')).toBeTruthy();
    expect(u.getByText(/Dokuma işi/)).toBeTruthy();
    expect(u.getByText('Desen')).toBeTruthy();
    expect(u.getByText('Renk')).toBeTruthy();
    expect(u.queryByTestId('paged-kaydet')).toBeNull();
    expect(u.getByTestId('paged-ileri')).toBeTruthy();
  });

  it('§2 Ayarlar sayfasında geçersiz devir → İleri hatayı O SAYFADA yazar, Özet\'e geçmez', async () => {
    const u = renderWithPaper(<RunOpenModal state={fakeState({ targetUnitsPerMin: '0' })} />);
    await act(async () => {});
    await press(u, 'paged-ileri'); // → Ayarlar
    expect(u.getByText(/Hedef devir \(atkı\/dk\)/)).toBeTruthy();
    await press(u, 'paged-ileri'); // doğrulama
    expect(u.getByTestId('paged-hata').props.children).toBe('Hedef devir pozitif tam sayı olmalı');
    expect(u.queryByTestId('paged-kaydet')).toBeNull();
    expect(u.getByText(/Hedef devir \(atkı\/dk\)/)).toBeTruthy(); // hâlâ Ayarlar
  });

  it('§3 geçerli form → Özet satırları; Kaydet submitOpen\'ı çağırır', async () => {
    const state = fakeState({ itemLabel: 'PATOS', targetUnitsPerMin: '420', unitsPerCm: '24.5' });
    const u = renderWithPaper(<RunOpenModal state={state} />);
    await act(async () => {});
    await press(u, 'paged-ileri');
    await press(u, 'paged-ileri');
    expect(u.getByText('PATOS')).toBeTruthy();
    expect(u.getByText('420')).toBeTruthy();
    expect(u.getByText('24.5')).toBeTruthy();
    expect(u.getByText('İş emrisiz (numune)')).toBeTruthy();
    expect(u.queryByTestId('paged-ileri')).toBeNull();
    await press(u, 'paged-kaydet');
    expect(state.submitOpen).toHaveBeenCalledTimes(1);
  });
});
