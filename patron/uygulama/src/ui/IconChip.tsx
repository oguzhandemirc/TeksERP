// Alan ikon çipi: alan renginde ikon, çip zemininde yuvarlak kare (KPI, satır, ray, sekme başlığı ortak).
import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { DOMAIN_ICON, type IconName } from "./icons";
import { useTokens } from "./theme-context";
import { radius, type Domain } from "./tokens";

export function IconChip({ domain, icon, size = 28 }: { readonly domain: Domain; readonly icon?: IconName; readonly size?: number }) {
  const t = useTokens();
  const c = t.domain[domain];
  return (
    <View style={{ width: size, height: size, borderRadius: Math.min(radius.cardInner, size / 3), backgroundColor: c.chip, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon ?? DOMAIN_ICON[domain]} size={Math.round(size * 0.58)} color={c.fg} />
    </View>
  );
}
