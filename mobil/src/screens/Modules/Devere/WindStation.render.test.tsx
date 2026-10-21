// =============================================================================
// SAR istasyonu — render: sol form + sağ okutma bandı GERÇEK hook'la (mutasyonlar sahte)
// =============================================================================
//   §1 planlı levent varsa ana düğme "SAR — <levent no>"; kg boşken SAR → hata satırı, mutasyon yok
//   §2 nominal seçilince hesap görünür ve SAR sarım mutasyonunu çağırır (iplik kg = nominal)
//   §3 okutma bandı: elle yazılan levent no hedefi değiştirir (ana düğme etiketi izler)
//   §4 planlı yok → "PLANLA + SAR" + gövde no alanı; çevrimdışı → gerekçe, düğme kilitli
// =============================================================================
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { NumpadHost, NumpadProvider } from '../../../components/NumpadProvider';
import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import type { TabletContext, WarpBeam } from '../../../services/warpBeam.service';
import { useWindStation } from './useWindStation';
import WindStationForm from './WindStationForm';
import WindScanColumn from './WindScanColumn';

const mockPlan = { mutate: jest.fn(), isPending: false };
const mockWind = { mutate: jest.fn(), isPending: false };
jest.mock('./useBeamMutations', () => ({ useBeamMutations: () => ({ plan: mockPlan, wind: mockWind }) }));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../hooks/useTruncationWarning', () => ({ useTruncationWarning: () => undefined }));

const ctx = {
  warpSpecs: [{ id: 's1', code: 'CZ-1', name: 'Siyah', endsCount: 4000, denier: 150 }],
  machines: [{ id: 'm1', code: 'D1', name: 'Devere 1', stationName: 'Devere' }],
  warehouses: [{ id: 'w1', name: 'İplik', isDefault: true }],
  subcontractors: [],
  suppliers: [],
} as unknown as TabletContext;

function beam(id: string, over: Partial<WarpBeam> = {}): WarpBeam {
  return { id, beamNo: `LV-${id}`, status: 'PLANNED', plannedLengthM: 1000, physicalBeamNo: null, notes: null, originKind: 'IN_HOUSE', warpSpec: { id: 's1', code: 'CZ-1', name: 'Siyah', endsCount: 4000, yarnItem: { id: 'y', code: 'Y', name: 'Y', linearDensityDen: 150 } }, subcontractor: null, supplier: null, wound: null, remainingM: 0, createdAt: '2026-10-20T08:00:00Z', ...over } as WarpBeam;
}

function Harness({ planned, isOnline = true }: { planned: WarpBeam[]; isOnline?: boolean }) {
  const station = useWindStation({ context: ctx, planned, recent: [], isOnline });
  return (
    <NumpadProvider>
      <WindStationForm station={station} context={ctx} isOnline={isOnline} busyBeams={[]} knownBeams={planned} />
      <WindScanColumn station={station} />
      <NumpadHost />
    </NumpadProvider>
  );
}

beforeEach(() => {
  mockPlan.mutate.mockReset();
  mockWind.mutate.mockReset();
  useDeviceSettingsStore.setState({ manualBarcodeEntry: true });
});

it('§1 planlı levent → "SAR — LV-p1"; kg boşken SAR hata yazar, mutasyon yok', async () => {
  const r = renderWithPaper(<Harness planned={[beam('p1')]} />);
  await act(async () => {});
  fireEvent.press(r.getByLabelText('SAR — LV-p1'));
  expect(r.getByText('Tartı kg 0’dan büyük olmalı.')).toBeTruthy();
  expect(mockWind.mutate).not.toHaveBeenCalled();
});

it('§2 nominal: hesap görünür, SAR sarım mutasyonunu nominal kg ile çağırır', async () => {
  const r = renderWithPaper(<Harness planned={[beam('p1')]} />);
  await act(async () => {});
  fireEvent.press(r.getByText('Nominal (hesap)'));
  expect(r.getByTestId('sar-nominal-kg')).toHaveTextContent('Nominal — kg', { exact: false });
  fireEvent.press(r.getByText('Planlı LV-p1 · 1000 m'));
  await act(async () => {});
  // metre boş → önce hata; okutma levent no'yu seçince metre plandan dolar
  fireEvent.changeText(r.getByPlaceholderText('Levent no ya da gövde no okut/yaz…'), 'lv-p1');
  fireEvent(r.getByPlaceholderText('Levent no ya da gövde no okut/yaz…'), 'submitEditing');
  expect(r.getByTestId('sar-nominal-kg')).toHaveTextContent('Nominal 66.667 kg', { exact: false });
  fireEvent.press(r.getByLabelText('SAR — LV-p1'));
  expect(mockWind.mutate).toHaveBeenCalledTimes(1);
  expect(mockWind.mutate.mock.calls[0][0]).toMatchObject({ beamId: 'p1', form: { kgSource: 'THEORETICAL', issues: [{ qtyKg: '66.667' }] } });
});

it('§3 okutma hedefi değiştirir', async () => {
  const r = renderWithPaper(<Harness planned={[beam('p1'), beam('p2', { createdAt: '2026-10-21T00:00:00Z' })]} />);
  await act(async () => {});
  expect(r.getByLabelText('SAR — LV-p1')).toBeTruthy();
  fireEvent.changeText(r.getByPlaceholderText('Levent no ya da gövde no okut/yaz…'), 'LV-p2');
  fireEvent(r.getByPlaceholderText('Levent no ya da gövde no okut/yaz…'), 'submitEditing');
  expect(r.getByLabelText('SAR — LV-p2')).toBeTruthy();
});

it('§4 planlı yok → PLANLA + SAR ve gövde alanı; çevrimdışı gerekçe', async () => {
  const r = renderWithPaper(<Harness planned={[]} isOnline={false} />);
  await act(async () => {});
  expect(r.getByLabelText('PLANLA + SAR')).toBeTruthy();
  expect(r.getByText('Gövde no (okutun ya da yazın)')).toBeTruthy();
  expect(r.getByText('Bağlantı yok — sarım yalnız çevrimiçi (levent no sunucuda doğar).')).toBeTruthy();
});
