// =============================================================================
// LoomBirthBar — render: GERÇEK hook (`useLoomBirth`) + sahte bağlam ucu
// =============================================================================
//   §1 etiket yaz/okut → şerit "tezgah · iş · kumaş"; levent değiştiyse iki çip, "Eski" seçilebilir
//   §2 KK1_LABEL_ONLY → "Çalışan iş seç" YOK; KK1_LABEL_OR_ORDER → var
// =============================================================================
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import type { DokumaRollBirth } from '../../../services/featureFlag.service';
import type { Kk1Context } from '../../../types/models';
import { doffService } from '../../../services/doff.service';
import { useLoomBirth, type LoomBirthApi } from './useLoomBirth';
import LoomBirthBar from './LoomBirthBar';

jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../hooks/useTruncationWarning', () => ({ useTruncationWarning: () => undefined }));
jest.mock('../../../services/doff.service', () => ({ doffService: { kk1Context: jest.fn() } }));
jest.mock('../../../services/weavingOrder.service', () => ({ weavingOrderService: { listOpen: jest.fn().mockResolvedValue([]) } }));

const ctx: Kk1Context = {
  machine: { id: 'm7', code: 'T-07', name: 'Tezgah 7', productionLineCount: 1 },
  run: { id: 'r1', productionLineNo: 1, startedAt: '2026-10-21T05:00:00Z', weavingOrder: { id: 'wo1', weavingOrderNumber: 'DK261021-0003' }, item: { id: 'i1', code: 'KR', name: 'KRİSTAL' }, color: null, warpSpec: null },
  beams: { mounted: [{ id: 'b9', beamNo: 'LV-09', position: 1, remainingM: 412 }], recentChange: { at: '2026-10-21T04:00:00Z', dismounted: { id: 'b7', beamNo: 'LV-07' }, mounted: { id: 'b9', beamNo: 'LV-09' } } },
  rollBirth: 'KK1_LABEL_OR_ORDER',
};

let latest: LoomBirthApi | null = null;
function Harness({ rollBirth }: { rollBirth: DokumaRollBirth }) {
  const loom = useLoomBirth({ visible: true, rollBirth, isOnline: true, onPrefillItem: () => {} });
  latest = loom;
  return <LoomBirthBar loom={loom} rollBirth={rollBirth} />;
}

beforeEach(() => {
  useDeviceSettingsStore.setState({ manualBarcodeEntry: true });
  (doffService.kk1Context as jest.Mock).mockResolvedValue({ success: true, data: ctx });
});

it('§1 ⭐ okut → bağlam şeridi; levent değişti → "Eski levent" seçilir', async () => {
  const r = renderWithPaper(<Harness rollBirth="KK1_LABEL_OR_ORDER" />);
  await act(async () => {});
  expect(r.getByText('Etiket okutulmazsa top dışarıdan gelmiş sayılır.')).toBeTruthy();
  fireEvent.changeText(r.getByPlaceholderText('Tezgah etiketi okut/yaz…'), 't-07');
  await act(async () => {
    fireEvent(r.getByPlaceholderText('Tezgah etiketi okut/yaz…'), 'submitEditing');
  });
  expect(r.getByText('T-07 · DK261021-0003 · KRİSTAL · LV-09 kalan 412 m')).toBeTruthy();
  fireEvent.press(r.getByTestId('beam-old'));
  expect(latest?.state.beamChoice).toBe('old');
  expect(r.getByTestId('loom-order-ac')).toBeTruthy();
});

it('§2 KK1_LABEL_ONLY → iş seçimi çizilmez', async () => {
  const r = renderWithPaper(<Harness rollBirth="KK1_LABEL_ONLY" />);
  await act(async () => {});
  expect(r.queryByTestId('loom-order-ac')).toBeNull();
});
