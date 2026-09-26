import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, RadioButton, Text, TouchableRipple } from 'react-native-paper';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import type { MultiBatchDetails } from '../../../services/subcontractor.service';

type Strategy = 'SEPARATE' | 'MERGE';

/**
 * Seçilen toplar birden çok partiden (409 MULTI_BATCH): varsayılan her parti AYRI sevk (kendi irsaliyesi),
 * birleştirmek açık seçimdir. Ayrı sevkte hepsi birlikte gider ya da hiçbiri (sunucu tek işlemde yazar).
 */
export default function MultiBatchSheet({ details, onDismiss, onConfirm }: {
  details: MultiBatchDetails; onDismiss: () => void; onConfirm: (s: Strategy) => void;
}) {
  const [choice, setChoice] = useState<Strategy>('SEPARATE');
  const oldest = details.batches.find((b) => b.oldest) ?? details.batches[0];
  const option = (value: Strategy, title: string, hint: string) => (
    <TouchableRipple onPress={() => setChoice(value)} accessibilityRole="radio" accessibilityState={{ checked: choice === value }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <RadioButton.Android value={value} status={choice === value ? 'checked' : 'unchecked'} onPress={() => setChoice(value)} />
        <View style={{ flex: 1 }}>
          <Text style={sheet.line}>{title}</Text>
          <Text style={sheet.hint}>{hint}</Text>
        </View>
      </View>
    </TouchableRipple>
  );
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Birden çok parti"
      subtitle={`Seçilen toplar ${details.batches.length} partiden: ${details.batches.map((b) => b.batchNumber).join(', ')}`}
      footer={
        <>
          <Button mode="text" onPress={onDismiss}>Vazgeç</Button>
          <Button mode="contained" onPress={() => onConfirm(choice)}>Gönder</Button>
        </>
      }
    >
      {option('SEPARATE', `Ayrı sevk (${details.batches.length} irsaliye)`, 'Her parti kendi irsaliyesiyle gider; hepsi birlikte ya da hiçbiri.')}
      {option('MERGE', `Birleştir (${oldest?.batchNumber ?? 'en eski parti'})`, 'Toplar en eski partide birleşir, diğer partiler kapanır.')}
    </ModuleSheet>
  );
}
