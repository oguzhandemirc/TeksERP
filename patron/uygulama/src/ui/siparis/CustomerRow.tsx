// Cari satırı: ad (tam genişlik) · kod + il · rol rozetleri (+ Pasif). Roller kimlik değil bayraktır (master veri kuralı).
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import type { ProjectionRecord } from "../../api/wire";
import { cariRoles } from "../../lib/labels/siparis";
import { IconChip } from "../IconChip";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, space, tabularNums, typography } from "../tokens";
import { asObj, str } from "./OrderRow";
import { RolePill } from "./parts";

export function CustomerRow({ r, onPress }: { r: ProjectionRecord; onPress: () => void }) {
  const t = useTokens();
  const s = useStyles();
  const k = asObj(r.kayit);
  const roles = cariRoles(k);
  const passive = k.aktif === false;
  const sub = [str(k.kod), str(k.il)].filter(Boolean).join(" · ");
  const name = str(k.ad) ?? "—";
  return (
    <Pressable
      onPress={onPress} testID={`cari-${r.id}`} accessibilityRole="button"
      accessibilityLabel={[name, sub, ...roles.map((x) => x.label), passive ? "Pasif" : null].filter(Boolean).join(", ")}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}
    >
      <IconChip domain="cariler" icon={passive ? "archive-outline" : "person-outline"} size={36} />
      <View style={s.text}>
        <Text style={[s.title, passive && { color: t.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.body}>{name}</Text>
        {sub ? <Text style={s.subtitle} numberOfLines={1}>{sub}</Text> : null}
        {roles.length > 0 || passive ? (
          <View style={s.pills}>
            {roles.map((x) => <RolePill key={x.key} roleKey={x.key} label={x.label} />)}
            {passive ? <StatusBadge kind="bilgi" label="Pasif" size="sm" /> : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, minWidth: 0, gap: 3 },
  title: { ...typography.headline, color: t.text },
  subtitle: { ...typography.subhead, ...tabularNums, color: t.textSecondary },
  pills: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: space.xs, marginTop: 2 },
}));
