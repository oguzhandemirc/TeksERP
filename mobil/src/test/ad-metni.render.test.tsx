// Saha ekranlarında 60+ karakterlik ad TEK SATIR kalır (numberOfLines 1 + tail),
// erişilebilirlik etiketi tam addır, kısaldığında basılı tutunca tam ad balonda;
// satırın kendi tek dokunuşu (detay aç / seç) korunur.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from './render';
import { UZUN_AD, expectSingleLineName, longPress, measureLines } from './truncatedText';
import { alarmItem, T0 } from './loomAlarmFixture';
import { useSessionStore } from '../store/sessionStore';
import PlaceChip from '../components/session/PlaceChip';
import AlarmListPane from '../screens/Modules/Uyarilar/AlarmListPane';
import DispatchRow from '../components/dispatch/DispatchRow';
import PickerModal from '../components/PickerModal';
import WorkOrderListView from '../screens/Modules/HizliIsEmri/WorkOrderListView';
import { workOrderService } from '../services/workOrder.service';
import type { Roll, SubcontractorDispatchListItem, WorkOrder } from '../types/models';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ name: 'Dokuma' }),
}));
jest.mock('../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [null, jest.fn()] }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('../services/workOrder.service', () => ({ workOrderService: { getAllCursor: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RollListItem } = require('../screens/Modules/KK1/KK1Screen') as typeof import('../screens/Modules/KK1/KK1Screen');

async function expectBalloon(testID: string) {
  await measureLines(testID, 3);
  longPress(testID);
  expect(screen.getByTestId('tam-ad-balonu')).toBeTruthy();
}

describe('uzun ad — saha ekranları', () => {
  afterEach(() => useSessionStore.setState({ active: null }));

  it('Dokuma tezgah ekranı: başlıktaki tezgah adı çipi tek satır; dokununca tam ad', async () => {
    useSessionStore.setState({
      active: { station: { kind: 'WEAVING', name: 'Dokuma' }, machine: { name: UZUN_AD, code: 'TZ-7' } } as never,
    });
    renderWithPaper(<PlaceChip />);
    expectSingleLineName('yer-cipi', UZUN_AD);
    await expectBalloon('yer-cipi');
  });

  it('Uyarılar listesi: tezgah · salon tek satır; uzun basınca balon, tek dokunuş detayı açar', async () => {
    const onOpen = jest.fn();
    const a = alarmItem({ machine: { id: 'm-1', code: 'TZ-12', name: 'T', hallId: 'h', hallName: UZUN_AD } });
    renderWithPaper(
      <AlarmListPane loading={false} problemText={null} showAll={false} selectedId={null} now={T0} items={[a]} audience="mine" onShowAll={jest.fn()} onOpen={onOpen} />,
    );
    const id = `alarm-tezgah-${a.id}`;
    expectSingleLineName(id, `TZ-12 · ${UZUN_AD}`);
    await expectBalloon(id);
    fireEvent.press(screen.getByLabelText('Tam adı kapat'));
    fireEvent.press(screen.getByTestId(id));
    expect(onOpen).toHaveBeenCalledWith(a.id);
  });

  it('KK1 son girişler: ürün · renk ve istasyon tek satır (2 satıra sarmaz)', async () => {
    const roll = {
      id: 'r-1', barcode: 'B-1', initialQty: 10, item: { name: UZUN_AD }, color: { name: 'Kırmızı' },
      entryStation: { name: UZUN_AD }, createdBy: { fullName: 'Ali' }, createdAt: new Date(T0).toISOString(), status: 'RAW',
    } as unknown as Roll;
    for (const singleLine of [true, false]) {
      const r = renderWithPaper(<RollListItem roll={roll} onPrint={jest.fn()} singleLine={singleLine} />);
      expectSingleLineName('kk1-son-ad-r-1', `${UZUN_AD} · Kırmızı`);
      expect(screen.getAllByLabelText(UZUN_AD).every((n) => n.props.numberOfLines === 1)).toBe(true);
      r.unmount();
    }
    renderWithPaper(<RollListItem roll={roll} onPrint={jest.fn()} singleLine />);
    await expectBalloon('kk1-son-ad-r-1');
  });

  it('Fason sevk geçmişi satırı: fasoncu adı tek satır; tek dokunuş satırı açar', async () => {
    const onToggle = jest.fn();
    const d = {
      id: 'd-1', dispatchNo: 'FS-1', dispatchedAt: new Date(T0).toISOString(), subcontractor: { name: UZUN_AD },
      workOrder: { workOrderNumber: 'IE-1' }, _count: { items: 2 }, totalQty: 12, cancelledAt: null,
    } as unknown as SubcontractorDispatchListItem;
    renderWithPaper(<DispatchRow dispatch={d} expanded={false} onToggleExpand={onToggle} onCancel={jest.fn()} />);
    expectSingleLineName('fason-firma-d-1', UZUN_AD);
    await expectBalloon('fason-firma-d-1');
    fireEvent.press(screen.getByLabelText('Tam adı kapat'));
    fireEvent.press(screen.getByTestId('fason-firma-d-1'));
    expect(onToggle).toHaveBeenCalledWith('d-1');
  });

  it('Seçici modal: seçenek adı tek satır; uzun basınca balon, tek dokunuş seçer', async () => {
    const onSelect = jest.fn();
    renderWithPaper(<PickerModal visible title="Desen Seç" options={[{ value: 'x', label: UZUN_AD }]} onSelect={onSelect} onDismiss={jest.fn()} />);
    expectSingleLineName('secici-secenek-x', UZUN_AD);
    await expectBalloon('secici-secenek-x');
    fireEvent.press(screen.getByLabelText('Tam adı kapat'));
    fireEvent.press(screen.getByTestId('secici-secenek-x'));
    expect(onSelect).toHaveBeenCalledWith('x');
  });

  it('Terbiye iş emri listesi: ürün · renk tek satır', async () => {
    const wo = { id: 'w-1', workOrderNumber: 'IE-9', status: 'OPEN', targetItem: { name: UZUN_AD }, targetColor: { name: 'Lacivert' }, batches: [], createdAt: new Date(T0).toISOString() } as unknown as WorkOrder;
    jest.mocked(workOrderService.getAllCursor).mockResolvedValue({ data: [wo], pagination: { hasMore: false, nextCursor: null, totalEstimate: 1 } } as never);
    const onOpen = jest.fn();
    renderWithPaper(<WorkOrderListView onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByTestId('is-emri-urun-w-1')).toBeTruthy());
    expectSingleLineName('is-emri-urun-w-1', `${UZUN_AD} · Lacivert`);
    await expectBalloon('is-emri-urun-w-1');
  });
});
