// Liste satırı (iOS Ayarlar tarzı gruplu liste): sol ikon çipi · başlık + alt metin · sağda değer/rozet + chevron.
// `ListGroup` satırları opak kart içinde ince ayraçla toplar.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { IconChip } from "./IconChip";
import type { IconName } from "./icons";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, radius, space, tabularNums, typography, type Domain, type StatusKind } from "./tokens";

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly value?: string;
  /** Değer durum anlamı taşıyorsa (gecikti, vadesi geçti) rengi. */
  readonly valueTone?: StatusKind;
  readonly icon?: IconName;
  readonly domain?: Domain;
  /** Sağda rozet (ör. `<StatusBadge …/>`). */
  readonly accessory?: ReactNode;
  readonly onPress?: () => void;
  /** Kısıtlı alan: kilit ikonu, dokunulamaz. */
  readonly locked?: boolean;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

export function ListRow(p: ListRowProps) {
  const t = useTokens();
  const s = useStyles();
  const pressable = !!p.onPress && !p.locked;
  const content = (
    <>
      {p.icon || p.domain ? <IconChip domain={p.domain ?? "genel"} icon={p.icon} size={36} /> : null}
      <View style={s.text}>
        <Text style={s.title} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.body}>{p.title}</Text>
        {p.subtitle ? <Text style={s.subtitle} numberOfLines={2}>{p.subtitle}</Text> : null}
      </View>
      {p.value ? <Text style={[s.value, p.valueTone ? { color: t.status[p.valueTone].fill } : null]} numberOfLines={1}>{p.value}</Text> : null}
      {p.accessory}
      {p.locked ? <Ionicons name="lock-closed-outline" size={18} color={t.textMuted} accessibilityLabel="Kısıtlı" /> : pressable ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </>
  );
  const label = p.accessibilityLabel ?? [p.title, p.subtitle, p.value].filter(Boolean).join(", ");
  if (!pressable) {
    return <View style={s.row} testID={p.testID} accessible accessibilityLabel={label}>{content}</View>;
  }
  return (
    <Pressable onPress={p.onPress} testID={p.testID} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}>
      {content}
    </Pressable>
  );
}

/** Gruplu liste kabı: opak kart, satırlar arası ince ayraç (ikon hizasından başlar). */
export function ListGroup({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const s = useStyles();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={s.group} testID={testID}>
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={s.sep} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, marginBottom: space.m, ...t.cardShadow },
  sep: { height: 1, backgroundColor: t.separator, marginLeft: space.l + 36 + space.m },
  row: { minHeight: 56, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  text: { flex: 1 },
  title: { ...typography.headline, color: t.text },
  subtitle: { ...typography.subhead, color: t.textSecondary, marginTop: 1 },
  value: { ...typography.callout, ...tabularNums, color: t.text, maxWidth: "45%" as const },
}));
