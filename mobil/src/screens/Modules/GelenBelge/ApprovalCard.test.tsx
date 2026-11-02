// Onay kartı (T2) uçtan uca (sahte API): kart sunucu sinyaliyle çıkar, seçimler PATCH'e, onay gövdesi rotayı yalnız
// seçilince taşır, izinsiz kullanıcıda onay çağrılmaz, eski backend / izinsiz detayda kart yok.
// Negatif sonda (2026-11-02): `perDocument` sinyali yok sayılınca "eski backend" ❌ · izin dalı ters → 11 ❌ · rota hep gönderilince
// "varsayılan rota" ❌ · REVIEW kodu engeli kaldırılınca 2 ❌ · izinsiz onay çağrılınca "Taslak olarak bırak" ❌; hepsi geri alındı.
import React, { type ReactNode } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { useAuthStore } from '../../../store/authStore';
import ApprovalCard from './ApprovalCard';

const mockDetail = jest.fn();
const mockUpdate = jest.fn();
const mockApprove = jest.fn();
const mockRoutes = jest.fn();

jest.mock('../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    tabletContext: async () => ({ success: true, data: { customers: [{ id: 'c1', name: 'Müşteri A' }, { id: 'c2', name: 'Müşteri B' }] } }),
    noteDetail: (id: string) => mockDetail(id),
    updateNote: (id: string, b: unknown) => mockUpdate(id, b),
    approveNote: (id: string, b: unknown) => mockApprove(id, b),
  },
}));
jest.mock('../../../services/route.service', () => ({ routeService: { getAll: () => mockRoutes() } }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
// Seçici ve kart iskeleti (kendi bekçileri PickerModal.test / ModuleSheet.test).
jest.mock('../../../components/PickerModal', () => {
  const RN = jest.requireActual('react-native-paper');
  return {
    __esModule: true,
    default: (p: { visible: boolean; title: string; options: { value: string; label: string }[]; leadingAction?: { label: string; onPress: () => void }; onSelect: (v: string) => void }) =>
      p.visible ? (
        <>
          <RN.Text testID="secici-baslik">{p.title}</RN.Text>
          {p.leadingAction ? <RN.Button onPress={p.leadingAction.onPress}>{p.leadingAction.label}</RN.Button> : null}
          {p.options.map((o) => (
            <RN.Button key={o.value} onPress={() => p.onSelect(o.value)}>{`seç:${o.label}`}</RN.Button>
          ))}
        </>
      ) : null,
  };
});
jest.mock('../../../components/ModuleSheet', () => {
  const RN = jest.requireActual('react-native-paper');
  return {
    __esModule: true,
    default: (p: { visible: boolean; children: ReactNode; footer: ReactNode }) => (p.visible ? <>{p.children}{p.footer}</> : null),
    SheetField: (p: { label: string; value: string; placeholder: string; onPress: () => void; disabled?: boolean }) => (
      <RN.Button onPress={p.onPress} disabled={p.disabled} testID={`alan-${p.label}`}>{`${p.label}: ${p.value || p.placeholder}`}</RN.Button>
    ),
  };
});
jest.mock('../../../components/NumpadInput', () => {
  const RN = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; onChangeText: (t: string) => void; testID?: string }) => <RN.TextInput value={p.value} onChangeText={p.onChangeText} testID={p.testID} /> };
});

const DETAIL = {
  id: 'n1', noteNo: 'GB-0001', status: 'DRAFT', ownerCustomerId: 'c1',
  ourBatchNo: null, ourBatchNoKey: null, kursunMeters: '241', kursunMetersSource: 'OUTPUT', kursunMetersReview: false,
  batchNoCandidates: [
    { key: 'isEmriNo', kind: 'BARCODE', label: 'İş Emri', value: 'ISM1439770' },
    { key: 'musteriPartiNo', kind: 'BATCH', label: 'Parti No', value: '70779' },
  ],
  kursunMeterCandidates: { output: '241', total: null, input: '238', lineSum: '241' },
  perDocument: { code: null, warnings: [], totalsBlocking: false },
};
const APPROVED = {
  note: { id: 'n1', noteNo: 'GB-0001', status: 'APPROVED' },
  summary: { entered: 1, failed: 0, skipped: 0, replayed: 0 },
  autoWorkOrders: { opened: 1, manual: 0, reason: null, groups: [{ key: 'g', itemName: 'Müşteri malı', rollCount: 1, outcome: 'OPENED', workOrderNumber: 'TIE-0042' }] },
  warnings: [],
};

