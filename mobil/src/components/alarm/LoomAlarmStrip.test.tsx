// Tezgah şeridi: yalnız bu tezgahın alarmını ister (makine süzgeci, "tümü" kapsamı); "Üstlendim"
// yalnız eylem izni olanda çizilir; erişim yoksa istek açılmaz; yeni alarm bir kez çalar.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import { alarmItem } from '../../test/loomAlarmFixture';
import { alarmSeen } from '../../lib/loomAlarm/seen';
import LoomAlarmStrip from './LoomAlarmStrip';

const mockFeed = jest.fn();
let mockAccess = { canView: false, canAct: false, canSeeLoomStrip: true, renotifyMinutes: 10 };
let mockItems = [alarmItem()];
jest.mock('../../hooks/useLoomAlarms', () => ({
  useLoomAlarmAccess: () => mockAccess,
  useLoomAlarmFeed: (p: unknown) => {
    mockFeed(p);
    return { data: { items: mockItems, audience: 'all' }, dataUpdatedAt: 1 };
  },
  useNow: () => Date.parse('2026-10-11T08:00:00.000Z'),
}));
const mockAck = jest.fn(() => Promise.resolve(true));
jest.mock('../../hooks/useLoomAlarmActions', () => ({ useLoomAlarmActions: () => ({ busy: null, ack: mockAck }) }));
const mockSignal = jest.fn();
jest.mock('../../services/alarmFeedback', () => ({ signalLoomAlarm: (t: number) => mockSignal(t) }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

describe('LoomAlarmStrip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    alarmSeen.clear();
    mockItems = [alarmItem()];
    mockAccess = { canView: false, canAct: false, canSeeLoomStrip: true, renotifyMinutes: 10 };
  });

  it('makine süzgeciyle, sorumlu süzgeci olmadan ister', () => {
    renderWithPaper(<LoomAlarmStrip machineId="m-1" />);
    expect(mockFeed).toHaveBeenCalledWith({ enabled: true, mine: false, machineId: 'm-1' });
  });

  it('makine yoksa ya da erişim yoksa istek kapalı', () => {
    renderWithPaper(<LoomAlarmStrip machineId={null} />);
    expect(mockFeed).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    mockAccess = { ...mockAccess, canSeeLoomStrip: false };
    renderWithPaper(<LoomAlarmStrip machineId="m-1" />);
    expect(mockFeed).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('yalnız dokuma izni: alarm görünür, Üstlendim ve Aç çizilmez; bir kez çalar', () => {
    const r = renderWithPaper(<LoomAlarmStrip machineId="m-1" />);
    expect(r.getByText('TZ-12 · İp atlama · Kademe 1')).toBeTruthy();
    expect(r.queryByText('Üstlendim')).toBeNull();
    expect(r.queryByText('Aç')).toBeNull();
    expect(mockSignal).toHaveBeenCalledTimes(1);
    r.rerender(<LoomAlarmStrip machineId="m-1" />);
    expect(mockSignal).toHaveBeenCalledTimes(1);
  });

  it('eylem izniyle Üstlendim → ack; Kapat şeridi gizler', () => {
    mockAccess = { canView: true, canAct: true, canSeeLoomStrip: true, renotifyMinutes: 10 };
    const r = renderWithPaper(<LoomAlarmStrip machineId="m-1" />);
    fireEvent.press(r.getByText('Üstlendim'));
    expect(mockAck).toHaveBeenCalled();
    fireEvent.press(r.getByText('Aç'));
    expect(mockNavigate).toHaveBeenCalledWith('UyariDetay', { alarmId: alarmItem().id });
    fireEvent.press(r.getByText('Kapat'));
    expect(r.queryByText('Üstlendim')).toBeNull();
  });

  it('üstlenilmiş alarm şeritte öne çıkmaz', () => {
    mockItems = [alarmItem({ state: 'ACKED', ackedBy: { id: 'u', name: 'Ahmet' } })];
    const r = renderWithPaper(<LoomAlarmStrip machineId="m-1" />);
    expect(r.queryByText(/TZ-12/)).toBeNull();
  });
});
