// Devere Dönüş Kabulü — A6 levent kartı (S5t): ayar aynası OFF/ASK/ALWAYS + belge başına tek otomatik basım.
import { act, renderHook } from '@testing-library/react-native';
import type { ReceiveDocResult } from '../../../services/devereKabul.service';
import { printWarpBeamCards } from '../../../services/warpBeamCardPrint';
import { normalizeAutoPrint, resultBeamTargets, useBeamCardPrint, type BeamCardAutoPrint } from './useBeamCardPrint';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/warpBeamCardPrint', () => ({ printWarpBeamCards: jest.fn() }));
const printMock = printWarpBeamCards as jest.MockedFunction<typeof printWarpBeamCards>;

const doc = (docNo: string) => ({
  docNo,
  totals: { beamCount: 2, lengthM: '2960' },
  orders: [
    { warpingOrderId: 'o1', orderNo: 'FDV-1', receipt: { beams: [{ id: 'wb1', beamNo: 'LV-7', physicalBeamNo: null, lengthM: '1480' }] } },
    { warpingOrderId: 'o2', orderNo: 'FDV-2', receipt: { beams: [{ id: 'wb2', beamNo: 'LV-8', physicalBeamNo: null, lengthM: '1480' }] } },
  ],
}) as unknown as ReceiveDocResult;

beforeEach(() => {
  printMock.mockReset();
  printMock.mockResolvedValue({ printed: 2, cancelled: false, failed: [] });
});

describe('normalizeAutoPrint / resultBeamTargets', () => {
  it('eski sunucu (alan yok) ya da tanınmayan değer → OFF', () => {
    expect(normalizeAutoPrint(undefined)).toBe('OFF');
    expect(normalizeAutoPrint('BAZEN')).toBe('OFF');
    expect(normalizeAutoPrint('ASK')).toBe('ASK');
    expect(normalizeAutoPrint('ALWAYS')).toBe('ALWAYS');
  });
  it('bütün siparişlerin leventleri belge sırasıyla', () => {
    expect(resultBeamTargets(doc('DK-1'))).toEqual([{ id: 'wb1', beamNo: 'LV-7' }, { id: 'wb2', beamNo: 'LV-8' }]);
    expect(resultBeamTargets(null)).toEqual([]);
  });
});

describe('useBeamCardPrint', () => {
  const mount = (result: ReceiveDocResult | null, mode: BeamCardAutoPrint) =>
    renderHook(({ r, m }: { r: ReceiveDocResult | null; m: BeamCardAutoPrint }) => useBeamCardPrint(r, m), { initialProps: { r: result, m: mode } });

  it('OFF: kabulden sonra kendiliğinden basmaz, soru da sormaz (bugünkü davranış)', async () => {
    const h = mount(doc('DK-1'), 'OFF');
    await act(async () => {});
    expect(printMock).not.toHaveBeenCalled();
    expect(h.result.current.ask).toBe(false);
  });

  it('ASK: soru açık; elle basınca söner', async () => {
    const h = mount(doc('DK-1'), 'ASK');
    await act(async () => {});
    expect(printMock).not.toHaveBeenCalled();
    expect(h.result.current.ask).toBe(true);
    await act(async () => { h.result.current.print(); });
    expect(printMock).toHaveBeenCalledTimes(1);
    expect(h.result.current.ask).toBe(false);
    expect(h.result.current.printed).toBe(true);
  });

  it('ALWAYS: belge başına BİR KEZ basar; yeniden çizim tekrar açmaz, yeni belge yeniden basar', async () => {
    const r1 = doc('DK-1');
    const h = mount(r1, 'ALWAYS');
    await act(async () => {});
    expect(printMock).toHaveBeenCalledTimes(1);
    h.rerender({ r: { ...r1 }, m: 'ALWAYS' });
    await act(async () => {});
    expect(printMock).toHaveBeenCalledTimes(1);
    h.rerender({ r: doc('DK-2'), m: 'ALWAYS' });
    await act(async () => {});
    expect(printMock).toHaveBeenCalledTimes(2);
  });

  it('pencere iptal edilirse "basıldı" sayılmaz (ASK sorusu kalır)', async () => {
    printMock.mockResolvedValue({ printed: 0, cancelled: true, failed: [] });
    const h = mount(doc('DK-1'), 'ASK');
    await act(async () => { h.result.current.print(); });
    expect(h.result.current.printed).toBe(false);
    expect(h.result.current.ask).toBe(true);
  });
});
