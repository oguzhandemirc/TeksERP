// "Taslağı iptal et" (sahte API): onay kartı satır/parti/sayfa sayısını önizlemeden gösterir, onay DELETE çağırır ve
// çağıranı haberdar eder; onaylı belgede (önizleme silinemez) onay kapalı; 409'da kart açık kalır; izinsizde düğme yok.
// Aynı belge kartı (K27 kayıt 409) eş yarım taslaksa iptal sunar; okuma ekranında görünürlük `showsDraftCancel`.
// Negatif sonda (2026-11-06): `blocked` dalı kaldırılınca "onaylı belgede onay kapalı" ❌; onSuccess'te `onCancelled`
// çağrılmayınca "iptal" ❌; sameDocumentText DRAFT dalı kaldırılınca "aynı belge taslak" ❌; geri alındı.
import React, { type ReactNode } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { useAuthStore } from '../../../store/authStore';
import CancelDraftButton from './CancelDraftButton';
import { sameDocumentText } from './SameDocumentCard';
import { showsDraftCancel } from './approvalGate';
import { draftContentsText } from '../../../services/inboundDocDraftCancel';

const mockPreview = jest.fn();
const mockCancel = jest.fn();
jest.mock('../../../services/inboundDocDraftCancel', () => ({
  ...jest.requireActual('../../../services/inboundDocDraftCancel'),
  draftCancelService: { preview: (id: string) => mockPreview(id), cancel: (id: string) => mockCancel(id) },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../components/ModuleSheet', () => ({
  __esModule: true,
  default: (p: { visible: boolean; title: string; children: ReactNode; footer: ReactNode }) => {
    const RN = jest.requireActual('react-native-paper');
    return p.visible ? <><RN.Text testID="kart-baslik">{p.title}</RN.Text>{p.children}{p.footer}</> : null;
  },
  sheet: { hint: {} },
}));

const NOTE = { id: 'n1', noteNo: 'GB-0007' };
const PREVIEW = { id: 'n1', noteNo: 'GB-0007', deletable: true, code: null, reason: null, lineCount: 12, partyCount: 2, scanCount: 3 };
const setPerms = (permissions: string[]) => act(() => useAuthStore.setState({ user: { permissions } as never }));

beforeEach(() => {
  mockPreview.mockReset();
  mockCancel.mockReset();
  setPerms(['gelen-belge:write']);
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

describe('CancelDraftButton', () => {
  it('kart taslağın içeriğini gösterir; onay iptal eder ve çağıranı haberdar eder', async () => {
    mockPreview.mockResolvedValue(PREVIEW);
    mockCancel.mockResolvedValue({ id: 'n1' });
    const onCancelled = jest.fn();
    const r = renderWithPaper(<CancelDraftButton note={NOTE} onCancelled={onCancelled} />);
    expect(mockPreview).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('belge-taslak-iptal'));
    await waitFor(() => expect(r.getByTestId('belge-taslak-iptal-icerik')).toHaveTextContent('12 satır · 2 parti · 3 sayfa fotoğrafı'));
    expect(r.getByTestId('kart-baslik')).toHaveTextContent('GB-0007 taslağı iptal edilsin mi?');
    fireEvent.press(r.getByTestId('belge-taslak-iptal-onay'));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(mockCancel).toHaveBeenCalledWith('n1');
    expect(r.queryByTestId('kart-baslik')).toBeNull();
  });

  it('onaylı belgede (önizleme silinemez) neden yazılır, onay kapalı', async () => {
    mockPreview.mockResolvedValue({ ...PREVIEW, deletable: false, code: 'DELIVERY_NOTE_NOT_DRAFT', reason: 'Onaylanmış belge silinemez (topları doğdu); ancak iptal edilir.' });
    const r = renderWithPaper(<CancelDraftButton note={NOTE} onCancelled={jest.fn()} />);
    fireEvent.press(r.getByTestId('belge-taslak-iptal'));
    await waitFor(() => expect(r.getByTestId('belge-taslak-iptal-engel')).toHaveTextContent(/Onaylanmış belge/));
    expect(r.getByTestId('belge-taslak-iptal-onay')).toBeDisabled();
    fireEvent.press(r.getByTestId('belge-taslak-iptal-onay'));
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('409 (bu arada onaylandı): kart açık kalır, çağıran haberdar edilmez', async () => {
    mockPreview.mockResolvedValue(PREVIEW);
    mockCancel.mockRejectedValue({ status: 409, message: 'GB-0007 taslak değil (APPROVED)' });
    const onCancelled = jest.fn();
    const r = renderWithPaper(<CancelDraftButton note={NOTE} onCancelled={onCancelled} />);
    fireEvent.press(r.getByTestId('belge-taslak-iptal'));
    await waitFor(() => expect(r.getByTestId('belge-taslak-iptal-icerik')).toBeTruthy());
    fireEvent.press(r.getByTestId('belge-taslak-iptal-onay'));
    await waitFor(() => expect(mockCancel).toHaveBeenCalled());
    expect(onCancelled).not.toHaveBeenCalled();
    expect(r.getByTestId('kart-baslik')).toBeTruthy();
  });

  it('gelen-belge:write yoksa düğme çizilmez', () => {
    setPerms(['gelen-belge:read']);
    const r = renderWithPaper(<CancelDraftButton note={NOTE} onCancelled={jest.fn()} />);
    expect(r.queryByTestId('belge-taslak-iptal')).toBeNull();
  });
});

describe('saf parçalar', () => {
  it('içerik metni: eski sunucu parti sayısı göndermezse parti yazılmaz', () => {
    expect(draftContentsText({ lineCount: 4, partyCount: 1, scanCount: 1 })).toBe('4 satır · 1 parti · 1 sayfa fotoğrafı');
    expect(draftContentsText({ lineCount: 4, scanCount: 0 })).toBe('4 satır · 0 sayfa fotoğrafı');
  });

  it('okuma ekranı: detay yok → göster (sunucu karar verir); DRAFT → göster; onaylı → gizle', () => {
    expect(showsDraftCancel(undefined)).toBe(true);
    expect(showsDraftCancel({ status: 'DRAFT' })).toBe(true);
    expect(showsDraftCancel({ status: 'APPROVED' })).toBe(false);
    expect(showsDraftCancel({ status: 'PARTIAL' })).toBe(false);
  });

  it('aynı belge kartı: eş yarım taslak → iptal sunulur, yeni İE sunulmaz', () => {
    const t = sameDocumentText({
      via: 'DOC_NO', state: 'DRAFT', workOrders: [],
      note: { id: 'n0', noteNo: 'GB-0001', status: 'DRAFT', senderDocNo: 'A-1', createdAt: '2026-11-06T06:00:00.000Z', approvedAt: null, updatedAt: '2026-11-06T06:00:00.000Z' },
    });
    expect(t.title).toBe('Bu belge yarım kalmış bir taslakta');
    expect(t.canCancelDraft).toBe(true);
    expect(t.canStartNew).toBe(false);
    expect(t.lines.join(' ')).toMatch(/GB-0001 taslağı/);
  });
});
