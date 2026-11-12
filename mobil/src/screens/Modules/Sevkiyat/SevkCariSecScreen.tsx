// Yeni Sevk → cari seçimi (tam ekran): üstte arama, alt alta cariler. Seçimde sunucuda boş PLANNED sevkiyat açılır
// (A1, clientToken deneme başına) ve okutma ekranına geçilir. Çift dokunuş tek istek atar.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import TruncatedText from '../../../components/TruncatedText';
import { SkeletonList } from '../../../components/motion';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { customerService } from '../../../services/customer.service';
import type { Customer } from '../../../types/models';
import type { MainStackParamList } from '../../../navigation/types';
import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { CariHoldBlockedScreen } from './CariHold';
import { useOpenShipment } from './elSevk/useOpenShipment';
import { EmptyState, FilledButton, ui } from './elSevk/ui';

const PAGE_SIZE = 50;

function CustomerRow({ customer, pending, disabled, onPress }: { customer: Customer; pending: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} disabled={disabled} style={[ui.card, styles.row]} borderless accessibilityRole="button" testID={`sevk-cari-${customer.code}`}>
      <View style={styles.rowInner}>
        <View style={styles.rowText}>
          <TruncatedText style={ui.primary}>{customer.name}</TruncatedText>
          <Text style={ui.secondary}>{customer.code}</Text>
        </View>
        {pending ? <ActivityIndicator color={colors.textMuted} /> : <Icon source="chevron-right" size={24} color={colors.textMuted} />}
      </View>
    </TouchableRipple>
  );
}

export default function SevkCariSecScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [text, setText] = useState('');
  const term = useDebouncedValue(text.trim(), 300);
  const open = useOpenShipment((p) => nav.replace('SevkOkut', p));

  const q = useInfiniteQuery({
    queryKey: ['customers', 'sevk-cari-sec', term] as const,
    queryFn: ({ pageParam }) =>
      customerService.getAll({ page: pageParam, pageSize: PAGE_SIZE, sortBy: 'name', sortOrder: 'asc', search: term || undefined, filters: { isActive: 'true' } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : null),
    staleTime: 60_000,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);

  return (
    <ScreenChrome title="Cari seç" onBack={() => nav.goBack()}>
      <View style={styles.searchBox}>
        <View style={styles.field}>
          <Icon source="magnify" size={22} color={colors.textMuted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Cari ara"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            style={styles.input}
            testID="sevk-cari-ara"
          />
        </View>
      </View>
      {q.isLoading ? (
        <SkeletonList count={8} style={styles.body} />
      ) : q.isError && items.length === 0 ? (
        <View style={styles.error}>
          <Text style={ui.secondary}>{(q.error as Error)?.message || 'Cariler alınamadı'}</Text>
          <FilledButton label="Tekrar dene" tone="neutral" icon="refresh" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <CustomerRow customer={item} pending={open.pendingId === item.id} disabled={open.pendingId !== null} onPress={() => void open.pick(item.id)} />
          )}
          ListEmptyComponent={<EmptyState icon="account-search-outline" text={term ? 'Aramaya uyan cari yok' : 'Aktif cari yok'} />}
          ListFooterComponent={q.isFetchingNextPage ? <SkeletonList count={2} /> : null}
        />
      )}
      <CariHoldBlockedScreen block={open.hold} onClose={open.closeHold} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  searchBox: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, ...shadow.sm },
  input: { flex: 1, fontSize: typography.size.base, color: colors.text, paddingVertical: spacing.sm },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  row: { marginBottom: spacing.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  error: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
});
