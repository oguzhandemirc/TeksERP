// Reanimated 4 jest'te yerel modül olmadan koşsun diye resmî mock'u yükler (worklet'ler JS'te senkron çalışır).
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// Ionicons yazı tipini eşzamansız yükler (testte act uyarısı + expo-asset zinciri); testte yalnız etiket taşıyan boş görünüm.
jest.mock("@expo/vector-icons/Ionicons", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Icon = (p) => React.createElement(View, { accessibilityLabel: p.accessibilityLabel, testID: p.testID });
  Icon.glyphMap = {};
  return { __esModule: true, default: Icon };
});
