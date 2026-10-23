// Rol rozeti (tasarım dili §1.4): ölçüt `bulut:hesap:yonet` → YÖNETİCİ, diğerleri EKİP. Yalnız gösterir; karar sunucudadır.
import { Text, View } from "react-native";
import { can } from "../lib/access";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, radius, space, typography } from "./tokens";

export type Role = "yonetici" | "ekip";

export function roleOf(perms: readonly string[]): Role {
  return can(perms, "bulut:hesap:yonet") ? "yonetici" : "ekip";
}

const LABEL: Readonly<Record<Role, string>> = { yonetici: "Yönetici", ekip: "Ekip" };

export function RoleBadge({ permissions, testID = "rol-rozeti" }: { readonly permissions: readonly string[]; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const role = roleOf(permissions);
  const c = t.role[role];
  // Koyu temada lacivert zemin koyu yüzeyle birleşir; altın ince çerçeve rozeti seçilir kılar.
  return (
    <View style={[s.badge, { backgroundColor: c.bg }, role === "yonetici" && t.scheme === "dark" && { borderWidth: 1, borderColor: t.gold }]} testID={testID} accessible accessibilityLabel={`Rol: ${LABEL[role]}`}>
      <Text style={[s.text, { color: c.fg }]} maxFontSizeMultiplier={FONT_SCALE.title}>{LABEL[role]}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: { alignSelf: "flex-start" as const, borderRadius: radius.chip, paddingHorizontal: space.s, paddingVertical: 2 },
  text: { ...typography.footnote, fontWeight: "600" as const },
}));
