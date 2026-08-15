import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TouchableRipple, IconButton, Surface, Icon } from 'react-native-paper';
// paper `Menu` YERİNE — Fabric "Maximum update depth exceeded" ailesi. Bkz. AppMenu.tsx.
import AppMenu from '../../../components/AppMenu';

import { colors, spacing, radius } from '../../../theme';
import type { DraftLine, NewOrderState } from './useNewOrder';

// =============================================================================
// ② KALEMLER — kalem kartları + "Kalem Ekle". Kartın gövdesine dokunmak
// DÜZENLER; sil/kopyala ⋮ menüsündedir (donanım okuması kuralının aynısı:
// sık kullanılan açıkta, ikincil/yıkıcı olan menüde).
// =============================================================================

interface Props {
  state: NewOrderState;
  onAdd: () => void;
  onEdit: (line: DraftLine) => void;
}

export default function StepLines({ state, onAdd, onEdit }: Props) {
  const [menuFor, setMenuFor] = React.useState<string | null>(null);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {state.lines.length === 0 ? (
          <View style={styles.empty}>
            <Icon source="playlist-plus" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>Henüz kalem yok</Text>
            <Text style={styles.emptyHint}>
              Kumaş, renk ve metrajı girerek siparişin ilk kalemini ekleyin.
            </Text>
          </View>
        ) : (
          state.lines.map((l, i) => (
            <Surface key={l.clientId} style={styles.card} elevation={1}>
              <TouchableRipple onPress={() => onEdit(l)} style={styles.cardTouch} borderless>
                <View style={styles.cardInner}>
                  <View style={styles.cardTextCol}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {i + 1}. {l.itemName}
                    </Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {l.colorName ?? 'Ham (renksiz)'}
                      {l.width != null ? ` · ${l.width} cm` : ''}
                    </Text>
                  </View>
                  <Text style={styles.cardQty}>{l.quantity.toLocaleString('tr-TR')} m</Text>
                  <AppMenu
                    visible={menuFor === l.clientId}
                    onDismiss={() => setMenuFor(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        size={22}
                        onPress={() => setMenuFor(l.clientId)}
                      />
                    }
                  >
                    <AppMenu.Item
                      leadingIcon="pencil"
                      title="Düzenle"
                      onPress={() => {
                        setMenuFor(null);
                        onEdit(l);
                      }}
                    />
                    <AppMenu.Item
                      leadingIcon="content-copy"
                      title="Kopyala"
                      onPress={() => {
                        setMenuFor(null);
                        state.duplicateLine(l.clientId);
                      }}
                    />
                    <AppMenu.Item
                      leadingIcon="delete-outline"
                      title="Sil"
                      onPress={() => {
                        setMenuFor(null);
                        state.removeLine(l.clientId);
                      }}
                    />
                  </AppMenu>
                </View>
              </TouchableRipple>
            </Surface>
          ))
        )}

        {/* Mükerrer spec ENGELLENMEZ — aynı kumaş+renk+en'den iki kalem meşru
            olabilir (iki ayrı teslimat). Sessiz de bırakılmaz: yanlışlıkla iki
            kez eklendiyse operatör burada görür. */}
        {state.duplicateSpecs > 0 && (
          <View style={styles.warnBox}>
            <Icon source="alert-outline" size={18} color={colors.warningText} />
            <Text style={styles.warnText}>
              {state.duplicateSpecs} kalem aynı kumaş/renk/en ile tekrarlanıyor. Bilerek
              yaptıysanız sorun yok.
            </Text>
          </View>
        )}

        <Button mode="contained-tonal" icon="plus" onPress={onAdd} style={styles.addBtn} contentStyle={styles.addBtnInner}>
          Kalem Ekle
        </Button>
      </ScrollView>

      {state.lines.length > 0 && (
        <Surface style={styles.totalBar} elevation={2}>
          <Text style={styles.totalLabel}>{state.lines.length} kalem</Text>
          <Text style={styles.totalValue}>{state.totalQty.toLocaleString('tr-TR')} m</Text>
        </Surface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: spacing.md, paddingBottom: spacing.xl },
  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  card: { borderRadius: radius.md, marginBottom: spacing.sm, backgroundColor: colors.surface },
  cardTouch: { borderRadius: radius.md },
  cardInner: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingLeft: spacing.md },
  cardTextCol: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 13, color: colors.textSecondary },
  cardQty: { fontSize: 16, fontWeight: '800', color: colors.brandDark, paddingLeft: spacing.sm },
  warnBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.warningContainer,
    marginBottom: spacing.sm,
  },
  warnText: { flex: 1, minWidth: 0, fontSize: 12, color: colors.text, lineHeight: 17 },
  addBtn: { marginTop: spacing.xs, borderRadius: radius.md },
  addBtnInner: { height: 56 },
  totalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  totalValue: { fontSize: 18, fontWeight: '800', color: colors.text },
});
