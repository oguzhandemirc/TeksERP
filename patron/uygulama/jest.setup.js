// Reanimated 4 jest'te yerel modül olmadan koşsun diye resmî mock'u yükler (worklet'ler JS'te senkron çalışır).
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
