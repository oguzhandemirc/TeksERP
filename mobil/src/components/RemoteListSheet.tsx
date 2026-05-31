import React from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import RNModal from 'react-native-modal';
import {
  Text,
  IconButton,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';

import RefreshButton from './RefreshButton';
import { AnimatedEntrance, SkeletonList } from './motion';

// =============================================================================
// RemoteListSheet — RNModal + header (icon + title + RefreshButton + close) +
// loading/error/empty/list state geçişleri için ortak modal kabuğu.
//
// Tekrarlanan "uzaktan veri çeken liste modalı" pattern'i için kullanılır.
// Modal-spesifik özellikler (örn. inline pager, cancel overlay) bu generic'e
// taşınmaz — onlar için kendi component'lerini koru.
//
// Kullanım:
//   <RemoteListSheet
//     visible={open} onDismiss={...}
//     title="Bekleyen Sevkler" icon="format-list-bulleted"
//     loading={q.isLoading} fetching={q.isFetching}
//     isError={q.isError} errorMessage={(q.error as Error)?.message}
//     onRefresh={() => q.refetch()}
//     items={items} keyExtractor={(i) => i.id}
//     renderItem={(item) => <Row item={item} onPress={...} />}
//     emptyText="Kayıt yok"
//   />
// =============================================================================

interface Props<T> {
  visible: boolean;
  onDismiss: () => void;

  // Başlık satırı
  title: string;
  icon?: string;
  iconColor?: string;
  /** Header arkaplan rengi — başlığa hafif renkli ton vermek için (örn. #dbeafe).
   *  Verilmezse beyaz (default). */
  headerTint?: string;

  // Veri kaynağı — query'nin parçalanmış hali (test edilebilir + framework-agnostic)
  loading: boolean;
  fetching: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRefresh: () => void;

  // Liste
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactElement;
  /** FlashList yerine ScrollView render etmek için (küçük listelerde estetik
   *  amaçlı). Default false. */
  useScrollView?: boolean;

  // Boş durum
  emptyIcon?: string;
  emptyText?: string;
  emptyHint?: string;

  // Header altında opsiyonel bilgi banner'ı (örn. "Refakat kartı yoksa ...")
  hint?: { text: string; icon?: string };

  // Sheet boyutları — winW/winH oranı
  widthRatio?: number;
  heightRatio?: number;

  // Header'a ekstra aksiyon (refresh/close öncesi) — küçük ikon/chip için.
  // Tab bar gibi tam genişlik kullanan UI için `subHeader` kullan.
  headerExtras?: React.ReactNode;
  // Header satırının ALTINA, hint/listenin üstüne render edilen tam genişlik
  // slot (örn. sub-tab bar). Telefonda header'a sığmayan UI buraya konur.
  subHeader?: React.ReactNode;
  // Liste altına opsiyonel footer (pager, toplam vb.)
  footer?: React.ReactNode;

  // İç container stili override (padding vb.)
  contentStyle?: StyleProp<ViewStyle>;

  /** Sheet'in üstüne absolute fill olarak render edilen overlay (örn. detay
   *  modal). Aynı RNModal portal'ı içinde olduğu için iki ayrı RNModal'ın
   *  çakışmasını engeller. */
  overlay?: React.ReactNode;
}

export default function RemoteListSheet<T>({
  visible,
  onDismiss,
  title,
  icon,
  iconColor = '#0f172a',
  headerTint,
  loading,
  fetching,
  isError = false,
  errorMessage,
  onRefresh,
  items,
  keyExtractor,
  renderItem,
  useScrollView = false,
  emptyIcon,
  emptyText = 'Kayıt yok',
  emptyHint,
  hint,
  widthRatio = 0.85,
  heightRatio = 0.8,
  headerExtras,
  subHeader,
  footer,
  contentStyle,
  overlay,
}: Props<T>) {
  const { width: winW, height: winH } = useWindowDimensions();

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={styles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View
        style={[
          styles.sheet,
          { width: winW * widthRatio, height: winH * heightRatio },
        ]}
      >
        <View
          style={[
            styles.header,
            headerTint ? { backgroundColor: headerTint } : undefined,
          ]}
        >
          {icon && <Icon source={icon} size={22} color={iconColor} />}
          <Text variant="titleMedium" style={styles.title}>
            {title}
          </Text>
          <View style={{ flex: 1 }} />
          {headerExtras}
          <RefreshButton
            onPress={onRefresh}
            refreshing={fetching}
            isError={isError}
            errorMessage={errorMessage}
          />
          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            accessibilityLabel="Kapat"
            style={styles.headerBtn}
          />
        </View>

        {subHeader}

        {hint && (
          <View style={styles.hint}>
            <Icon
              source={hint.icon ?? 'information-outline'}
              size={14}
              color="#475569"
            />
            <Text style={styles.hintText}>{hint.text}</Text>
          </View>
        )}

        <View style={[styles.listBox, contentStyle]}>
          {loading ? (
            <SkeletonList count={7} />
          ) : isError ? (
            <AnimatedEntrance direction="fade" style={styles.empty}>
              <Text style={styles.emptyText}>Liste yüklenemedi</Text>
              {errorMessage && (
                <Text style={styles.emptyHint}>{errorMessage}</Text>
              )}
            </AnimatedEntrance>
          ) : items.length === 0 ? (
            <AnimatedEntrance direction="fade" style={styles.empty}>
              {emptyIcon && (
                <Icon source={emptyIcon} size={48} color="#cbd5e1" />
              )}
              <Text style={styles.emptyText}>{emptyText}</Text>
              {emptyHint && <Text style={styles.emptyHint}>{emptyHint}</Text>}
            </AnimatedEntrance>
          ) : useScrollView ? (
            // FlashList header/footer/scroll davranışı yerine basit ScrollView
            // (küçük listeler için). Her item'ı tek tek render eder.
            <View style={{ flex: 1 }}>
              {items.map((item) => (
                <React.Fragment key={keyExtractor(item)}>
                  {renderItem(item)}
                </React.Fragment>
              ))}
            </View>
          ) : (
            <FlashList
              data={items}
              keyExtractor={keyExtractor}
              renderItem={({ item }) => renderItem(item)}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>

        {footer}

        {/* Sheet'in üstüne absolute fill overlay (detay modal vb.). Aynı
            RNModal portal'ı içinde olduğu için iki RNModal çakışması yok. */}
        {overlay}
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  headerBtn: { margin: 0 },

  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#f1f5f9',
  },
  hintText: { fontSize: 12, color: '#475569', flex: 1, lineHeight: 17 },

  listBox: { flex: 1 },
  listContent: { padding: 8 },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 6,
  },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },
});
