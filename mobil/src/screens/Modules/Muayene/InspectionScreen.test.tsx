// K4P-EKRAN — bağımsız Muayene ekranı: okut → aynı bileşen; aktif muayeneli top → kayıt kapalı;
// KAYDET → token'lı POST; belirsiz hatada AYNI token, kesin 4xx'te YENİ token; 409 metni; çevrimdışı şerit.
import React, { type ReactNode } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { useInspectionDraftStore } from '../../../components/inspection/inspectionDraftStore';
import { standaloneDraftKey } from './standaloneInspectionHost';
import InspectionScreen from './InspectionScreen';
import { AMBIGUOUS_CODE, UNIQUE_CUSTOMER_CODE, ambiguousScanError, ambiguousTitle, customerCodeMatch } from '../../../test/ambiguousScanFixture';

const mockGetByBarcode = jest.fn();
const mockPreview = jest.fn();
const mockCreate = jest.fn();
let mockOnline = true;
let mockScanCode = '';

jest.mock('../../../services/roll.service', () => ({ rollService: { getByBarcode: (b: string) => mockGetByBarcode(b) } }));
jest.mock('../../../services/qualityInspection.service', () => ({
  qualityInspectionService: { preview: (b: unknown) => mockPreview(b), create: (b: unknown) => mockCreate(b) },
}));
jest.mock('../../../services/defectType.service', () => ({
  defectTypeService: {
    list: async () => ({ data: [{ id: 't1', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true, fixedPoints: null }] }),
  },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useKaliteGuvenceEnabled: () => true }));
jest.mock('../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (c: string) => c === 'mobile:muayene' }) }));
jest.mock('../../../offline/hooks', () => ({ useIsOnline: () => mockOnline }));
jest.mock('../../../hooks/useDeviceType', () => ({ useDeviceType: () => 'tablet' }));
jest.mock('../../../hooks/useLandscapeLock', () => ({ useLandscapeLock: () => {} }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../components/ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
jest.mock('../../../components/ScannerEntryBar', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { onScan: () => void; scanCtaLabel: string }) => (
      <Pressable testID="open-camera" onPress={p.onScan}><Text>{p.scanCtaLabel}</Text></Pressable>
    ),
  };
});
jest.mock('../../../components/BarcodeScannerModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: (p: { visible: boolean; trigger: string; onScan: (c: string) => void }) =>
      p.visible ? (
        <Pressable testID="camera" onPress={() => p.onScan(mockScanCode)}><Text>{`trigger:${p.trigger}`}</Text></Pressable>
      ) : null,
  };
});
jest.mock('../../../components/NumpadInput', () => {
  const { TextInput } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string }) => <TextInput testID="meter" value={p.value} /> };
});

const roll = (id: string) => ({ id, barcode: `T-${id}`, itemId: 'i1', initialQty: 96, currentQty: 96, weightKg: null, width: null, qualityGrade: '1.KALİTE', status: 'IN_STOCK', item: { id: 'i1', code: 'PNM', name: 'PANAMA' } });
const status = (active: unknown = null) => ({ data: { totalPoints: 0, cappedPoints: 0, widthCm: '280', widthSource: 'ITEM_CARD', pointsPer100M2: null, gradeScore: null, ruleSet: null, suggested: null, phase: 'RAW', activeInspection: active } });

async function scanRoll(id: string) {
  mockScanCode = `T-${id}`;
  mockGetByBarcode.mockResolvedValueOnce({ data: roll(id) });
  const r = renderWithPaper(<InspectionScreen />);
  expect(r.getByTestId('inspection-empty')).toBeOnTheScreen();
  fireEvent.press(r.getByTestId('open-camera'));
  expect(r.getByText('trigger:auto')).toBeOnTheScreen();
  await act(async () => fireEvent.press(r.getByTestId('camera')));
  await waitFor(() => expect(r.getByTestId('inspection-roll-strip')).toBeOnTheScreen());
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  useInspectionDraftStore.setState({ drafts: {}, hydrated: true });
  mockPreview.mockResolvedValue(status());
});

