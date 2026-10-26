// Bekçi: Ayarlar → Bildirim tercihleri. Bayrak kapalı → uç hiç çağrılmaz; eski sunucu (404) → "bu sürümde
// yok", çökme yok; kilitli tür uygulamada kapatılamaz; kayıt TAM gövdeyi (panel kanalları dahil) gönderir.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import NotificationPreferencesScreen from './NotificationPreferencesScreen';
import { renderWithPaper } from '../../../test/render';
import { bildirimApi } from '../../../services/bildirim/bildirimApi';
import { buildPreferenceBody } from '../../../lib/bildirim/preferenceDraft';
import type { PreferencesResponse } from '../../../services/bildirim/types';

let mockFlags: Record<string, unknown> | undefined;
const mockMutate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ data: mockFlags, isLoading: false }) }));
jest.mock('../../../services/bildirim/bildirimApi', () => ({
  ...jest.requireActual('../../../services/bildirim/bildirimApi'),
  bildirimApi: { catalog: jest.fn(), preferences: jest.fn() },
}));
jest.mock('../../../store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { userId: 'u1' } }) }));
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return { ...actual, useMutation: () => ({ mutate: mockMutate, isPending: false, isPaused: false, error: null }) };
});

const api = bildirimApi as jest.Mocked<typeof bildirimApi>;
const PREFS: PreferencesResponse = {
  hucreler: [
    { kind: 'dokuma.levent-bitiyor', kanallar: [
      { kanal: 'UYGULAMA', durum: 'ACIK', kilit: false, kaynak: 'katalog', kapsam: null },
      { kanal: 'TABLET_SES', durum: 'ACIK', kilit: false, kaynak: 'katalog', kapsam: null },
      { kanal: 'MASAUSTU', durum: 'KAPALI', kilit: false, kaynak: 'katalog', kapsam: null },
    ] },
    { kind: 'sistem.yedek-basarisiz', kanallar: [{ kanal: 'UYGULAMA', durum: 'ACIK', kilit: true, kaynak: 'katalog', kapsam: null }] },
  ],
  satirlar: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.catalog.mockResolvedValue([
    { kod: 'dokuma.levent-bitiyor', ad: 'Levent bitiyor', sinif: 'BILDIRIM', grup: 'Dokuma', kilit: 'YOK', kilitGerekcesi: null, kanallar: ['UYGULAMA', 'TABLET_SES', 'MASAUSTU'] },
    { kod: 'sistem.yedek-basarisiz', ad: 'Yedek alınamadı', sinif: 'BILDIRIM', grup: 'Sistem', kilit: 'HER_ZAMAN', kilitGerekcesi: 'Veri kaybı riski', kanallar: ['UYGULAMA'] },
  ]);
  api.preferences.mockResolvedValue(PREFS);
});

it('bayrak kapalı → kapalı metni, uç çağrılmaz', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: false };
  renderWithPaper(<NotificationPreferencesScreen />);
  expect(await screen.findByText(/bu kurulumda kapalı/)).toBeTruthy();
  expect(api.preferences).not.toHaveBeenCalled();
});

it('eski sunucu (404) → "bu sürümünde yok", çökme yok', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: true };
  api.preferences.mockRejectedValue({ response: { status: 404 } });
  renderWithPaper(<NotificationPreferencesScreen />);
  expect(await screen.findByText(/bu sürümünde bildirim tercihleri yok/)).toBeTruthy();
});

it('kilitli tür: nedeni yazılı, uygulama anahtarı pasif; değişiklik tam gövdeyle kuyruğa gider', async () => {
  mockFlags = { bildirimGelenKutusuEnabled: true };
  renderWithPaper(<NotificationPreferencesScreen />);
  expect(await screen.findByText('Veri kaybı riski')).toBeTruthy();
  expect(screen.getByLabelText('Yedek alınamadı — Uygulamada').props.accessibilityState).toEqual({ checked: true, disabled: true });
  expect(screen.getByLabelText('Levent bitiyor — Uygulamada').props.disabled).toBe(false);
  fireEvent(screen.getByLabelText('Levent bitiyor — Tablet sesi'), 'valueChange', false);
  fireEvent.press(screen.getByTestId('bildirim-tercih-kaydet'));
  await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
  const vars = mockMutate.mock.calls[0][0];
  expect(vars.userId).toBe('u1');
  expect(vars.tercihler).toEqual(buildPreferenceBody(PREFS, new Map([['dokuma.levent-bitiyor|TABLET_SES', false]])));
  expect(vars.tercihler).toContainEqual({ tur: 'dokuma.levent-bitiyor', kanal: 'MASAUSTU', acik: false });
});
