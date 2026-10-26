// Bekçi: başlık zili + istasyon şeridi. Bayrak kapalı → hiçbir şey çizilmez ve uç çağrılmaz; eski backend
// (`/ozet` 404) → çökme yok, zil yok; şerit sunucunun döndürdüğünü AYNEN gösterir (istemci süzmez).
// Sondalar (2026-10-26): şerit `kanalTablet`le istemcide süzdü → 3. test ❌; 404'te zil çizildi → 2. test ❌;
// ikisi de geri alındı (md5 eşit).
import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';
import NotificationBellButton from './NotificationBellButton';
import NotificationStrip from './NotificationStrip';
import { renderWithPaper } from '../../test/render';
import { bildirimApi, STRIP_FILTER } from '../../services/bildirim/bildirimApi';
import { createBellClient, type BellClient } from '../../services/bildirim/bellTransport';
import type { InboxItem } from '../../services/bildirim/types';

let mockFlags: Record<string, unknown> | undefined;
let mockClient: BellClient;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ data: mockFlags, isLoading: false }) }));
jest.mock('../../services/bildirim/bildirimApi', () => ({
  ...jest.requireActual('../../services/bildirim/bildirimApi'),
  bildirimApi: { summary: jest.fn(), list: jest.fn(), wait: jest.fn(() => new Promise(() => {})), markRead: jest.fn(), snooze: jest.fn() },
}));
jest.mock('../../services/bildirim/bellSingleton', () => ({ bellClient: () => mockClient }));

const api = bildirimApi as jest.Mocked<typeof bildirimApi>;
const row = (p: Partial<InboxItem>): InboxItem => ({
  id: 'r1', tur: 'dokuma.levent-bitiyor', sinif: 'BILDIRIM', altTur: 'KOSUL', grup: 'Dokuma', baslik: 'Levent bitiyor', govde: 'T-12 · 2 gün',
  tabletRota: null, konu: { tip: 'x', id: null }, sayac: 1, sonAn: '2026-10-26T08:00:00Z', okunduAn: null, erteleBitis: null, cozulduAn: null, ...p,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = createBellClient({
    summary: () => api.summary(), wait: (p, s) => api.wait(p, s), openStream: async () => ({ status: 404, ok: false, body: null }),
    httpStatus: (e) => (e as { response?: { status?: number } })?.response?.status ?? null, sseEnabled: false,
  });
  api.summary.mockResolvedValue({ enabled: true, okunmamis: 3, alarmAcik: 0, epoch: 1, rev: 0, alarmRev: 0 });
  api.list.mockResolvedValue({ items: [row({})], nextCursor: null, sayi: 3 });
});

afterEach(() => void mockClient.setActive(false));

it('bayrak kapalı → zil ve şerit çizilmez, hiçbir uç çağrılmaz', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: false };
  renderWithPaper(<><NotificationBellButton /><NotificationStrip /></>);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByTestId('zil-dugmesi')).toBeNull();
  expect(screen.queryByTestId('bildirim-serit')).toBeNull();
  expect(api.summary).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
});

it('eski backend (/ozet 404) → zil yok, çökme yok', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: true };
  api.summary.mockRejectedValue({ response: { status: 404 } });
  renderWithPaper(<NotificationBellButton />);
  await waitFor(() => expect(api.summary).toHaveBeenCalled());
  expect(screen.queryByTestId('zil-dugmesi')).toBeNull();
});

it('açık → zil rozetli; şerit sunucu süzgeciyle ister ve dönen satırı AYNEN gösterir', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: true };
  // Eski backend `kanalTablet` göndermese de satır gösterilir: karar sunucu süzgecinde.
  api.list.mockResolvedValue({ items: [row({ kanalTablet: undefined })], nextCursor: null, sayi: 3 });
  renderWithPaper(<><NotificationBellButton /><NotificationStrip /></>);
  expect(await screen.findByTestId('zil-dugmesi')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(await screen.findByTestId('bildirim-serit')).toBeTruthy();
  expect(screen.getByText('Levent bitiyor')).toBeTruthy();
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ tab: 'okunmamis', extra: STRIP_FILTER }));
});
