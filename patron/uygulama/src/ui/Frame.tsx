// Çerçeve: telefonda büyük başlık + alt sekmeler; tablet/web'de (≥ 768) solda kalıcı ray + içerik.
// Menü yalnız izinli bölümleri gösterir (karar yine sunucuda; izinsiz uç 403 döner).
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MODULES, moduleNavTitle, moduleTitle, moduleVisible, type ModuleKey } from "../lib/access";
import { useSession } from "../state/session";
import { StatusBands } from "./data";
import { FacilitySwitchModal } from "./FacilitySwitcher";
import { IconChip } from "./IconChip";
import { MODULE_ICON } from "./icons";
import { Banner } from "./kit";
import { LargeHeader, LargeTitle, useHeaderScroll } from "./LargeHeader";
import { durations } from "./motion";
import { railNavigate } from "./nav";
import { useRailOpen } from "./rail-pref";
import { RoleBadge } from "./RoleBadge";
import { RAIL_GROUPS } from "./tabs";
import { makeStyles, useReducedMotion, useTokens } from "./theme-context";
import { CONTENT_MAX, RAIL_COLLAPSED, RAIL_WIDTH, TOUCH, WIDE_MIN, radius, space, typography } from "./tokens";

export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN;
}

export function FacilityName() {
  const { facility, facilities } = useSession();
  const t = useTokens();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  // Firma adı KODDA yok: hesabın tesisinden gelir; yoksa nötr ad.
  const name = <Text style={s.facility} numberOfLines={1}>{facility?.tesis.ad ?? "TeksERP Yönetim"}</Text>;
  if (facilities.length < 2) return name;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Fabrika değiştir" testID="tesis-secici" onPress={() => setOpen(true)} style={s.facilityPress}>
        {name}
        <Ionicons name="swap-horizontal" size={16} color={t.tint} />
        <Text style={s.facilitySwitch}>değiştir</Text>
      </Pressable>
      <FacilitySwitchModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Geniş ekran rayı: tesis adı + rol rozeti; sekmelerle aynı sırada ana bölümler, sonra "İş" ve "Hesap" grupları.
 *  Açılır/kapanır (dar = yalnız ikon); durum çubuğu ve gezinme çubuğu güvenli alanı dolguyla korunur. */
export function SideNav() {
  const { permissions } = useSession();
  const t = useTokens();
  const s = useStyles();
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { open, toggle } = useRailOpen();
  return (
    <View style={[s.rail, { width: (open ? RAIL_WIDTH : RAIL_COLLAPSED) + insets.left, paddingTop: insets.top + space.s, paddingLeft: insets.left + space.s }]} testID="ray">
      <View style={[s.railHead, !open && s.railHeadClosed]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Menüyü daralt" : "Menüyü genişlet"}
          testID="ray-dugme"
          onPress={toggle}
          hitSlop={4}
          style={({ pressed }) => [s.railToggle, pressed && { backgroundColor: t.surfaceAlt }]}
        >
          <Ionicons name={open ? "chevron-back" : "menu"} size={22} color={t.textSecondary} />
        </Pressable>
        {open ? (
          <View style={s.railTitle}>
            <FacilityName />
            <RoleBadge permissions={permissions} />
          </View>
        ) : null}
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space.l }}>
        {RAIL_GROUPS.map((g, gi) => {
          const items = g.modules.flatMap((k) => {
            const m = MODULES.find((x) => x.key === k);
            return m && moduleVisible(permissions, k) ? [m] : [];
          });
          if (items.length === 0) return null;
          return (
            <View key={g.title ?? `grup-${gi}`}>
              {g.title ? (open ? <Text style={s.railSection} accessibilityRole="header">{g.title}</Text> : <View style={s.railRule} />) : null}
              {items.map((m) => {
                const active = path === m.route || path.startsWith(`${m.route}/`);
                const icon = MODULE_ICON[m.key];
                return (
                  <Pressable
                    key={m.key}
                    accessibilityRole="link"
                    accessibilityLabel={moduleNavTitle(m.key)}
                    accessibilityState={{ selected: active }}
                    testID={`menu-${m.key}`}
                    onPress={() => railNavigate(router, m.route, path)}
                    style={({ pressed }) => [s.railItem, !open && s.railItemClosed, active && { backgroundColor: t.tintContainer }, pressed && !active && { backgroundColor: t.surfaceAlt }]}
                  >
                    <IconChip domain={icon.domain} icon={icon.icon} size={28} />
                    {open ? <Text style={[s.railText, active && { color: t.tint, fontWeight: "600" }]} numberOfLines={1}>{moduleNavTitle(m.key)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface ScreenProps {
  /** Verilmezse `module`ün ekran başlığı (`access.ts`, tek kaynak); modül kök ekranları başlık YAZMAZ. */
  readonly title?: string;
  /** Verilirse izin yoksa içerik yerine uyarı çizilir. */
  readonly module?: ModuleKey;
  readonly children: ReactNode;
  /** Telefonda geri düğmesi; verilmezse "Pano" dışındaki her ekranda var. Sekme kökleri `false` verir. */
  readonly back?: boolean;
  /** Aşağı çekip yenileme (verilirse). */
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** Üst barın sağ yuvası (ör. eşitleme göstergesi, ikon düğmesi). */
  readonly headerRight?: ReactNode;
  /** Büyük başlığın altındaki satır (ör. tesis adı + SyncIndicator). */
  readonly subtitle?: ReactNode;
}

/** Her ekranın kabı: büyük başlık, bantlar, kaydırma ve aşağı çek-yenile; izin kapısı. */
export function Screen({ title: titleProp, module, children, back, onRefresh, refreshing, headerRight, subtitle }: ScreenProps) {
  const title = titleProp ?? (module ? moduleTitle(module) : "");
  const t = useTokens();
  const s = useStyles();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { permissions, switchError } = useSession();
  const { scrollY, onScroll } = useHeaderScroll();
  const allowed = module === undefined || moduleVisible(permissions, module);
  const reduced = useReducedMotion();
  const showBack = !wide && (back ?? title !== "Pano");
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/pano"));
  return (
    // Geniş ekranda yığın animasyonu yok (yanal gezinme); içerik bir kez kısa solmayla girer.
    <Animated.View style={s.screen} entering={wide && !reduced ? FadeIn.duration(durations.instant) : undefined}>
      <LargeHeader title={title} scrollY={scrollY} topInset={insets.top} onBack={showBack ? goBack : undefined} right={headerRight} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.tint} colors={[t.tint]} progressBackgroundColor={t.surface} /> : undefined}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xl, paddingHorizontal: wide ? space.xl : space.l }]}
      >
        <LargeTitle title={title} scrollY={scrollY} subtitle={subtitle} />
        <StatusBands />
        {switchError ? <Banner tone="error" text={switchError} testID="bant-tesis-gecisi" /> : null}
        {allowed ? children : <Banner tone="error" icon="lock-closed-outline" text="Bu bölümü görme yetkiniz yok" />}
      </Animated.ScrollView>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingTop: space.xs, maxWidth: CONTENT_MAX, width: "100%" as const, alignSelf: "center" as const },
  facility: { ...typography.headline, color: t.text, flexShrink: 1 },
  facilityPress: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs },
  facilitySwitch: { ...typography.footnote, color: t.tint },
  rail: { borderRightWidth: 1, borderColor: t.separator, backgroundColor: t.surface, paddingRight: space.s },
  railHead: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: space.xs, marginBottom: space.s },
  railHeadClosed: { justifyContent: "center" as const },
  railToggle: { width: TOUCH, height: TOUCH, borderRadius: radius.control, alignItems: "center" as const, justifyContent: "center" as const },
  railTitle: { flex: 1, gap: 2, paddingTop: space.xs, paddingRight: space.xs },
  railRule: { height: 1, backgroundColor: t.separator, marginVertical: space.s, marginHorizontal: space.s },
  railItemClosed: { justifyContent: "center" as const, paddingHorizontal: 0 },
  railSection: { ...typography.caption, color: t.textMuted, paddingHorizontal: space.s, marginTop: space.m, marginBottom: space.xs },
  railItem: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.s, borderRadius: radius.control, marginBottom: 2 },
  railText: { ...typography.callout, color: t.text, flex: 1 },
}));
