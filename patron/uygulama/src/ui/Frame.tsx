// Çerçeve: telefonda büyük başlık + alt sekmeler; tablet/web'de (≥ 768) solda kalıcı ray + içerik.
// Menü yalnız izinli bölümleri gösterir (karar yine sunucuda; izinsiz uç 403 döner).
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MODULES, moduleInMenu, moduleNavTitle, moduleTitle, moduleVisible, type ModuleKey } from "../lib/access";
import { useSession } from "../state/session";
import { StatusBands } from "./data";
import { FacilitySwitchModal } from "./FacilitySwitcher";
import { IconChip } from "./IconChip";
import { MODULE_ICON } from "./icons";
import { Banner } from "./kit";
import { LargeHeader, LargeTitle, useHeaderScroll } from "./LargeHeader";
import { durations, easing } from "./motion";
import { railNavigate } from "./nav";
import { useRailOpen } from "./rail-pref";
import { RoleText } from "./RoleBadge";
import { RAIL_GROUPS } from "./tabs";
import { makeStyles, useReducedMotion, useTokens } from "./theme-context";
import { CONTENT_MAX, RAIL_COLLAPSED, RAIL_WIDTH, TOUCH, WIDE_MIN, radius, space, typography } from "./tokens";
import { destekRozetMetni, useDestekEtkin, useDestekOkunmamis } from "../destek/gorunurluk";
import { Rozet } from "./destek/parcalar";
import { SorunBildirDugmesi } from "./destek/SorunBildirDugmesi";

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

/** Rayın hedef genişliği (güvenli alan dahil) ve ona yumuşak geçen paylaşılan değer; "hareketi azalt"ta anında. */
function useRailWidth(): { open: boolean; toggle: () => void; target: number; width: SharedValue<number> } {
  const insets = useSafeAreaInsets();
  const { open, toggle } = useRailOpen();
  const reduced = useReducedMotion();
  const target = (open ? RAIL_WIDTH : RAIL_COLLAPSED) + insets.left;
  const width = useSharedValue(target);
  useEffect(() => {
    width.value = reduced ? target : withTiming(target, { duration: durations.base, easing: easing.standard });
  }, [target, reduced, width]);
  return { open, toggle, target, width };
}

/** İçeriğin yatay kayması: genişlerken içerik ray kenarına yapışık kayar (sağda kısa boşluk), daralırken yerinde
 *  durur ve çekilen ray onu açar. Hiçbir karede içerik sağ kenardan taşmaz (kayma ≤ 0). */
export function railContentShift(panelWidth: number, slotWidth: number): number {
  "worklet";
  return Math.min(0, panelWidth - slotWidth);
}

/** Geniş ekran çerçevesi: ray + içerik. Yerleşimde ray yuvası hedef genişliğe TEK seferde geçer (içerik bir kez,
 *  son genişliğinde yerleşir; KPI sütunu ara genişlikte yeniden hesaplanmaz); canlanan yalnız yuvanın üstünde
 *  süzülen ray paneli ve içeriğin transform kayması — kare kare yerleşim (ve yığının gecikmeli ölçüsü) yok. */
export function RailFrame({ children, rail = true }: { readonly children: ReactNode; readonly rail?: boolean }) {
  const t = useTokens();
  const s = useStyles();
  const { target, width } = useRailWidth();
  const shift = useAnimatedStyle(() => ({ transform: [{ translateX: rail ? railContentShift(width.value, target) : 0 }] }));
  return (
    <View style={[s.frame, { backgroundColor: t.bg }]}>
      {rail ? (
        <View style={[s.railSlot, { width: target }]} testID="ray-yuvasi">
          <SideNav width={width} floating />
        </View>
      ) : null}
      <Animated.View style={[s.frameContent, shift]} testID="ray-icerik">{children}</Animated.View>
    </View>
  );
}

/** Geniş ekran rayı: tesis adı + rol rozeti; sekmelerle aynı sırada ana bölümler, sonra "İş" ve "Hesap" grupları.
 *  Açılır/kapanır (dar = yalnız ikon); durum çubuğu ve gezinme çubuğu güvenli alanı dolguyla korunur.
 *  `RailFrame` içinde genişliği çerçeveden alır ve yuvanın üstünde süzülür (`floating`). */
