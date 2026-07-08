import Constants from 'expo-constants';

const BACKEND_PORT = 4000;

function getDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

const envApiUrl = process.env.EXPO_PUBLIC_API_URL;
const devHost = __DEV__ ? getDevHost() : null;

export const API_URL = devHost
  ? `http://${devHost}:${BACKEND_PORT}/api`
  : envApiUrl ?? `http://localhost:${BACKEND_PORT}/api`;

/** Ekranı bekleten bootstrap GET'lerinin timeout'u (login ekranı verileri,
 *  work-sessions/current). Global 10sn mutasyonlar için kalır; kullanıcının
 *  boş ekrana baktığı isteklerde 5sn'den fazlası "donma" olarak algılanır —
 *  SWR cache'i + arka plan tazeleme zaten devrede (SAHA-AG-DAYANIKLILIK.md §S2). */
export const BOOTSTRAP_TIMEOUT_MS = 5_000;

export const ENDPOINTS = {
  auth: {
    login: '/auth/login',
    me: '/auth/me',
  },
  workOrders: '/work-orders',
  rolls: '/rolls',
  stations: '/stations',
  travelerCards: '/traveler-cards',
  production: '/production',
  subcontractor: '/subcontractor',
  packaging: '/packaging',
  shipping: '/shipping',
  tambur: '/tambur',
};
