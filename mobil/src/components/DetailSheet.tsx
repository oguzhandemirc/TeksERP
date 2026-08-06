import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import AppModal from './AppModal';
import {
  Text,
  IconButton,
  Icon,
  Surface,
  TouchableRipple,
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

  /** Üst özet kartı (sol sütun). Geçilmezse summary bloğu hiç render edilmez. */
  summary?: SummaryItem[];
  /**
   * İkinci sütun — verilirse ilk section iki sütuna ayrılır (geniş ekranda yan
   * yana, telefonda alt alta). Yeni/ek bilgiler buraya konur.
   */
  summaryAside?: SummaryItem[];
  /** Sol sütun başlığı (opsiyonel — iki sütun modunda anlamlı). */
  summaryTitle?: string;
  /** Sağ (aside) sütun başlığı. */
  asideTitle?: string;

  /** Sheet boyutu — winW/winH oranı. */
  widthRatio?: number;
  heightRatio?: number;

  /** Summary altında ek section'lar (event list, born rolls vb.). */
  children?: React.ReactNode;

  /**
   * Sheet'in ALTINA sabitlenen aksiyon çubuğu — kaydırılmaz. Yıkıcı/ana eylemler
   * (ör. "Stoktan Kaldır") `children` içine konursa uzun bir detayda ekranın
   * dışında kalır ve operatör onları hiç görmez.
   */
  actions?: React.ReactNode;
}

export default function DetailSheet({
  visible,
  onDismiss,
  icon,
  iconColor = '#0f172a',
  title,
  subtitle,
  summary,
  summaryAside,
  summaryTitle,
  asideTitle,
  widthRatio = 0.65,
  heightRatio = 0.85,
  children,
  actions,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();

  const twoCol = !!(summaryAside && summaryAside.length > 0);
  // Telefonda (dar) sütunlar alt alta; tablet/geniş ekranda yan yana.
  const sideBySide = twoCol && winW >= 600;

  const renderSummaryCard = (
    items: SummaryItem[],
    columnTitle?: string,
    flex?: boolean,
  ) => (
    <Surface style={[styles.summary, flex && styles.summaryFlex]} elevation={0}>
      {columnTitle && <Text style={styles.columnTitle}>{columnTitle}</Text>}
      {items.map((item, i) => (
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
  );

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
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
          {(summary?.length || twoCol) && (
            <View style={[styles.columns, sideBySide && styles.columnsRow]}>
              {summary && summary.length > 0 &&
                renderSummaryCard(summary, twoCol ? summaryTitle : undefined, sideBySide)}
              {twoCol && renderSummaryCard(summaryAside!, asideTitle, sideBySide)}
            </View>
          )}
          {children}
        </ScrollView>
        {actions && <View style={styles.actions}>{actions}</View>}
      </View>
    </AppModal>
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

/**
 * Açılır/kapanır section — başlığa basınca içerik toggle olur. Uzun/ikincil
 * içerikleri (yaşam döngüsü vb.) varsayılan kapalı tutmak için. `defaultOpen`
 * verilmezse kapalı başlar.
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <View>
      <TouchableRipple
        borderless
        onPress={() => setOpen((o) => !o)}
        style={styles.collapsibleHeader}
        accessibilityRole="button"
        accessibilityLabel={typeof title === 'string' ? title : undefined}
      >
        <View style={styles.collapsibleHeaderInner}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          <Icon
            source={open ? 'chevron-up' : 'chevron-down'}
            size={22}
            color="#64748b"
          />
        </View>
      </TouchableRipple>
      {open && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
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

  // Sabit alt aksiyon çubuğu — gövde kayarken yerinde kalır.
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },

  columns: { gap: 10 },
  columnsRow: { flexDirection: 'row', alignItems: 'stretch' },

  summary: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  summaryFlex: { flex: 1 },
  columnTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summaryLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    minWidth: 88,
    paddingTop: 1,
  },
  summaryValue: { fontSize: 13, color: '#0f172a', fontWeight: '700', flex: 1 },
  summaryValueMono: { fontFamily: 'monospace' },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginTop: 8 },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  collapsibleHeader: { borderRadius: 8 },
  collapsibleHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  collapsibleTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  collapsibleBody: { gap: 8, marginTop: 4 },
});