const setPerms = (permissions: string[]) => act(() => useAuthStore.setState({ user: { permissions } as never }));
const render = (onDone = jest.fn()) => ({ onDone, r: renderWithPaper(<ApprovalCard noteId="n1" readDone onDone={onDone} />) });

beforeEach(() => {
  mockDetail.mockReset().mockResolvedValue(DETAIL);
  mockUpdate.mockReset().mockResolvedValue({});
  mockApprove.mockReset().mockResolvedValue(APPROVED);
  mockRoutes.mockReset().mockResolvedValue({ success: true, data: [{ id: 'r1', name: 'Kurşun', code: 'KRS' }, { id: 'r2', name: 'Kurşun → Tambur', code: null }], pagination: {} });
  setPerms(['gelen-belge:write', 'gelen-belge:read', 'gelen-belge:approve']);
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

describe('ApprovalCard', () => {
  it('⭐ onay izni: aday seçimi PATCH, varsayılan rota → gövdede routeTemplateId YOK, sonuçta iş emri no', async () => {
    const { r, onDone } = render();
    expect(await r.findByTestId('onay-karti')).toBeTruthy();
    expect(r.getByTestId('alan-Parti no')).toHaveTextContent(/Parti no seçin \(2 aday\)/);
    expect(r.getByTestId('onay-karti-metre')).toHaveTextContent(/241 m \(çıkış\)/);
    expect(r.getByTestId('onay-karti-birincil')).toHaveTextContent(/Onayla ve .*iş emri aç/);

    fireEvent.press(r.getByTestId('alan-Parti no'));
    fireEvent.press(r.getByText('seç:70779'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('n1', { ourBatchNo: '70779', ourBatchNoKey: 'musteriPartiNo' }));
    await waitFor(() => expect(mockDetail).toHaveBeenCalledTimes(2));

    fireEvent.press(r.getByTestId('onay-karti-birincil'));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('n1', {}));
    expect(await r.findByTestId('onay-karti-sonuc')).toHaveTextContent(/TIE-0042/);
    fireEvent.press(r.getByTestId('onay-karti-bitti'));
    expect(onDone).toHaveBeenCalled();
  });

  it('rota seçilince onay gövdesi routeTemplateId taşır; "Fabrika varsayılanı" geri alır', async () => {
    const { r } = render();
    await r.findByTestId('onay-karti');
    fireEvent.press(r.getByTestId('alan-Rota şablonu'));
    fireEvent.press(await r.findByText('seç:Kurşun → Tambur'));
    expect(r.getByTestId('alan-Rota şablonu')).toHaveTextContent(/Kurşun → Tambur/);
    fireEvent.press(r.getByTestId('alan-Rota şablonu'));
    fireEvent.press(r.getByText('Fabrika varsayılanı'));
    expect(r.getByTestId('alan-Rota şablonu')).toHaveTextContent(/Fabrika varsayılanı/);
    fireEvent.press(r.getByTestId('alan-Rota şablonu'));
    fireEvent.press(r.getByText('seç:Kurşun → Tambur'));
    fireEvent.press(r.getByTestId('onay-karti-birincil'));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('n1', { routeTemplateId: 'r2' }));
  });

  it('review bekleyen metre (sunucu kodu) → onay pasif; Doğrula → PATCH; Düzelt → çip değeri PATCH', async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, ourBatchNo: 'ISM1439770', kursunMetersReview: true, perDocument: { code: 'KURSUN_METERS_REVIEW_PENDING', warnings: [] } });
    const { r } = render();
    await r.findByTestId('onay-karti');
    expect(r.getByTestId('onay-karti-birincil')).toBeDisabled();
    expect(r.getByText(/Kurşun metresini doğrulayın/)).toBeTruthy();
    fireEvent.press(r.getByTestId('onay-karti-birincil'));
    expect(mockApprove).not.toHaveBeenCalled();

    fireEvent.press(r.getByTestId('onay-karti-dogrula'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('n1', { kursunMetersReviewed: true }));

    await waitFor(() => expect(r.getByTestId('onay-karti-duzelt')).not.toBeDisabled());
    fireEvent.press(r.getByTestId('onay-karti-duzelt'));
    fireEvent.press(await r.findByTestId('onay-karti-metre-input'));
    await waitFor(() => expect(mockUpdate).toHaveBeenLastCalledWith('n1', { kursunMeters: 238 }));
  });

  it('elle metre: geçersiz değerde Kaydet pasif, geçerlide PATCH', async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, kursunMeters: null, kursunMeterCandidates: {}, perDocument: { code: 'KURSUN_METERS_REQUIRED', warnings: [] } });
    const { r } = render();
    await r.findByTestId('onay-karti');
    expect(r.getByTestId('onay-karti-birincil')).toBeDisabled();
    fireEvent.press(r.getByTestId('onay-karti-duzelt'));
    const input = await r.findByTestId('onay-karti-metre-giris');
    fireEvent.changeText(input, '0');
    expect(r.getByTestId('onay-karti-metre-kaydet')).toBeDisabled();
    fireEvent.changeText(input, '4.521');
    fireEvent.press(r.getByTestId('onay-karti-metre-kaydet'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('n1', { kursunMeters: 4521 }));
  });

  it('izin yok → "Taslak olarak bırak": onay ÇAĞRILMAZ, rota sorulmaz, ekran yeni belgeye döner', async () => {
    setPerms(['gelen-belge:write', 'gelen-belge:read']);
    const { r, onDone } = render();
    await r.findByTestId('onay-karti');
    expect(r.getByTestId('onay-karti-birincil')).toHaveTextContent(/Taslak olarak bırak$/);
    expect(r.queryByTestId('alan-Rota şablonu')).toBeNull();
    fireEvent.press(r.getByTestId('onay-karti-birincil'));
    expect(onDone).toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRoutes).not.toHaveBeenCalled();
  });

  it('eski backend / PER_LINE (perDocument yok) → kart yok', async () => {
    const { perDocument: _p, ...old } = DETAIL;
    mockDetail.mockResolvedValue(old);
    const { r } = render();
    await waitFor(() => expect(mockDetail).toHaveBeenCalled());
    await act(async () => {
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(r.queryByTestId('onay-karti')).toBeNull();
  });

  it('detay okunamıyor (izin yok 403) → kart yok, onay yok', async () => {
    mockDetail.mockRejectedValue(Object.assign(new Error('Yetkiniz yok'), { status: 403 }));
    const { r } = render();
    await waitFor(() => expect(mockDetail).toHaveBeenCalled());
    await act(async () => {
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(r.queryByTestId('onay-karti')).toBeNull();
  });

  it('sunucu onayı reddederse (409) hata gösterilir, kart tazelenir', async () => {
    mockApprove.mockRejectedValue(Object.assign(new Error('Kurşun metresi gözden geçirilmedi'), { status: 409, details: { code: 'KURSUN_METERS_REVIEW_PENDING' } }));
    const { r } = render();
    await r.findByTestId('onay-karti');
    fireEvent.press(r.getByTestId('onay-karti-birincil'));
    await waitFor(() => expect(mockDetail).toHaveBeenCalledTimes(2));
    expect(r.queryByTestId('onay-karti-sonuc')).toBeNull();
  });
});
