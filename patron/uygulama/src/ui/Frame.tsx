// Çerçeve: telefonda üst şerit + tek sütun; tablet/web'de (≥ 768) solda kalıcı menü + içerik.
// Menü yalnız izinli bölümleri gösterir (karar yine sunucuda; izinsiz uç 403 döner).
import { usePathname, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { moduleVisible, visibleModules, type ModuleKey } from "../lib/access";
import { useSession } from "../state/session";
import { StatusBands } from "./data";
import { FacilitySwitchModal } from "./FacilitySwitcher";
import { Banner } from "./kit";
import { TOUCH, WIDE_MIN, color, space } from "./theme";

export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN;
}

export function FacilityName() {
  const { facility, facilities } = useSession();
  const [open, setOpen] = useState(false);
  // Firma adı KODDA yok: hesabın tesisinden gelir; yoksa nötr ad.
  const name = <Text style={{ fontSize: 18, fontWeight: "700", color: color.text, flexShrink: 1 }} numberOfLines={1}>{facility?.tesis.ad ?? "TeksERP Yönetim"}</Text>;
  if (facilities.length < 2) return name;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Fabrika değiştir" testID="tesis-secici" onPress={() => setOpen(true)}
        style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.s }}>
        {name}
        <Text style={{ fontSize: 13, color: color.primary }}>⇄ değiştir</Text>
      </Pressable>
      <FacilitySwitchModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SideNav() {
  const { permissions } = useSession();
  const router = useRouter();
  const path = usePathname();
  return (
    <View style={{ width: 240, borderRightWidth: 1, borderColor: color.line, backgroundColor: color.card, paddingTop: space.l }}>
      <View style={{ paddingHorizontal: space.l, marginBottom: space.l }}><FacilityName /></View>
      {visibleModules(permissions).map((m) => {
        const active = path === m.route || path.startsWith(`${m.route}/`);
        return (
          <Pressable key={m.key} accessibilityRole="link" testID={`menu-${m.key}`} onPress={() => router.navigate(m.route as never)}
            style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.l, backgroundColor: active ? color.bg : undefined }}>
            <Text style={{ fontSize: 16, fontWeight: active ? "700" : "400", color: active ? color.primary : color.text }}>{m.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Her ekranın kabı: başlık, bantlar, kaydırma; `module` verilirse izin yoksa içerik yerine uyarı. */
export function Screen({ title, module, children, back }: { title: string; module?: ModuleKey; children: ReactNode; back?: boolean }) {
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { permissions, switchError } = useSession();
  const allowed = module === undefined || moduleVisible(permissions, module);
  const showBack = !wide && (back ?? title !== "Pano");
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={{ paddingTop: wide ? space.l : insets.top + space.s, paddingHorizontal: space.l, paddingBottom: space.s, flexDirection: "row", alignItems: "center", gap: space.m }}>
        {showBack ? (
          <Pressable accessibilityRole="button" testID="geri" onPress={() => (router.canGoBack() ? router.back() : router.replace("/pano"))} style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: "center" }}>
            <Text style={{ fontSize: 16, color: color.primary }}>‹ Geri</Text>
          </Pressable>
        ) : null}
        <Text style={{ fontSize: 22, fontWeight: "700", color: color.text, flex: 1 }} numberOfLines={1}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.l, paddingBottom: insets.bottom + space.xl, maxWidth: 960, width: "100%", alignSelf: "center" }}>
        <StatusBands />
        {switchError ? <Banner tone="error" text={switchError} testID="bant-tesis-gecisi" /> : null}
        {allowed ? children : <Banner tone="error" text="Bu bölümü görme yetkiniz yok" />}
      </ScrollView>
    </View>
  );
}