describe('InspectionScreen (bağımsız muayene)', () => {
  it('okut → şerit + AYNI InspectionPanel (tür ızgarası); durum önizlemesi rollId ile', async () => {
    const r = await scanRoll('a');
    await waitFor(() => expect(r.getByText(/PANAMA · 96,0 m · en 280 \(kart\) · 1\.KALİTE/)).toBeOnTheScreen());
    expect(mockGetByBarcode).toHaveBeenCalledWith('T-a');
    expect(mockPreview).toHaveBeenCalledWith({ rollId: 'a', defects: [] });
    await waitFor(() => expect(r.getByText('Leke')).toBeOnTheScreen());
    expect(r.getByTestId('inspection-save')).toBeOnTheScreen();
  });

  it('aktif muayeneli top → uyarı, panel YOK, KAYDET kapalı', async () => {
    mockPreview.mockResolvedValue(status({ id: 'x', phase: 'RAW', revision: 1 }));
    const r = await scanRoll('b');
    await waitFor(() => expect(r.getByText('Bu topun r1 muayenesi var — panelden düzeltilir')).toBeOnTheScreen());
    expect(r.queryByText('Leke')).toBeNull();
    fireEvent.press(r.getByTestId('inspection-save'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('KAYDET → token’lı POST (taslak hatalarıyla); belirsiz hatada AYNI token, 4xx sonrası YENİ token', async () => {
    useInspectionDraftStore.getState().dispatch(standaloneDraftKey('c'), { type: 'add', id: 'd1', defectTypeId: 't1', meter: 10, sizeClass: 'S1', fixedPoints: null });
    const r = await scanRoll('c');
    await waitFor(() => expect(r.getByText('KAYDET · 1 hata')).toBeOnTheScreen());
    mockCreate.mockRejectedValueOnce({ message: 'Network Error' });
    await act(async () => fireEvent.press(r.getByTestId('inspection-save')));
    await waitFor(() => expect(r.getByTestId('inspection-save-error')).toBeOnTheScreen());
    mockCreate.mockRejectedValueOnce({ status: 400, message: 'Metre topun boyunu aşıyor', details: { code: 'VALIDATION' } });
    await act(async () => fireEvent.press(r.getByTestId('inspection-save')));
    await waitFor(() => expect(r.getByText('Metre topun boyunu aşıyor')).toBeOnTheScreen());
    mockCreate.mockResolvedValueOnce({ data: { id: 'n', rollId: 'c', phase: 'RAW', revision: 1, totalPoints: 1, defectCount: 1, pointsPer100M2: '0.37', suggestedGradeCode: 'A' } });
    await act(async () => fireEvent.press(r.getByTestId('inspection-save')));
    await waitFor(() => expect(r.getByTestId('inspection-empty')).toBeOnTheScreen());
    const bodies = mockCreate.mock.calls.map((c) => c[0] as { clientToken: string; rollId: string; defects: unknown[] });
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({ rollId: 'c', defects: [{ defectTypeId: 't1', sizeClass: 'UP_TO_3IN', startMeter: 10 }] });
    expect(bodies[1]!.clientToken).toBe(bodies[0]!.clientToken);
    expect(bodies[2]!.clientToken).not.toBe(bodies[1]!.clientToken);
    expect(useInspectionDraftStore.getState().drafts[standaloneDraftKey('c')]).toBeUndefined();
  });

  it('409 INSPECTION_ALREADY_ACTIVE → metin + durum tazelenir (uyarıya döner)', async () => {
    const r = await scanRoll('d');
    await waitFor(() => expect(r.getByText('KAYDET · hata yok')).toBeOnTheScreen());
    mockCreate.mockRejectedValueOnce({ status: 409, message: 'x', details: { code: 'INSPECTION_ALREADY_ACTIVE' } });
    mockPreview.mockResolvedValue(status({ id: 'y', phase: 'RAW', revision: 2 }));
    await act(async () => fireEvent.press(r.getByTestId('inspection-save')));
    await waitFor(() => expect(r.getByText('Bu topun muayenesi var — panelden düzeltilir')).toBeOnTheScreen());
    await waitFor(() => expect(r.getByText('Bu topun r2 muayenesi var — panelden düzeltilir')).toBeOnTheScreen());
  });

  it('çevrimdışı → şerit, KAYDET kapalı, taslak cihazda kalır', async () => {
    useInspectionDraftStore.getState().dispatch(standaloneDraftKey('e'), { type: 'add', id: 'd2', defectTypeId: 't1', meter: null, sizeClass: 'S4', fixedPoints: null });
    mockOnline = false;
    const r = await scanRoll('e');
    expect(r.getByTestId('inspection-screen-offline')).toBeOnTheScreen();
    fireEvent.press(r.getByTestId('inspection-save'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(useInspectionDraftStore.getState().drafts[standaloneDraftKey('e')]?.defects).toHaveLength(1);
  });

  describe('D4-KUC3d — müşteri barkodu', () => {
    async function scanCode(code: string) {
      mockScanCode = code;
      const r = renderWithPaper(<InspectionScreen />);
      fireEvent.press(r.getByTestId('open-camera'));
      await act(async () => fireEvent.press(r.getByTestId('camera')));
      return r;
    }

    it('⭐ belirsiz kod → aday modalı; seçim İÇ barkodla yeniden okutulur', async () => {
      mockGetByBarcode.mockRejectedValueOnce(ambiguousScanError([{ rollId: 'a', barcode: 'T-a', customerName: 'Acar Perde' }, { rollId: 'b', barcode: 'T-b', customerName: 'Bora Tekstil' }]));
      const r = await scanCode(AMBIGUOUS_CODE);
      expect(await r.findByText(ambiguousTitle())).toBeOnTheScreen();
      expect(r.queryByTestId('inspection-scan-error')).toBeNull();
      mockGetByBarcode.mockResolvedValueOnce({ data: roll('b') });
      await act(async () => fireEvent.press(r.getByText('T-b')));
      expect(mockGetByBarcode).toHaveBeenLastCalledWith('T-b');
      await waitFor(() => expect(r.getByTestId('inspection-roll-strip')).toBeOnTheScreen());
      expect(r.queryByTestId('musteri-kodu-eslesme')).toBeNull();
    });

    it('⭐ müşteri koduyla bulunan top → "müşteri barkodu ile bulundu" notu', async () => {
      mockGetByBarcode.mockResolvedValueOnce({ data: { ...roll('a'), ...customerCodeMatch() } });
      const r = await scanCode(UNIQUE_CUSTOMER_CODE);
      await waitFor(() => expect(r.getByTestId('inspection-roll-strip')).toBeOnTheScreen());
      expect(r.getByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
    });

    it('404 (bulunamadı / eski backend) → bugünkü hata metni, modal YOK', async () => {
      mockGetByBarcode.mockRejectedValueOnce({ status: 404, message: 'Endpoint bulunamadı', details: {} });
      const r = await scanCode(AMBIGUOUS_CODE);
      await waitFor(() => expect(r.getByTestId('inspection-scan-error')).toHaveTextContent('MK77 — top bulunamadı'));
      expect(r.queryByText(ambiguousTitle())).toBeNull();
    });
  });
});
