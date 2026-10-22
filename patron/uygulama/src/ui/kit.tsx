// Temel yapı taşları — her ekran bunlardan kurulur, stil tekrar yazılmaz. Renkler `useTokens()`tan (ışık/koyu).
// Adlar ve testID'ler sözleşmedir (ekran testleri bunlara bağlı): Card, Title, Body, Muted, Button, ConfirmButton,
// Field, Banner, Badge, Stat, Loading, Tabs, Row.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { haptic } from "./haptics";
import type { IconName } from "./icons";
import { SegmentedControl } from "./SegmentedControl";
import { StatusBadge } from "./StatusBadge";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, STRIPE, TOUCH, radius, space, tabularNums, typography, type Domain, type StatusKind } from "./tokens";

/** Opak içerik kartı; solda 4 px alan şeridi (alan verilmezse nötr). */
export function Card({ children, onPress, testID, domain, style, accessibilityLabel }: {
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
  domain?: Domain;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTokens();
  const s = useStyles();
  const stripe = <View style={[s.stripe, { backgroundColor: t.domain[domain ?? "genel"].fg }]} />;
  if (!onPress) {
    return (
      <View style={[s.card, style]} testID={testID} accessibilityLabel={accessibilityLabel}>
        {stripe}
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [s.card, style, pressed && s.pressed]}
      testID={testID}
    >
      {stripe}
      {children}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.title} maxFontSizeMultiplier={FONT_SCALE.title} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children, testID }: { children: ReactNode; testID?: string }) {
  const s = useStyles();
  return <Text style={s.muted} testID={testID}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.body}>{children}</Text>;
}

type Tone = "primary" | "secondary" | "plain" | "danger";

export function Button(p: { label: string; onPress: () => void; tone?: Tone; disabled?: boolean; busy?: boolean; testID?: string; icon?: IconName; accessibilityLabel?: string }) {
  const t = useTokens();
  const s = useStyles();
  const tone = p.tone ?? "primary";
  const off = p.disabled || p.busy;
  const fg = tone === "primary" ? t.onTint : tone === "danger" ? t.status.kritik.fill : tone === "secondary" ? t.tint : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: !!p.busy }}
      disabled={off}
      onPress={p.onPress}
      testID={p.testID}
      style={({ pressed }) => [s.btn, s[`btn_${tone}`], off && s.btnOff, pressed && s.pressed]}
    >
      {p.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={s.btnInner}>
          {p.icon ? <Ionicons name={p.icon} size={18} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]} maxFontSizeMultiplier={FONT_SCALE.title}>{p.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Yıkıcı işlem iki adımlıdır: ilk dokunuş onay sorar, ikincisi uygular. */
export function ConfirmButton(p: { label: string; question: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; testID?: string }) {
  const s = useStyles();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button label={p.label} tone="danger" disabled={p.disabled} busy={p.busy} onPress={() => setAsking(true)} testID={p.testID} />;
  return (
    <View style={s.confirm}>
      <Body>{p.question}</Body>
      <View style={s.row}>
        <View style={s.flex}><Button label="Vazgeç" tone="plain" onPress={() => setAsking(false)} /></View>
        <View style={s.flex}>
          <Button
            label="Evet, uygula"
            tone="danger"
            busy={p.busy}
            onPress={() => {
              setAsking(false);
              haptic("warning");
              p.onConfirm();
            }}
            testID={p.testID ? `${p.testID}-evet` : undefined}
          />
        </View>
      </View>
    </View>
  );
}

export function Field(p: TextInputProps & { label: string; hint?: string; error?: string }) {
  const t = useTokens();
  const s = useStyles();
  const { label, hint, error, style, ...rest } = p;
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={t.textMuted}
        accessibilityLabel={label}
        style={[s.input, error ? { borderColor: t.status.kritik.fill } : null, style]}
        {...rest}
      />
      {error ? <Text style={[s.muted, { color: t.status.kritik.fill }]}>{error}</Text> : hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

const BANNER_KIND: Readonly<Record<"warn" | "off" | "error", StatusKind>> = { warn: "uyari", off: "bilgi", error: "kritik" };

export function Banner({ tone, text, testID, icon }: { tone: "warn" | "off" | "error"; text: string; testID?: string; icon?: IconName }) {
  const t = useTokens();
  const s = useStyles();
  const c = t.status[BANNER_KIND[tone]];
  return (
    <View style={[s.banner, { backgroundColor: c.bg }]} testID={testID} accessibilityRole="alert">
      <Ionicons name={icon ?? c.icon} size={20} color={c.fill} />
      <Text style={[s.bannerText, { color: c.text }]}>{text}</Text>
    </View>
  );
}

/** Durum rozeti (geriye uyum adı; yeni kod `StatusBadge` kullanır). */
export function Badge({ status }: { status: string }) {
  return <StatusBadge value={status} />;
}

export function Stat({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return (
    <View style={s.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={s.caption}>{label}</Text>
      <Text style={s.statValue} maxFontSizeMultiplier={FONT_SCALE.title}>{value}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTokens();
  return <ActivityIndicator style={{ margin: space.xl }} color={t.tint} accessibilityLabel="Yükleniyor" />;
}

/** Bölüm içi sekmeler (yalnız verilen seçenekler; izinsiz sekme hiç verilmez). Görünüm: segment denetimi. */
export function Tabs<K extends string>({ items, value, onChange }: { items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={{ marginBottom: space.m }}>
      <SegmentedControl items={items} value={value} onChange={onChange} testIDPrefix="sekme-" />
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.row}>{children}</View>;
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.card,
    padding: space.l,
    paddingLeft: space.l + STRIPE,
    marginBottom: space.m,
    minHeight: TOUCH,
    overflow: "hidden" as const,
    ...t.cardShadow,
  },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  title: { ...typography.title3, color: t.text, marginBottom: space.s },
  body: { ...typography.body, color: t.text },
  muted: { ...typography.subhead, color: t.textMuted },
  caption: { ...typography.caption, color: t.textSecondary },
  btn: {
    minHeight: TOUCH,
    borderRadius: radius.button,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: space.l,
    marginVertical: space.xs,
  },
  btn_primary: { backgroundColor: t.tint },
  btn_secondary: { backgroundColor: t.tintContainer },
  btn_plain: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.separator },
  btn_danger: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.status.kritik.fill },
  btnOff: { opacity: 0.45 },
  btnInner: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  btnText: { ...typography.callout, fontWeight: "600" as const },
  confirm: {
    borderWidth: 1,
    borderColor: t.status.kritik.fill,
    backgroundColor: t.status.kritik.bg,
    borderRadius: radius.cardInner,
    padding: space.m,
    marginVertical: space.xs,
  },
  row: { flexDirection: "row" as const, gap: space.s, flexWrap: "wrap" as const },
  flex: { flex: 1, minWidth: 120 },
  field: { marginBottom: space.m },
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginBottom: space.xs },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: t.separator,
    borderRadius: radius.control,
    paddingHorizontal: space.m,
    ...typography.body,
    backgroundColor: t.surface,
    color: t.text,
  },
  banner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: space.s,
    padding: space.m,
    borderRadius: radius.cardInner,
    marginBottom: space.m,
  },
  bannerText: { ...typography.subhead, flex: 1 },
  stat: {
    flexGrow: 1,
    flexBasis: 140,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.cardInner,
    padding: space.m,
  },
  statValue: { ...typography.title2, ...tabularNums, color: t.text, marginTop: space.xs },
}));
