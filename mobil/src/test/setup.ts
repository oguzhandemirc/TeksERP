// Mobil jest global setup. RNTL matcher'ları (v13) built-in.
// Native modül mock'ları — store/storage import zinciri testte native köprü çekmesin.

import { onlineManager } from "@tanstack/react-query";

// AsyncStorage resmi jest mock'u (in-memory).
jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-secure-store — testte no-op (token/secret okuma yazma).
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// NetInfo — onlineManager wire'ı (queryClient.ts) modül yükünde gerçek native
// reachability döngüsünü tetikler; testte köprü yok → no-op listener mock'u.
// Offline durumu testlerde onlineManager.setOnline ile zorlanır, NetInfo'dan değil.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()), // unsubscribe fn döner
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    configure: jest.fn(),
  },
}));

// Reanimated test ortamında uyarı basmasın — mock'u yükle (varsa).
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-reanimated").setUpTests?.();
} catch {
  // reanimated mock yoksa sorun değil — saf-logic testleri etkilenmez.
}

// queryClient.ts modül yükünde onlineManager→NetInfo aboneliği açar ve hiç
// kapatılmaz → jest "worker process failed to exit gracefully / force exited"
// uyarısı (açık handle). Tüm testler bitince no-op listener'a geçmek önceki
// (NetInfo) cleanup'ını tetikler → açık handle kalmaz, süreç temiz çıkar.
afterAll(() => {
  onlineManager.setEventListener(() => () => {});
});
