// Oturum kapısı: oturum yoksa girişe. İçerik bir yığındır (sekmeler + Diğer'den açılan bölümler); geniş ekranda
// (≥ 768) solda kalıcı ray. Bildirime dokunma ve ERP telefon push kaydı oturum hazırken çalışır.
import { Redirect, Stack } from "expo-router";
import { View } from "react-native";
import { useNotificationTaps } from "../../src/push/taps";
import { useErpPushKaydi } from "../../src/push/useErpPush";
import { useSession } from "../../src/state/session";
import { FORM_SHEET_OPTIONS, SideNav, useWide } from "../../src/ui/Frame";
import { Loading } from "../../src/ui/kit";
import { useTokens } from "../../src/ui/theme-context";

/** Geniş ekranda kart olarak açılan form rotaları (ekran `Screen sheet` verir). */
const FORM_ROUTES = ["cariler/yeni", "cariler/duzenle", "urunler/yeni", "urunler/duzenle", "urunler/fiyat", "renkler/yeni", "renkler/duzenle", "hesaplar/yeni", "raporlar/yeni"] as const;

export default function AppLayout() {
  const { phase } = useSession();
  const wide = useWide();
  const t = useTokens();
  useNotificationTaps(phase === "hazir");
  useErpPushKaydi(phase === "hazir");
  if (phase === "yukleniyor") return <Loading />;
  if (phase !== "hazir") return <Redirect href="/giris" />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }}>
      {wide ? <SideNav /> : null}
      <View style={{ flex: 1 }}>
        {/* Geniş ekranda yığın kaydırması yok: raydan geçiş yanaldır, ekran içeriği kendi kısa solmasıyla girer. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: wide ? "none" : "default" }}>
          {FORM_ROUTES.map((name) => <Stack.Screen key={name} name={name} options={wide ? FORM_SHEET_OPTIONS : {}} />)}
        </Stack>
      </View>
    </View>
  );
}
