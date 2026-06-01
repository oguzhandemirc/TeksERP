import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import RNModal from 'react-native-modal';
import { useFullscreenModalProps } from '../hooks/useFullscreenModalProps';
import {
  Text,
  IconButton,
  Icon,
  Surface,
} from 'react-native-paper';

// =============================================================================
// DetailSheet — bir kaydın detayını gösteren modal'ların ortak kabuğu.
//
// Yapı:
//   ┌─────────────────────────────────────────┐
//   │ [icon] title (monospace)        [close] │  ← header
//   │        subtitle                          │
//   ├─────────────────────────────────────────┤
//   │ [icon] label:           value           │  ← summary card (opsiyonel)
//   │ [icon] label:           value           │
//   │ ...                                     │
//   │                                         │
//   │ children (custom section'lar)           │  ← scroll içinde
//   └─────────────────────────────────────────┘
//
// Modal-spesifik içerikler (event log, born rolls vb.) children olarak yazılır;
// header yardımcıları (`SectionTitle`, `MutedText`) export edilir.
// =============================================================================

export interface SummaryItem {
  icon: string;
  label: string;
  /** String veya React node (örn. monospace barkod, custom Chip). */
  value: React.ReactNode;
  /** True ise value monospace font ile render edilir. */
  monospaceValue?: boolean;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;

  /** Başlık satırı — title genelde barkod/kart no (monospace). */
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;

  /** Üst özet kartı. Geçilmezse summary bloğu hiç render edilmez. */
  summary?: SummaryItem[];

  /** Sheet boyutu — winW/winH oranı. */
  widthRatio?: number;
  heightRatio?: number;

  /** Summary altında ek section'lar (event list, born rolls vb.). */
  children?: React.ReactNode;
}

export default function DetailSheet({
  visible,
  onDismiss,
  icon,
  iconColor = '#0f172a',
  title,
  subtitle,
  summary,
  widthRatio = 0.65,
  heightRatio = 0.85,
  children,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const modalProps = useFullscreenModalProps();
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={styles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      {...modalProps}
    >
      <View
        style={[
          styles.sheet,
          { width: winW * widthRatio, maxHeight: winH * heightRatio },
        ]}
      >
        <View style={styles.header}>
          <Icon source={icon} size={22} color={iconColor} />
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={styles.title}>
              {title}
            </Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            style={{ margin: 0 }}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {summary && summary.length > 0 && (
            <Surface style={styles.summary} elevation={0}>
              {summary.map((item, i) => (
                <View key={i} style={styles.summaryRow}>
                  <Icon source={item.icon} size={14} color="#475569" />
                  <Text style={styles.summaryLabel}>{item.label}:</Text>
                  {typeof item.value === 'string' ? (
                    <Text
                      style={[
                        styles.summaryValue,
                        item.monospaceValue && styles.summaryValueMono,
                      ]}
                    >
                      {item.value}
                    </Text>
                  ) : (
                    <View style={{ flex: 1 }}>{item.value}</View>
                  )}
                </View>
              ))}
            </Surface>
          )}
          {children}
        </ScrollView>
      </View>
    </RNModal>
  );
}

/** Section başlığı — DetailSheet children içinde kullanılır. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** Boş/placeholder metin — italic gri. */
export function MutedText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  title: { fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  scroll: { padding: 14, gap: 10 },

  summary: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', minWidth: 110 },
  summaryValue: { fontSize: 13, color: '#0f172a', fontWeight: '700', flex: 1 },
  summaryValueMono: { fontFamily: 'monospace' },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginTop: 8 },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
});
