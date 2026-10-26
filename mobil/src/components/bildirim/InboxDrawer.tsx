// Sağ çekmecede gelen kutusu (telefon ve tablet aynı çekmece). Son hâl önbellekten (persist) çizilir;
// ağsızken liste görünür, eylemler bağlantı ister.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RightPanelDrawer } from '../RightPanelDrawer';
import InboxRow from './InboxRow';
import { useInboxList } from '../../hooks/useInboxQueries';
import type { InboxItem } from '../../services/bildirim/types';
import { colors, spacing } from '../../theme';

export interface InboxDrawerProps {
  visible: boolean;
  onDismiss: () => void;
  onOpenItem: (item: InboxItem) => void;
  onOpenSettings: () => void;
}

export default function InboxDrawer({ visible, onDismiss, onOpenItem, onOpenSettings }: InboxDrawerProps) {
  const insets = useSafeAreaInsets();
  const q = useInboxList(visible);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <RightPanelDrawer visible={visible} onDismiss={onDismiss} insets={insets} title="Bildirimler" maxWidth={520}>
      <View style={styles.fill} testID="kutu-cekmece">
        {/* Liste alanı esner: boş/yükleniyor halinde de tercihler düğmesi altta kalır. */}
        <View style={styles.fill}>
          {q.isLoading && !q.data ? (
            <ActivityIndicator style={styles.pad} />
          ) : items.length === 0 ? (
            <Text style={styles.empty}>{q.isError && !q.data ? 'Bildirimler alınamadı.' : 'Bildirim yok.'}</Text>
          ) : (
            <FlashList
              data={items}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => <InboxRow item={item} onOpen={onOpenItem} />}
              onEndReached={() => {
                if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
              }}
            />
          )}
        </View>
        <Button icon="bell-cog-outline" mode="text" onPress={onOpenSettings} contentStyle={styles.tall}>
          Bildirim tercihleri
        </Button>
      </View>
    </RightPanelDrawer>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  empty: { padding: spacing.lg, color: colors.textMuted, fontSize: 16 },
  tall: { minHeight: 48 },
});
