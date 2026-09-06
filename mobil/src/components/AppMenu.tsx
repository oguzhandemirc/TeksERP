// =============================================================================
// AppMenu — RN ÇEKİRDEK `Modal` tabanlı açılır menü (paper `Menu` YERİNE)
// =============================================================================
// NEDEN VAR: react-native-paper `Menu`, Fabric'te (RN 0.81 / paper 5.15) profil
// menüsü açılırken `Maximum update depth exceeded` ile çöküyordu — yığın
// `Menu > Portal > PortalConsumer`. Paper Menu, kartın boyutunu `onLayout` ile
// ölçüp state'e yazar, o state yeni bir layout doğurur ve Fabric'in senkron
// ölçüm/commit sırasında bu tur kendini besler (paper #4754/#4807/#3395).
// SM-X230'da HER basışta, eski tablette ARALIKLI çöküyordu.
//
// DÖNGÜNÜN YAPISAL İMKÂNSIZLIĞI (bu dosyanın tek sözü):
//   1. ÖLÇÜM YALNIZ `visible` false→true GEÇİŞİNDE, TEK SEFER yapılır
//      (aşağıdaki `useEffect`, bağımlılık dizisi SADECE [visible]).
//   2. Ölçüm sonucu (`anchorRect`) state'e yazılır; bu state DEĞİŞİMİ hiçbir
//      yeni ölçüm TETİKLEMEZ — effect `anchorRect`'e bakmaz.
//   3. MENÜ KARTI HİÇ ÖLÇÜLMEZ. Kart tek kenarından çivilenir, karşı kenarına
//      `maxWidth`/`maxHeight` konur (bkz. appMenuLayout.ts). Kartın boyutu
//      hesaba girmediği için `onLayout` → state yolu hiç kurulmaz.
// Yani geri besleme kenarı fiziksel olarak yoktur; "derinliği artırdık" değil,
// "kenarı kaldırdık".
//
// NEDEN `AppModal` DEĞİL (modal kuralının gerekçeli muafı): bu bir menü, dialog
// değil — kart TETİĞİN ölçülen dikdörtgenine çivilenir, perde karartmaz ve
// aşağı-sürükleyerek kapanmaz; AppModal'ın üç yerleşimi (center/bottom/right) de
// çapa konumunu ifade edemez. Tetik ile kart AYNI ağaçta durmak zorunda
// (`measureInWindow` çapayı buradan okur); portal içeriği host'a taşırdı.
//
// KAPSAM: yalnız paper `Menu`/`Menu.Item` değiştirildi. `Divider`, `Icon`,
// `TouchableRipple`, `Text`, `Appbar` paper'dan gelmeye DEVAM EDER (sorunsuz).
// Yeni paket EKLENMEDİ (Expo peer tuzağı).
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';

import { colors, radius, spacing } from '../theme/tokens';
import {
  computeAppMenuLayout,
  type AppMenuAnchorRect,
  type AppMenuLayoutOptions,
} from './appMenuLayout';

export interface AppMenuProps {
  visible: boolean;
  /** Arka plana dokunma + Android geri tuşu + item seçimi buraya düşer. */
  onDismiss: () => void;
  /**
   * Tetik. HER ZAMAN normal akışta render edilir (menü kapalıyken de) — konum
   * ondan ölçülür.
   */
  anchor: React.ReactNode;
  children?: React.ReactNode;
  /** Menü kartına ek stil (paper `Menu`'nün `style`'ı ile aynı yer). */
  style?: StyleProp<ViewStyle>;
  /** Konum hesabının eşikleri — nadiren gerekir. */
  layout?: AppMenuLayoutOptions;
  /** Tetik sarmalayıcısına stil (ör. `flex: 1` gereken dropdown'lar). */
  anchorStyle?: StyleProp<ViewStyle>;
}

export interface AppMenuItemProps {
  title: React.ReactNode;
  onPress?: () => void;
  leadingIcon?: string;
  trailingIcon?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

function AppMenuItem({
  title,
  onPress,
  leadingIcon,
  trailingIcon,
  disabled,
  style,
  titleStyle,
}: AppMenuItemProps) {
  return (
    <TouchableRipple
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.item, style]}
    >
      <View style={styles.itemRow}>
        {leadingIcon ? (
          <Icon
            source={leadingIcon}
            size={22}
            color={disabled ? colors.textMuted : colors.textSecondary}
          />
        ) : null}
        <Text
          style={[styles.itemTitle, disabled && styles.itemTitleDisabled, titleStyle]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {trailingIcon ? (
          <Icon
            source={trailingIcon}
            size={20}
            color={disabled ? colors.textMuted : colors.textSecondary}
          />
        ) : null}
      </View>
    </TouchableRipple>
  );
}

