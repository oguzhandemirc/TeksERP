// Alt sekmeler (telefon): expo-router `Tabs` (kararlı JS sekmeleri; native-tabs KULLANILMAZ). Zemin opak `surface`
// + 1 px ayraç; seçili sekme alan rengini taşır. Geniş ekranda (≥ 768) sekme çubuğu gizlenir, gezinme sol raydadır.
// Yükseklik açık verilir ve etiket küçülmez: kütüphanenin 49 px çubuğunda etiket kabı 9 px'e sıkışıp ş/ğ kancalarını kırpıyordu.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { destekRozetMetni, useDestekOkunmamis } from "../../../src/destek/gorunurluk";
import { useSession } from "../../../src/state/session";
import { useWide } from "../../../src/ui/Frame";
import { TABS, tabVisible } from "../../../src/ui/tabs";
import { useTokens } from "../../../src/ui/theme-context";
import { TAB_BAR_HEIGHT, space, typography } from "../../../src/ui/tokens";

export default function TabsLayout() {
  const { permissions } = useSession();
  const t = useTokens();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  // Destek yanıtı rozeti "Diğer" sekmesinde (Destek satırı orada); destek kapalıyken depo sıfır → rozet yok.
  const destekRozeti = destekRozetMetni(useDestekOkunmamis());
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, flexShrink: 0, fontWeight: typography.caption.fontWeight },
        tabBarItemStyle: { paddingTop: space.xs + 2, paddingBottom: space.xs },
        tabBarStyle: wide
          ? { display: "none" }
          : { backgroundColor: t.surface, borderTopColor: t.separator, borderTopWidth: 1, height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            href: tabVisible(permissions, tab) ? undefined : null,
            tabBarActiveTintColor: tab.domain === "genel" ? t.tint : t.domain[tab.domain].fg,
            tabBarButtonTestID: `tab-${tab.name}`,
            tabBarAccessibilityLabel: tab.name === "diger" && destekRozeti ? `${tab.title}, ${destekRozeti} talepte yeni destek yanıtı` : tab.title,
            tabBarBadge: tab.name === "diger" && destekRozeti ? destekRozeti : undefined,
            tabBarBadgeStyle: { backgroundColor: t.tint },
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
