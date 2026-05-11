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

const fromExtra = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.apiUrl;
const devHost = __DEV__ ? getDevHost() : null;

export const API_URL = devHost
  ? `http://${devHost}:${BACKEND_PORT}/api`
  : typeof fromExtra === 'string'
    ? fromExtra
    : `http://192.168.1.105:${BACKEND_PORT}/api`;

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
