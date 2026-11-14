// Seçici/sayfa kabı: telefonda bugünkü tam sayfa (alttan kayar); geniş ekranda (≥ WIDE_MIN) saydam Modal + karartma
// üstünde ortalı kart — form rotalarının kartıyla (`Frame.tsx` SheetScreen) aynı görünüm. Android `pageSheet`i
// tanımadığı için tablet aksi halde tam ekran açılır. Kart içinde güvenli alan sıfırdır (kart çentiğe değmez).
import { createContext, useContext, type ReactNode } from "react";
import { Modal, Platform, Pressable, useWindowDimensions, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTokens } from "./theme-context";
import { space, radius, WIDE_MIN } from "./tokens";

const KartIcinde = createContext(false);
const SIFIR = { top: 0, bottom: 0, left: 0, right: 0 } as const;

/** İçerik kartta mı çiziliyor (geniş ekran)? Kartta `flex: 1` yerine içerik boyu kullanılır. */
export function useInSheetCard(): boolean {
  return useContext(KartIcinde);
}

export function ModalSheet(p: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Kart sabit yükseklikte (liste/arama sayfası); verilmezse içerik boyunda, ekranı aşarsa kayar. */
  readonly fill?: boolean;
  /** Karartmaya dokunmak kapatır (yarım form taşımayan seçicilerde). */
  readonly scrimCloses?: boolean;
  /** Telefonda iOS sunum biçimi (Android'de yok sayılır). */
  readonly iosPresentation?: "pageSheet" | "formSheet";
  readonly testID?: string;
}) {
  const wide = useWindowDimensions().width >= WIDE_MIN;
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  if (!wide) {
    return (
      <Modal visible={p.visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? (p.iosPresentation ?? "pageSheet") : undefined} onRequestClose={p.onClose}>
        {p.children}
      </Modal>
    );
  }
  return (
    <Modal visible={p.visible} transparent animationType="fade" statusBarTranslucent onRequestClose={p.onClose}>
      <View style={[s.backdrop, { paddingTop: insets.top + space.l, paddingBottom: insets.bottom + space.l }]} testID={p.testID ? `${p.testID}-kart` : "sayfa-karti"}>
        <Pressable style={[s.scrim, { backgroundColor: t.navy, opacity: t.scheme === "dark" ? 0.7 : 0.4 }]} disabled={!p.scrimCloses}
          onPress={p.onClose} accessible={false} importantForAccessibility="no" />
        <View style={[s.card, p.fill ? s.cardFill : null, t.floatShadow]} accessibilityViewIsModal>
          <SafeAreaInsetsContext.Provider value={SIFIR}>
            <KartIcinde.Provider value={true}>{p.children}</KartIcinde.Provider>
          </SafeAreaInsetsContext.Provider>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: space.xl },
  scrim: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
  card: { width: "100%" as const, maxWidth: 640, maxHeight: "100%" as const, backgroundColor: t.bg, borderRadius: radius.card, overflow: "hidden" as const },
  cardFill: { height: "85%" as const },
}));
