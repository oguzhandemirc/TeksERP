// jest-expo preset — Expo SDK 54 / RN 0.81 ile uyumlu transform + ortam.
// RNTL matcher'ları (toBeOnTheScreen vb.) setupFilesAfterEnv ile yüklenir.
// transformIgnorePatterns preset'ten gelir; kullanılan native modülleri (paper,
// reanimated, flash-list, svg, gesture-handler) transform kapsamına alır.
module.exports = {
  preset: "jest-expo",
  // RNTL v13: matcher'lar built-in (extend-expect kaldırıldı) — yalnız kendi setup'ımız.
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  // Sadece test dosyalarını topla.
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-paper|react-native-reanimated|react-native-gesture-handler|@shopify/flash-list|react-native-sortables|react-native-toast-message))",
  ],
};
