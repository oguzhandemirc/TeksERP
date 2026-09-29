import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/state/session";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider platform={Platform.OS === "web" ? "web" : "mobil"}>
        <StatusBar style="dark" />
        <Slot />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
