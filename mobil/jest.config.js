// jest-expo preset — Expo SDK 54 / RN 0.81 ile uyumlu transform + ortam.
// RNTL matcher'ları (toBeOnTheScreen vb.) setupFilesAfterEnv ile yüklenir.
// transformIgnorePatterns preset'ten gelir; kullanılan native modülleri (paper,
// reanimated, flash-list, gesture-handler) transform kapsamına alır.
module.exports = {
  preset: "jest-expo",
  // RNTL v13: matcher'lar built-in (extend-expect kaldırıldı) — yalnız kendi setup'ımız.
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  // Sadece test dosyalarını topla.
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-paper|react-native-reanimated|react-native-gesture-handler|@shopify/flash-list|react-native-sortables|react-native-toast-message))",
  ],
  // RN/react-query/jest-expo altyapısı node ortamında pin'lenemeyen açık handle
  // (timer) bırakıyor → "worker did not exit gracefully" uyarısı (testler 53/53
  // GEÇİYOR, exit 0). --detectOpenHandles belirli bir kaynak gösteremedi (Expo/RN
  // jest'te bilinen durum). setup.ts'teki onlineManager teardown hijyeni korunur;
  // forceExit jest'i testler bitince temiz kapatır (uyarı kalkar, leak birikmez).
  forceExit: true,
};
