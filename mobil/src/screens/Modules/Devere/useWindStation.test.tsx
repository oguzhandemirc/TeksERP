// =============================================================================
// useWindStation — plan→sar zinciri ve okutma geri bildirimi
// =============================================================================
//   §1 bağlam gelince form kurulur: son levent kartı + tek makine ön-dolu
//   §2 ⭐ planlı yok → plan, plan OK → sar; sar düşer → tekrar SAR AYNI leventi sarar (ikinci plan YOK)
//   §3 planlı levent varsa doğrudan sar; OK → form ölçümleri temizlenir (etiket kuyruğu useBeamMutations'ta)
//   §4 okutma: levent no → accept + hedef; sarılmış levent → reject + mesaj
//   §5 çevrimdışı → mutasyon çağrılmaz, gerekçe yazılır
// =============================================================================
import { act, renderHook } from '@testing-library/react-native';
import type { TabletContext, WarpBeam } from '../../../services/warpBeam.service';
import { useWindStation } from './useWindStation';

const mockPlan = { mutate: jest.fn(), isPending: false };
const mockWind = { mutate: jest.fn(), isPending: false };
jest.mock('./useBeamMutations', () => ({ useBeamMutations: () => ({ plan: mockPlan, wind: mockWind }) }));
const mockSignalScan = jest.fn();
jest.mock('../../../services/scanFeedback', () => ({ signalScan: (o: string) => mockSignalScan(o) }));

const ctx = {
  warpSpecs: [
    { id: 's1', code: 'CZ-1', name: 'Siyah', endsCount: 4000, denier: 150 },
    { id: 's2', code: 'CZ-2', name: 'Beyaz', endsCount: 3000, denier: 150 },
  ],
  machines: [{ id: 'm1', code: 'D1', name: 'Devere 1', stationName: 'Devere' }],
  warehouses: [{ id: 'w1', name: 'İplik', isDefault: true }],
  subcontractors: [],
  suppliers: [],
} as unknown as TabletContext;

function beam(id: string, over: Partial<WarpBeam> = {}): WarpBeam {
  return { id, beamNo: `LV-${id}`, status: 'PLANNED', plannedLengthM: 900, physicalBeamNo: null, notes: null, originKind: 'IN_HOUSE', warpSpec: { id: 's2', code: 'CZ-2', name: 'Beyaz', endsCount: 3000, yarnItem: { id: 'y', code: 'Y', name: 'Y', linearDensityDen: 150 } }, subcontractor: null, supplier: null, wound: null, remainingM: 0, createdAt: '2026-10-20T08:00:00Z', ...over } as WarpBeam;
}

function setup(planned: WarpBeam[] = [], recent: WarpBeam[] = [], isOnline = true) {
  return renderHook(() => useWindStation({ context: ctx, planned, recent, isOnline }));
}

beforeEach(() => {
  mockPlan.mutate.mockReset();
  mockWind.mutate.mockReset();
  mockSignalScan.mockReset();
});

it('§1 form kurulur: son levent kartı + tek makine', () => {
  const h = setup([], [beam('r1', { status: 'READY' })]);
  expect(h.result.current.form).toMatchObject({ warpSpecId: 's2', machineId: 'm1', target: { kind: 'auto' } });
});

it('§2 ⭐ plan → sar; sar düşünce tekrar SAR aynı leventi sarar', () => {
  const h = setup();
  act(() => h.result.current.selectSpec('s1'));
  act(() => h.result.current.patch({ lengthM: '1000', weighedKg: '70', physicalBeamNo: 'G-1' }));
  act(() => h.result.current.submit());
  expect(mockPlan.mutate).toHaveBeenCalledTimes(1);
  expect(mockPlan.mutate.mock.calls[0][0].form).toMatchObject({ warpSpecId: 's1', plannedLengthM: '1000', originKind: 'IN_HOUSE', physicalBeamNo: 'G-1' });
  act(() => {
    mockPlan.mutate.mock.calls[0][1].onSuccess({ data: beam('nb', { beamNo: 'LV-9', warpSpec: { ...beam('x').warpSpec, id: 's1' } }) });
  });
  expect(mockWind.mutate).toHaveBeenCalledTimes(1);
  expect(mockWind.mutate.mock.calls[0][0]).toMatchObject({ beamId: 'nb', originKind: 'IN_HOUSE' });
  // sar düştü (onSuccess çağrılmadı) → tekrar
  act(() => h.result.current.submit());
  expect(mockPlan.mutate).toHaveBeenCalledTimes(1);
  expect(mockWind.mutate).toHaveBeenCalledTimes(2);
  expect(mockWind.mutate.mock.calls[1][0].beamId).toBe('nb');
});

it('§3 planlı levent → doğrudan sar; OK → ölçüm temizlenir, hedef yeniden otomatik', () => {
  const h = setup([beam('p1')]);
  act(() => h.result.current.patch({ lengthM: '900', weighedKg: '50' }));
  expect(h.result.current.target?.id).toBe('p1');
  act(() => h.result.current.submit());
  expect(mockPlan.mutate).not.toHaveBeenCalled();
  expect(mockWind.mutate.mock.calls[0][0].form.issues[0].qtyKg).toBe('50');
  act(() => {
    mockWind.mutate.mock.calls[0][1].onSuccess({ data: { id: 'p1', beamNo: 'LV-p1', siblings: [] } });
  });
  expect(h.result.current.form?.weighedKg).toBe('');
  expect(h.result.current.target).toBeNull();
});

it('§4 okutma: levent no kabul, sarılmış levent ret', () => {
  const h = setup([beam('p1'), beam('p2', { createdAt: '2026-10-21T00:00:00Z' })], [beam('r1', { status: 'READY' })]);
  act(() => h.result.current.submitScan('lv-p2'));
  expect(mockSignalScan).toHaveBeenLastCalledWith('accept');
  expect(h.result.current.target?.id).toBe('p2');
  act(() => h.result.current.submitScan('LV-r1'));
  expect(mockSignalScan).toHaveBeenLastCalledWith('reject');
  expect(h.result.current.scanMessage).toContain('yeniden sarılamaz');
});

it('§5 çevrimdışı → mutasyon yok, gerekçe', () => {
  const h = setup([beam('p1')], [], false);
  act(() => h.result.current.patch({ lengthM: '900', weighedKg: '50' }));
  act(() => h.result.current.submit());
  expect(mockWind.mutate).not.toHaveBeenCalled();
  expect(h.result.current.error).toContain('çevrimiçi');
});
