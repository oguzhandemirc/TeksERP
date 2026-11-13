import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
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

// Önceki rapor dışa aktarma dosyaları açılışta süpürülür (paylaşımdan hemen sonra silinmezler). Yerel modül yalnız
// telefonda yüklenir; web'de dosya sistemi yok.
function oncekiDisaAktarmalariSupur() {
  if (Platform.OS === "web") return;
  const { oncekileriSupur } = require("../src/lib/rapor-dosya") as typeof import("../src/lib/rapor-dosya");
  const { yerelDosyaPortlari } = require("../src/lib/rapor-dosya-yerel") as typeof import("../src/lib/rapor-dosya-yerel");
  oncekileriSupur(yerelDosyaPortlari);
}

export default function RootLayout() {
  useEffect(oncekiDisaAktarmalariSupur, []);
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