export function SideNav({ width: frameWidth, floating }: { readonly width?: SharedValue<number>; readonly floating?: boolean } = {}) {
  const { permissions } = useSession();
  const t = useTokens();
  const s = useStyles();
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const own = useRailWidth();
  const { open, toggle } = own;
  // Genişlik yumuşak geçer (taşan etiket kırpılır); çerçevedeyse içerikle AYNI değerden okunur.
  const width = frameWidth ?? own.width;
  const widthStyle = useAnimatedStyle(() => ({ width: width.value }));
  const destekEtkin = useDestekEtkin();
  const destekRozeti = destekRozetMetni(useDestekOkunmamis());
  const destekAktif = path === "/destek" || path.startsWith("/destek/");
  return (
    <Animated.View style={[s.rail, floating && s.railFloating, widthStyle, { paddingTop: insets.top + space.s, paddingLeft: insets.left + space.s }]} testID="ray">
      {/* Başlık satırı sayfa büyük başlığıyla aynı yükseklikte (üst dolgu + TOUCH) ortalanır. */}
      <View style={[s.railHead, !open && s.railHeadClosed]}>
        {open ? (
          <View style={s.railTitle}>
            <FacilityName />
            <RoleText permissions={permissions} />
          </View>
        ) : null}
        {/* Belirgin, çerçeveli düğme: açıkken "‹" daraltır, dar rayda "≡" genişletir. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Menüyü daralt" : "Menüyü genişlet"}
          testID="ray-dugme"
          onPress={toggle}
          hitSlop={4}
          style={({ pressed }) => [s.railToggle, { borderColor: t.separator, backgroundColor: pressed ? t.tintContainer : t.bg }]}
        >
          <Ionicons name={open ? "chevron-back" : "menu"} size={20} color={t.tint} />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space.l }}>
        {RAIL_GROUPS.map((g, gi) => {
          const items = g.modules.flatMap((k) => {
            const m = MODULES.find((x) => x.key === k);
            return m && moduleInMenu(permissions, k) ? [m] : [];
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
        {/* Destek modül tablosunda değil: yalnız `/destek/durum` etkin iken (kapalıyken ray bugünküyle aynı). */}
        {destekEtkin ? (
          <View>
            {open ? <Text style={s.railSection} accessibilityRole="header">Yardım</Text> : <View style={s.railRule} />}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={destekRozeti ? `Destek, ${destekRozeti} talepte yeni yanıt` : "Destek"}
              accessibilityState={{ selected: destekAktif }}
              testID="menu-destek"
              onPress={() => railNavigate(router, "/destek", path)}
              style={({ pressed }) => [s.railItem, !open && s.railItemClosed, destekAktif && { backgroundColor: t.tintContainer }, pressed && !destekAktif && { backgroundColor: t.surfaceAlt }]}
            >
              <IconChip domain="genel" icon="help-buoy-outline" size={28} />
              {open ? <Text style={[s.railText, destekAktif && { color: t.tint, fontWeight: "600" }]} numberOfLines={1}>Destek</Text> : null}
              {open && destekRozeti ? <Rozet label={destekRozeti} tone="primary" testID="ray-destek-okunmamis" /> : null}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Animated.View>
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
  /** Büyük başlığın altındaki satır (ör. tesis adı). */
  readonly subtitle?: ReactNode;
  /** Form ekranı: geniş ekranda tam sayfa yerine karartılmış listenin üstünde ortalı kart (yığında saydam kip,
   *  `FORM_SHEET_OPTIONS`); başlıkta "Kapat". Telefonda bugünkü tam sayfa. */
  readonly sheet?: boolean;
  /** Büyük başlıkla AYNI satırda sağda (ör. eşitleme göstergesi) — ayrı satır işgal etmez. */
  readonly titleRight?: ReactNode;
}

/** Geniş ekranda form rotalarının yığın seçeneği: alttaki ekran görünür kalır, kart solarak gelir. */
export const FORM_SHEET_OPTIONS = { presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } } as const;

function SheetScreen({ title, children, allowed, onClose }: { title: string; children: ReactNode; allowed: boolean; onClose: () => void }) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { switchError } = useSession();
  return (
    <View style={[s.sheetBackdrop, { paddingTop: insets.top + space.l, paddingBottom: insets.bottom + space.l }]}>
      {/* Karartma dokunuşla KAPATMAZ: yarım form yanlışlıkla kaybolmasın; çıkış başlıktaki "Kapat"tan. */}
      <View style={[s.scrim, { backgroundColor: t.navy, opacity: t.scheme === "dark" ? 0.7 : 0.4 }]} />
      <View style={[s.sheetCard, t.floatShadow]} accessibilityViewIsModal testID="form-karti">
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kapat" testID="form-kapat" style={s.sheetClose}>
            <Ionicons name="close" size={22} color={t.textSecondary} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetBody}>
          <StatusBands />
          {switchError ? <Banner tone="error" text={switchError} testID="bant-tesis-gecisi" /> : null}
          {allowed ? children : <Banner tone="error" icon="lock-closed-outline" text="Bu bölümü görme yetkiniz yok" />}
        </ScrollView>
      </View>
    </View>
  );
}

