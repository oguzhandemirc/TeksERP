import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/state/session";
import { plainStore } from "../src/state/store";
import { ThemeProvider, useTokens } from "../src/ui/theme-context";

// Zemin ve durum çubuğu etkin temadan; içerik oturum kapısından geçer.
function Themed() {
  const t = useTokens();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider store={plainStore}>
        <SessionProvider platform={Platform.OS === "web" ? "web" : "mobil"}>
          <Themed />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
