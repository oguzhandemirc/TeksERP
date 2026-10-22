// Alt sekmeler (telefon): expo-router `Tabs` (kararlı JS sekmeleri; native-tabs KULLANILMAZ). Zemin opak `surface`
// + 1 px ayraç; seçili sekme alan rengini taşır. Geniş ekranda (≥ 768) sekme çubuğu gizlenir, gezinme sol raydadır.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useSession } from "../../../src/state/session";
import { useWide } from "../../../src/ui/Frame";
import { TABS, tabVisible } from "../../../src/ui/tabs";
import { useTokens } from "../../../src/ui/theme-context";
import { typography } from "../../../src/ui/tokens";

export default function TabsLayout() {
  const { permissions } = useSession();
  const t = useTokens();
  const wide = useWide();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: typography.caption.fontWeight },
        tabBarStyle: wide ? { display: "none" } : { backgroundColor: t.surface, borderTopColor: t.separator, borderTopWidth: 1 },
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
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
