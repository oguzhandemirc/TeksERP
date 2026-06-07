import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenChrome from '../../../components/ScreenChrome';
import NewWorkOrderView from './NewWorkOrderView';
import WorkOrderListView from './WorkOrderListView';
import WorkOrderDetailSheet from './WorkOrderDetailSheet';
import { colors, spacing, radius } from '../../../theme';

type View2 = 'list' | 'new';

export default function HizliIsEmriScreen() {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View2>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <ScreenChrome
      title="Hızlı İş Emri"
      subtitle={view === 'new' ? 'Yeni iş emri' : undefined}
      onStepBack={view === 'new' ? () => setView('list') : undefined}
    >
      <View style={styles.root}>
        {view === 'new' ? (
          <NewWorkOrderView />
        ) : (
          <>
            <View style={styles.listWrap}>
              <WorkOrderListView onOpen={setDetailId} refreshKey={refreshKey} />
            </View>

            {/* Alt aksiyon çubuğu — KartelaSevk standardı: belirgin dolgulu primary. */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
              <View style={styles.barContent}>
                <TouchableRipple
                  onPress={() => setView('new')}
                  style={styles.newBtn}
                  rippleColor="rgba(255,255,255,0.25)"
                  accessibilityLabel="Yeni iş emri"
                >
                  <View style={styles.newBtnInner}>
                    <Icon source="plus-circle" size={26} color="#fff" />
                    <Text style={styles.newBtnText}>Yeni İş Emri</Text>
                  </View>
                </TouchableRipple>
              </View>
            </View>
          </>
        )}
      </View>

      <WorkOrderDetailSheet
        workOrderId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  listWrap: { flex: 1 },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  barContent: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  newBtn: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  newBtnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
