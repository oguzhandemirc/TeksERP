// Giriş/davet kabuğu: her temada lacivert zemin + nötr marka ("TeksERP Yönetim"; firma adı/logo KODDA yok) + opak
// form kartı. Lacivert zemindeki metin koyu temanın metin token'larını kullanır (zemin her temada koyu).
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, dark, radius, space, typography } from "../tokens";

export function AuthShell({ title, subtitle, step, children, footer }: {
  readonly title: string;
  readonly subtitle?: string;
  /** "1/2" gibi adım göstergesi (nokta dizisi). */
  readonly step?: { readonly at: number; readonly of: number };
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const t = useTokens();
  const s = useStyles();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.flex, { backgroundColor: t.navy }]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <View style={s.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="stats-chart" size={34} color={t.gold} />
          </View>
          <Text style={s.brandName} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>TeksERP Yönetim</Text>
          <Text style={s.brandTag}>Fabrikanızın özeti, her an yanınızda</Text>
        </View>
        <View style={[s.card, { backgroundColor: t.surface }]}>
          {step ? (
            <View style={s.steps} accessible accessibilityLabel={`Adım ${step.at} / ${step.of}`}>
              {Array.from({ length: step.of }, (_, i) => (
                <View key={i} style={[s.dot, { backgroundColor: i < step.at ? t.tint : t.separator }, i === step.at - 1 && s.dotOn]} />
              ))}
              <Text style={s.stepText}>{`Adım ${step.at} / ${step.of}`}</Text>
            </View>
          ) : null}
          <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          <View style={s.body}>{children}</View>
        </View>
        {footer ? <View style={s.footer}>{footer}</View> : null}
        <View style={s.secure}>
          <Ionicons name="lock-closed" size={13} color={dark.textMuted} />
          <Text style={s.secureText}>Parola + doğrulama kodu ile korunur</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center" as const, padding: space.l, paddingVertical: space.xxl, width: "100%" as const, maxWidth: 480, alignSelf: "center" as const },
  brand: { alignItems: "center" as const, marginBottom: space.xl },
  mark: { width: 72, height: 72, borderRadius: radius.card, backgroundColor: dark.surfaceAlt, alignItems: "center" as const, justifyContent: "center" as const, marginBottom: space.l, borderWidth: 1, borderColor: dark.separator },
  brandName: { ...typography.largeTitle, fontSize: 30, lineHeight: 36, color: dark.text, textAlign: "center" as const },
  brandTag: { ...typography.subhead, color: dark.textSecondary, marginTop: space.xs, textAlign: "center" as const },
  card: { borderRadius: radius.sheet, padding: space.xl, borderWidth: 1, borderColor: t.scheme === "dark" ? t.separator : t.surface, ...t.floatShadow },
  steps: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: space.m },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { width: 22 },
  stepText: { ...typography.caption, color: t.textMuted, marginLeft: space.xs },
  title: { ...typography.title2, color: t.text },
  subtitle: { ...typography.subhead, color: t.textSecondary, marginTop: space.xs },
  body: { marginTop: space.l },
  footer: { marginTop: space.l },
  secure: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: space.xs, marginTop: space.xl },
  secureText: { ...typography.footnote, color: dark.textMuted },
}));
