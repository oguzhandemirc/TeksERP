import React from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import AppModal from './AppModal';
import { IconButton, Text } from 'react-native-paper';
import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * Telefon (compact) modunda sağdan kayan iş paneli. KursunQc ve Tambur
 * gibi tablet'in sağ kolonunu drawer'a taşıyan ekranlar bunu kullanır.
 *
 * `onClosed` (onModalHide) — react-native-modal'ın aynı anda iki modalı doğru
 * stack edememe sorununu çözmek için: buton drawer'ı kapatır, bu callback'te
 * ardışık modal açılır (`pendingAction` queue pattern).
 */
export function RightPanelDrawer({
  visible,
  onDismiss,
  insets,
  title,
  children,
  onClosed,
  widthFactor = 0.9,
  maxWidth = 420,
}: {
  visible: boolean;
  onDismiss: () => void;
  insets: EdgeInsets;
  title: string;
  children: React.ReactNode;
  onClosed?: () => void;
  /** Ekran genişliğinin oranı (telefonda asıl belirleyici). Default 0.9. */
  widthFactor?: number;
  /** Üst sınır (tablet/geniş ekran). Default 420. */
  maxWidth?: number;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const drawerWidth = Math.min(winW * widthFactor, maxWidth);

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      position="right"
      onHidden={onClosed}
    >
      <View
        style={[
          styles.sheet,
          {
            width: drawerWidth,
            height: '100%',
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 12,
            paddingRight: Math.max(insets.right, 8),
          },
        ]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            {title}
          </Text>
          <IconButton
            icon="close"
            size={24}
            onPress={onDismiss}
            accessibilityLabel="Paneli kapat"
          />
        </View>
        {/* TextInput dışındaki boş alana dokunma → klavyeyi kapat. RN standardı:
            TouchableWithoutFeedback aksiyon yutmaz, child Pressable/Button'lar
            normal çalışır; sadece bare View bölgelerine dokunmayı yakalar. */}
        <TouchableWithoutFeedback
          onPress={Keyboard.dismiss}
          accessible={false}
        >
          <View style={styles.content}>{children}</View>
        </TouchableWithoutFeedback>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: { fontWeight: '700', color: '#0f172a', flex: 1 },
  content: { flex: 1, minHeight: 0 },
});
