// Okutma ekranının yük listesi: çuvallar (çuval sırasıyla, sunucudan) + "Çuvalsız" başlığı altında dökme toplar.
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { HandheldLoadState, HandheldRoll, HandheldSack } from '../../../../services/handheldShipment.service';
import { spacing } from '../../../../theme';
import { RollRow, SackCard, SectionTitle } from './LoadItems';
import { EmptyState } from './ui';

type Item = { kind: 'sack'; sack: HandheldSack } | { kind: 'title'; count: number } | { kind: 'roll'; roll: HandheldRoll };

/** Saf düzleştirme — çuvallar önce, dökme toplar başlıkla sonda. */
export function loadItems(state: HandheldLoadState): Item[] {
  const list: Item[] = state.sacks.map((sack) => ({ kind: 'sack', sack }));
  if (state.loose.rolls.length > 0) {
    list.push({ kind: 'title', count: state.loose.rolls.length });
    for (const roll of state.loose.rolls) list.push({ kind: 'roll', roll });
  }
  return list;
}

interface Props {
  state: HandheldLoadState;
  planned: boolean;
  selected: string | null;
  highlight: string | null;
  onSackPress: (s: HandheldSack) => void;
  onSackLongPress: (s: HandheldSack) => void;
  onSackKg: (s: HandheldSack) => void;
}

export function LoadList({ state, planned, selected, highlight, onSackPress, onSackLongPress, onSackKg }: Props) {
  const items = useMemo(() => loadItems(state), [state]);
  return (
    <FlashList
      data={items}
      keyExtractor={(it) => (it.kind === 'sack' ? it.sack.id : it.kind === 'roll' ? it.roll.id : 'loose-title')}
      getItemType={(it) => it.kind}
      extraData={`${selected}|${highlight}`}
      contentContainerStyle={styles.body}
      renderItem={({ item }) => {
        if (item.kind === 'title') return <SectionTitle text="Çuvalsız" count={item.count} />;
        if (item.kind === 'roll') return <RollRow roll={item.roll} highlighted={highlight === item.roll.id} />;
        return (
          <SackCard
            sack={item.sack}
            selected={selected === item.sack.id}
            highlighted={highlight === item.sack.id}
            editable={planned}
            onPress={onSackPress}
            onLongPress={onSackLongPress}
            onKg={onSackKg}
          />
        );
      }}
      ListEmptyComponent={<EmptyState icon="barcode-scan" text={planned ? 'Top okutun ya da çuval açın' : 'Sevkiyat boş'} testID="sevk-okut-bos" />}
    />
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
});