/** Her ekranın kabı: büyük başlık, bantlar, kaydırma ve aşağı çek-yenile; izin kapısı. */
export function Screen({ title: titleProp, module, children, back, onRefresh, refreshing, headerRight: headerRightProp, subtitle, titleRight, sheet }: ScreenProps) {
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
  // "Sorun bildir" yalnız destek AÇIKKEN ve destek ekranlarının dışında (kapalıyken başlık bugünküyle aynı).
  const path = usePathname();
  const sorunBildir = useDestekEtkin() && !path.startsWith("/destek");
  const headerRight = sorunBildir ? <>{headerRightProp}<SorunBildirDugmesi /></> : headerRightProp;
  if (sheet && wide) return <SheetScreen title={title} allowed={allowed} onClose={goBack}>{children}</SheetScreen>;
  return (
    // Geniş ekranda yığın animasyonu yok (yanal gezinme); içerik bir kez kısa solmayla girer.
    <Animated.View style={s.screen} entering={wide && !reduced ? FadeIn.duration(durations.instant) : undefined}>
      {/* Geniş ekranda boş bar satırı yok: eylem büyük başlıkla aynı satırda dikey ortalı, üstte yalnız güvenli alan. */}
      <LargeHeader title={title} scrollY={scrollY} topInset={insets.top} onBack={showBack ? goBack : undefined} right={wide ? undefined : headerRight} inline={wide} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.tint} colors={[t.tint]} progressBackgroundColor={t.surface} /> : undefined}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xl, paddingHorizontal: wide ? space.xl : space.l }, wide && { paddingTop: space.s }]}
      >
        <LargeTitle title={title} scrollY={scrollY} subtitle={subtitle} right={wide && headerRight ? <>{titleRight}{headerRight}</> : titleRight} />
        <StatusBands />
        {switchError ? <Banner tone="error" text={switchError} testID="bant-tesis-gecisi" /> : null}
        {allowed ? children : <Banner tone="error" icon="lock-closed-outline" text="Bu bölümü görme yetkiniz yok" />}
      </Animated.ScrollView>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.bg, overflow: "hidden" as const },
  sheetBackdrop: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: space.xl },
  scrim: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
  sheetCard: { width: "100%" as const, maxWidth: 640, maxHeight: "100%" as const, backgroundColor: t.bg, borderRadius: radius.card, overflow: "hidden" as const },
  sheetHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, paddingLeft: space.xl, paddingRight: space.m, paddingVertical: space.m, borderBottomWidth: 1, borderColor: t.separator, backgroundColor: t.surface },
  sheetTitle: { ...typography.title3, color: t.text, flex: 1 },
  sheetClose: { width: TOUCH, height: TOUCH, alignItems: "center" as const, justifyContent: "center" as const },
  sheetBody: { padding: space.xl, paddingTop: space.l },
  content: { paddingTop: space.xs, maxWidth: CONTENT_MAX, width: "100%" as const, alignSelf: "center" as const },
  facility: { ...typography.headline, color: t.text, flexShrink: 1 },
  facilityPress: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs },
  facilitySwitch: { ...typography.footnote, color: t.tint },
  frame: { flex: 1, flexDirection: "row" as const },
  // Yuva içerikten ÖNCE çizilir; zIndex genişleyen panelin içeriğin üstünde kalmasını sağlar.
  railSlot: { zIndex: 1 },
  frameContent: { flex: 1 },
  railFloating: { position: "absolute" as const, top: 0, bottom: 0, left: 0 },
  rail: { borderRightWidth: 1, borderColor: t.separator, backgroundColor: t.surface, paddingRight: space.s, overflow: "hidden" as const },
  railHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, minHeight: TOUCH, marginBottom: space.m },
  railHeadClosed: { justifyContent: "center" as const },
  railToggle: { width: 40, height: 40, borderRadius: radius.control, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const },
  railTitle: { flex: 1, minWidth: 0, gap: 0, paddingLeft: space.s },
  railRule: { height: 1, backgroundColor: t.separator, marginVertical: space.s, marginHorizontal: space.s },
  railItemClosed: { justifyContent: "center" as const, paddingHorizontal: 0 },
  railSection: { ...typography.caption, color: t.textMuted, paddingHorizontal: space.s, marginTop: space.m, marginBottom: space.xs },
  railItem: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.s, borderRadius: radius.control, marginBottom: 2 },
  railText: { ...typography.callout, color: t.text, flex: 1 },
}));
