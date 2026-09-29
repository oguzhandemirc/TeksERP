// Temel yapı taşları — her ekran bunlardan kurulur, stil tekrar yazılmaz.
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { statusLabel } from "../lib/format";
import { TOUCH, color, space } from "./theme";

export function Card({ children, onPress, testID }: { children: ReactNode; onPress?: () => void; testID?: string }) {
  if (!onPress) return <View style={s.card} testID={testID}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, pressed && s.pressed]} testID={testID}>
      {children}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}

type Tone = "primary" | "plain" | "danger";

export function Button(p: { label: string; onPress: () => void; tone?: Tone; disabled?: boolean; busy?: boolean; testID?: string }) {
  const tone = p.tone ?? "primary";
  const off = p.disabled || p.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={off}
      onPress={p.onPress}
      testID={p.testID}
      style={({ pressed }) => [s.btn, s[`btn_${tone}`], off && s.btnOff, pressed && s.pressed]}
    >
      {p.busy ? <ActivityIndicator color={tone === "primary" ? color.primaryText : color.primary} /> : <Text style={[s.btnText, s[`btnText_${tone}`]]}>{p.label}</Text>}
    </Pressable>
  );
}

/** Yıkıcı işlem iki adımlıdır: ilk dokunuş onay sorar, ikincisi uygular. */
export function ConfirmButton(p: { label: string; question: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; testID?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button label={p.label} tone="danger" disabled={p.disabled} busy={p.busy} onPress={() => setAsking(true)} testID={p.testID} />;
  return (
    <View style={s.confirm}>
      <Body>{p.question}</Body>
      <View style={s.row}>
        <View style={s.flex}><Button label="Vazgeç" tone="plain" onPress={() => setAsking(false)} /></View>
        <View style={s.flex}>
          <Button label="Evet, uygula" tone="danger" busy={p.busy} onPress={() => { setAsking(false); p.onConfirm(); }} testID={p.testID ? `${p.testID}-evet` : undefined} />
        </View>
      </View>
    </View>
  );
}

export function Field(p: TextInputProps & { label: string; hint?: string }) {
  const { label, hint, style, ...rest } = p;
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={color.muted} style={[s.input, style]} {...rest} />
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ tone, text, testID }: { tone: "warn" | "off" | "error"; text: string; testID?: string }) {
  return (
    <View style={[s.banner, tone === "warn" ? s.bannerWarn : tone === "off" ? s.bannerOff : s.bannerErr]} testID={testID} accessibilityRole="alert">
      <Text style={[s.body, tone === "error" && { color: color.danger }]}>{text}</Text>
    </View>
  );
}

export function Badge({ status }: { status: string }) {
  const tone = status === "REDDEDILDI" || status === "HATA" || status === "KILITLI" ? color.danger : status === "ISLENDI" || status === "HAZIR" || status === "AKTIF" ? color.ok : color.muted;
  return <Text style={[s.badge, { color: tone, borderColor: tone }]}>{statusLabel(status)}</Text>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ margin: space.xl }} color={color.primary} />;
}

/** Bölüm içi sekmeler (yalnız verilen seçenekler; izinsiz sekme hiç verilmez). */
export function Tabs<K extends string>({ items, value, onChange }: { items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={[s.row, { marginBottom: space.m }]}>
      {items.map((i) => (
        <View key={i.key} style={s.flex}>
          <Button label={i.label} tone={i.key === value ? "primary" : "plain"} onPress={() => onChange(i.key)} testID={`sekme-${i.key}`} />
        </View>
      ))}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: color.card, borderRadius: 10, borderWidth: 1, borderColor: color.line, padding: space.l, marginBottom: space.m, minHeight: TOUCH },
  pressed: { opacity: 0.7 },
  title: { fontSize: 20, fontWeight: "700", color: color.text, marginBottom: space.s },
  body: { fontSize: 16, color: color.text },
  muted: { fontSize: 14, color: color.muted },
  btn: { minHeight: TOUCH, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: space.l, marginVertical: space.xs },
  btn_primary: { backgroundColor: color.primary },
  btn_plain: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line },
  btn_danger: { backgroundColor: color.card, borderWidth: 1, borderColor: color.danger },
  btnOff: { opacity: 0.45 },
  btnText: { fontSize: 16, fontWeight: "600" },
  btnText_primary: { color: color.primaryText },
  btnText_plain: { color: color.text },
  btnText_danger: { color: color.danger },
  confirm: { borderWidth: 1, borderColor: color.danger, borderRadius: 8, padding: space.m, marginVertical: space.xs },
  row: { flexDirection: "row", gap: space.s, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 120 },
  field: { marginBottom: space.m },
  label: { fontSize: 14, fontWeight: "600", color: color.text, marginBottom: space.xs },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: color.line, borderRadius: 8, paddingHorizontal: space.m, fontSize: 16, backgroundColor: color.card, color: color.text },
  banner: { padding: space.m, borderRadius: 8, marginBottom: space.m },
  bannerWarn: { backgroundColor: color.warnBg },
  bannerOff: { backgroundColor: color.offBg },
  bannerErr: { backgroundColor: "#FDECEA" },
  badge: { fontSize: 13, fontWeight: "600", borderWidth: 1, borderRadius: 12, paddingHorizontal: space.s, paddingVertical: 2, alignSelf: "flex-start" },
  stat: { flexGrow: 1, flexBasis: 140, backgroundColor: color.card, borderRadius: 10, borderWidth: 1, borderColor: color.line, padding: space.m },
  statValue: { fontSize: 22, fontWeight: "700", color: color.text, marginTop: space.xs },
});