function AppMenu({
  visible,
  onDismiss,
  anchor,
  children,
  style,
  layout,
  anchorStyle,
}: AppMenuProps) {
  const anchorRef = useRef<View>(null);
  const [anchorRect, setAnchorRect] = useState<AppMenuAnchorRect | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();

  // ---------------------------------------------------------------------------
  // TEK SEFERLİK ÖLÇÜM — bu dosyanın en kritik 10 satırı.
  //
  // Bağımlılık dizisi SADECE [visible]. `anchorRect` burada OKUNMAZ, yani
  // callback'in yazdığı state effect'i yeniden koşturamaz. Menü açık kaldığı
  // sürece ölçüm bir daha ASLA yapılmaz → paper Menu'yü Fabric'te çökerten
  // ölç→state→layout→ölç turu KURULAMAZ.
  //
  // Kapanışta rect temizlenir ki bir sonraki açılış BAYAT konumla ilk kareyi
  // çizmesin (tetik bu arada kaymış olabilir: 2. satır açıldı, ekran döndü).
  //
  // VARSAYIM: menü KAPALI mount edilir ve kullanıcı dokunuşuyla açılır, yani
  // tetik ölçüm anında çoktan yerleşmiştir. `visible={true}` ile MOUNT edilen bir
  // çağrı yeri eklenirse ölçüm ilk karede (0,0,0,0) dönebilir; sonuç çökme değil,
  // menünün sol üstte açılmasıdır (layout hesabı sıfır dikdörtgeni de güvenli
  // kutuya kırpar). Çözüm rAF ile ÖLÇÜMÜ ERTELEMEKTİR — ikinci bir ölçüm
  // EKLEMEK değil; "tek seferlik ölçüm" sözleşmesi bu dosyanın tamamını taşıyor.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!visible) {
      setAnchorRect(null);
      return;
    }
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchorRect({ x, y, width, height });
    });
  }, [visible]);

  // Ölçüm gelmeden kart ÇİZİLMEZ — (0,0)'da bir kare flaş etmesin.
  const pos = anchorRect
    ? computeAppMenuLayout(anchorRect, { width: winW, height: winH }, layout)
    : null;

  return (
    <View ref={anchorRef} collapsable={false} style={anchorStyle}>
      {anchor}
      <Modal
        visible={visible}
        transparent
        statusBarTranslucent
        animationType="fade"
        // Android donanım geri tuşu.
        onRequestClose={onDismiss}
      >
        {/* Arka plan — dokunuş menüyü kapatır. Karartma YOK: menü bir dialog
            değil, altındaki ekranın devamı; paper Menu de karartmıyordu. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel="Menüyü kapat"
        />
        {pos ? (
          <View
            accessibilityViewIsModal
            style={[
              styles.card,
              {
                ...(pos.left !== undefined ? { left: pos.left } : { right: pos.right }),
                ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              },
              style,
            ]}
          >
            {/* İçerik kartın maxHeight'ını aşarsa kırpılmaz, KAYAR. */}
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

AppMenu.Item = AppMenuItem;

export default AppMenu;

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    minWidth: 180,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    // Android'de gölge elevation'dan, iOS'ta shadow* ailesinden gelir.
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  // paper Menu.Item paritesi: 48dp taban dokunma hedefi. Çağrı yerlerinin
  // `style={{ height: 58 }}` gibi override'ları ÜSTÜNE biner (dizide sonra).
  item: { minHeight: 48, justifyContent: 'center' },
  // `flex: 1` BİLİNÇLİ OLARAK YOK: kabın yüksekliği içerikten (minHeight/height)
  // gelir ve dikey ortalama `item.justifyContent` ile yapılır. flexBasis 0 ile
  // büyütmek, yüksekliği auto olan kapta Yoga'da 0'a çökme riski taşır.
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  itemTitle: { flexShrink: 1, fontSize: 16, color: colors.text },
  itemTitleDisabled: { color: colors.textMuted },
});
