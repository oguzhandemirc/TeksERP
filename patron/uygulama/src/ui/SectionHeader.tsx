// Bölüm başlığı: isteğe bağlı alan ikon çipi · başlık (+ sayaç) ve sağda isteğe bağlı "Tümü ›" bağlantısı.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { IconChip } from "./IconChip";
import type { IconName } from "./icons";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, TOUCH, radius, space, tabularNums, typography, type Domain } from "./tokens";

export interface SectionHeaderProps {
  readonly title: string;
  /** Sayaç: adet ya da "3/8" gibi hazır metin. */
  readonly count?: number | string;
  /** Başlığın solunda alan ikon çipi (renk `domain`den, verilmezse `genel`). */
  readonly icon?: IconName;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly domain?: Domain;
  readonly testID?: string;
}

export function SectionHeader({ title, count, icon, actionLabel = "Tümü", onAction, domain, testID }: SectionHeaderProps) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={s.row} testID={testID}>
      {icon ? <IconChip domain={domain ?? "genel"} icon={icon} size={28} /> : null}
      <Text style={[s.title, domain ? { color: t.domain[domain].fg } : null]} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>
        {title}
      </Text>
      {count !== undefined ? <Text style={s.count}>{count}</Text> : null}
      <View style={s.flex} />
      {onAction ? (
        <Pressable onPress={onAction} accessibilityRole="link" accessibilityLabel={`${title}: ${actionLabel}`} style={s.action} testID={testID ? `${testID}-tumu` : undefined}>
          <Text style={s.actionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={16} color={t.tint} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginTop: space.l, marginBottom: space.s },
  title: { ...typography.title3, color: t.text },
  count: { ...typography.footnote, ...tabularNums, fontWeight: "600" as const, color: t.textSecondary, backgroundColor: t.surfaceAlt, borderRadius: radius.chip, paddingHorizontal: space.s, paddingVertical: 1, overflow: "hidden" as const },
  flex: { flex: 1 },
  action: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: 2, paddingLeft: space.s },
  actionText: { ...typography.subhead, color: t.tint },
}));
