// K4P-TABLET — önizleme kancası: gövde (saf), 400 ms debounce, çevrimdışı/hata → null, kuyruğa girmez.
import { act, renderHook } from '@testing-library/react-native';
import { EMPTY_DRAFT, inspectionDraftReducer } from './inspectionDraft';
import { buildPreviewRequest, PREVIEW_DEBOUNCE_MS, useInspectionPreview } from './useInspectionPreview';
import { qualityInspectionService } from '../../services/qualityInspection.service';

jest.mock('../../services/qualityInspection.service', () => ({ qualityInspectionService: { preview: jest.fn() } }));
const preview = qualityInspectionService.preview as jest.Mock;

const draft = inspectionDraftReducer(EMPTY_DRAFT, { type: 'add', id: 'a', defectTypeId: 'leke', meter: 3, sizeClass: 'S4' });
const target = { draft: { itemId: 'i1', widthCm: 150 } };

describe('buildPreviewRequest', () => {
  it('KK1 taslağı: kumaş + uzunluk zorunlu; taslak uzunluğu formdan önce gelir', () => {
    expect(buildPreviewRequest(null, draft, 90)).toBeNull();
    expect(buildPreviewRequest(target, draft, null)).toBeNull();
    expect(buildPreviewRequest(target, draft, 90)).toEqual({ draft: { itemId: 'i1', widthCm: 150 }, defects: [{ defectTypeId: 'leke', sizeClass: 'OVER_9IN', startMeter: 3 }], inspectedLengthM: 90 });
    const own = inspectionDraftReducer(draft, { type: 'setInspectedLength', value: 50 });
    expect(buildPreviewRequest(target, own, 90)?.inspectedLengthM).toBe(50);
    expect(buildPreviewRequest({ rollId: 'r1' }, draft, null)).toMatchObject({ rollId: 'r1' });
  });
});

describe('useInspectionPreview', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    preview.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('400 ms debounce, tek çağrı, sonuç ok', async () => {
    preview.mockResolvedValue({ success: true, data: { pointsPer100M2: '9.8', widthSource: 'ITEM_CARD', suggested: null } });
    const { result } = renderHook(() => useInspectionPreview({ enabled: true, target, draft, lengthM: 90, isOnline: true }));
    expect(result.current.status).toBe('loading');
    act(() => jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1));
    expect(preview).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ok');
    expect(result.current.data?.pointsPer100M2).toBe('9.8');
  });

  it('çevrimdışı → çağrı yok, null', () => {
    const { result } = renderHook(() => useInspectionPreview({ enabled: true, target, draft, lengthM: 90, isOnline: false }));
    act(() => jest.advanceTimersByTime(1000));
    expect(preview).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: 'offline', data: null });
  });

  it('hata → null + error (operatör bugünkü gibi seçer)', async () => {
    preview.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useInspectionPreview({ enabled: true, target, draft, lengthM: 90, isOnline: true }));
    await act(async () => {
      jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    });
    expect(result.current).toEqual({ status: 'error', data: null });
  });

  it('kapalı → çağrı yok', () => {
    const { result } = renderHook(() => useInspectionPreview({ enabled: false, target, draft, lengthM: 90, isOnline: true }));
    act(() => jest.advanceTimersByTime(1000));
    expect(preview).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
