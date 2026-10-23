// Liste satırı (iOS Ayarlar tarzı gruplu liste): sol ikon çipi · başlık + alt metin · sağda değer/rozet + chevron.
// Değer ile rozet birlikteyse ya da `lines` verilirse Posta düzeni: rozet/değer başlık satırına çıkar, alt satırlar
// tam genişlik kalır (yan yana dururken alt metni kırpıyordu). `ListGroup` satırları opak kartta ince ayraçla toplar.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { IconChip } from "./IconChip";
import type { IconName } from "./icons";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, radius, space, tabularNums, typography, type Domain, type StatusKind } from "./tokens";

/** `ListRow` ikon çipi boyu (ayraç girintisinin varsayılanı). */
export const LIST_ICON = 36;

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Tam genişlik alt satırlar (her biri tek satır); verilirse Posta düzeni. */
  readonly lines?: readonly string[];
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
  const stacked = p.lines !== undefined || (!!p.value && !!p.accessory);
  const sub = p.lines ?? (p.subtitle ? [p.subtitle] : []);
  const value = p.value ? <Text style={[s.value, stacked && s.valueTop, p.valueTone ? { color: t.status[p.valueTone].fill } : null]} numberOfLines={1}>{p.value}</Text> : null;
  const content = (
    <>
      {p.icon || p.domain ? <IconChip domain={p.domain ?? "genel"} icon={p.icon} size={LIST_ICON} /> : null}
      {stacked ? (
        <View style={[s.text, s.stack]}>
          <View style={s.top}>
            <Text style={[s.title, s.flex]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.body}>{p.title}</Text>
            {value}
            {p.accessory}
          </View>
          {sub.map((l, i) => <Text key={i} style={s.subtitle} numberOfLines={1}>{l}</Text>)}
        </View>
      ) : (
        <>
          <View style={s.text}>
            <Text style={s.title} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.body}>{p.title}</Text>
            {p.subtitle ? <Text style={s.subtitle} numberOfLines={2}>{p.subtitle}</Text> : null}
          </View>
          {value}
          {p.accessory}
        </>
      )}
      {p.locked ? <Ionicons name="lock-closed-outline" size={18} color={t.textMuted} accessibilityLabel="Kısıtlı" /> : pressable ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </>
  );
  const label = p.accessibilityLabel ?? (stacked ? [p.title, p.value, ...sub] : [p.title, p.subtitle, p.value]).filter(Boolean).join(", ");
  if (!pressable) {
    return <View style={[s.row, stacked && s.rowStacked]} testID={p.testID} accessible accessibilityLabel={label}>{content}</View>;
  }
  return (
    <Pressable onPress={p.onPress} testID={p.testID} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.row, stacked && s.rowStacked, pressed && { backgroundColor: t.surfaceAlt }]}>
      {content}
    </Pressable>
  );
}

/**
 * Gruplu liste kabı: opak kart, satırlar arası ince ayraç metin hizasından başlar.
 * `iconSize`: satırların sol ikon/avatar boyu (varsayılan `LIST_ICON`); ikonsuz satırlarda 0.
 */
export function ListGroup({ children, testID, iconSize = LIST_ICON }: { readonly children: ReactNode; readonly testID?: string; readonly iconSize?: number }) {
  const s = useStyles();
  const inset = space.l + (iconSize > 0 ? iconSize + space.m : 0);
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={s.group} testID={testID}>
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={[s.sep, { marginLeft: inset }]} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, marginBottom: space.m, ...t.cardShadow },
  sep: { height: 1, backgroundColor: t.separator },
  row: { minHeight: 56, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  rowStacked: { minHeight: 64, paddingVertical: space.m },
  text: { flex: 1 },
  stack: { gap: 2 },
  top: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  flex: { flex: 1 },
  title: { ...typography.headline, color: t.text },
  subtitle: { ...typography.subhead, color: t.textSecondary, marginTop: 1 },
  value: { ...typography.callout, ...tabularNums, color: t.text, maxWidth: "45%" as const },
  valueTop: { fontWeight: "600" as const, maxWidth: undefined },
}));
