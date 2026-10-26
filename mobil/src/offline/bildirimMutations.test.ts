// Bekçi: bildirim tercihi kuyruğu. Çevrimdışı iki kayıt → kuyrukta TEK (son) taslak, dönüşte bir kez
// yazılır; operatör değişince eski kişinin taslağı yeni token'la YAZILMAZ.
// Sondalar (2026-10-26): `cache.remove` kaldırıldı → 1. test ❌ (kuyruk ikiledi); kullanıcı kontrolü kaldırıldı
// → 2. test ❌; ikisi de geri alındı (md5 eşit).
import { onlineManager } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { useAuthStore } from '../store/authStore';
import { bildirimApi } from '../services/bildirim/bildirimApi';
import {
  NOTIFICATION_PREF_SAVE, dropQueuedPreferenceSaves, newPreferenceSave, registerNotificationMutationDefaults,
} from './bildirimMutations';

jest.mock('../services/api', () => ({ resolveAuthToken: jest.fn(async () => 'tok'), apiClient: {} }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/bildirim/bildirimApi', () => ({
  bildirimApi: { savePreferences: jest.fn(async () => ({ hucreler: [], satirlar: [] })) },
}));

const save = bildirimApi.savePreferences as jest.Mock;
const enqueue = (userId: string, acik: boolean) => {
  dropQueuedPreferenceSaves(userId);
  return queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: NOTIFICATION_PREF_SAVE as unknown as unknown[] })
    .execute(newPreferenceSave(userId, [{ tur: 'dokuma.levent-bitiyor', kanal: 'TABLET_SES', acik }]))
    .catch(() => undefined);
};

beforeAll(() => registerNotificationMutationDefaults());
afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.getMutationCache().clear();
  jest.clearAllMocks();
});

it('çevrimdışı iki kayıt → kuyrukta tek taslak, dönüşte bir kez ve SON değerle yazılır', async () => {
  useAuthStore.setState({ user: { userId: 'u1', username: 'a', permissions: [] }, token: 'tok' });
  onlineManager.setOnline(false);
  void enqueue('u1', true);
  void enqueue('u1', false);
  await Promise.resolve();
  const queued = queryClient.getMutationCache().findAll({ mutationKey: NOTIFICATION_PREF_SAVE });
  expect(queued).toHaveLength(1);
  expect(save).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
  await queryClient.resumePausedMutations();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toEqual([{ tur: 'dokuma.levent-bitiyor', kanal: 'TABLET_SES', acik: false }]);
});

it('operatör değişti → eski kişinin taslağı yazılmaz', async () => {
  useAuthStore.setState({ user: { userId: 'u1', username: 'a', permissions: [] }, token: 'tok' });
  onlineManager.setOnline(false);
  void enqueue('u1', false);
  await Promise.resolve();
  useAuthStore.setState({ user: { userId: 'u2', username: 'b', permissions: [] }, token: 'tok2' });
  onlineManager.setOnline(true);
  await queryClient.resumePausedMutations();
  expect(save).not.toHaveBeenCalled();
});
