// Mobil jest global setup. RNTL matcher'ları (v13) built-in.
// Native modül mock'ları — store/storage import zinciri testte native köprü çekmesin.

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

// Reanimated test ortamında uyarı basmasın — mock'u yükle (varsa).
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-reanimated").setUpTests?.();
} catch {
  // reanimated mock yoksa sorun değil — saf-logic testleri etkilenmez.
}
