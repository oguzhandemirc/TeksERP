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

// react-native-keyboard-controller — kütüphanenin RESMİ jest mock'u. AppModal /
// KeyboardAwareScrollView import zinciri (PickerModal, ekranlar) aksi halde
// "package doesn't seem to be linked" ile patlar.
jest.mock("react-native-keyboard-controller", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-keyboard-controller/jest"),
);

// react-native-bluetooth-classic — native köprü testte yok. virtual:true ile
// modül kurulu olmasa da mock kurulur; BT etiket yolu testlerde no-op kalır.
jest.mock(
  "react-native-bluetooth-classic",
  () => ({
    __esModule: true,
    default: {
      isBluetoothEnabled: jest.fn(async () => true),
      requestBluetoothEnabled: jest.fn(async () => true),
      getBondedDevices: jest.fn(async () => []),
      startDiscovery: jest.fn(async () => []),
      cancelDiscovery: jest.fn(async () => true),
      pairDevice: jest.fn(async () => ({})),
      isDeviceConnected: jest.fn(async () => false),
      connectToDevice: jest.fn(async () => ({})),
      // ⚠️ 2026-08-17'de EKLENDİ: bayat RFCOMM soketini koparan yol (forceDisconnect)
      // bu metot yoksa SESSİZCE no-op'a düşer — yani mock eksik kalsaydı yeni
      // davranışın testleri vakumen yeşil olurdu.
      disconnectFromDevice: jest.fn(async () => true),
      writeToDevice: jest.fn(async () => true),
      availableFromDevice: jest.fn(async () => 0),
      readFromDevice: jest.fn(async () => null),
      clearFromDevice: jest.fn(async () => true),
    },
  }),
  { virtual: true },
);

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
