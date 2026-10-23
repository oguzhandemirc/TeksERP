// Açılış yönlendirmesi: oturum okunurken giriş ekranıyla aynı lacivert zemin (beyaz parlama olmasın).
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/state/session";
import { useTokens } from "../src/ui/theme-context";

export default function Index() {
  const { phase } = useSession();
  const t = useTokens();
  if (phase === "yukleniyor") {
    return (
      <View style={{ flex: 1, backgroundColor: t.navy, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.gold} size="large" accessibilityLabel="Yükleniyor" />
      </View>
    );
  }
  return <Redirect href={phase === "hazir" ? "/pano" : "/giris"} />;
}
