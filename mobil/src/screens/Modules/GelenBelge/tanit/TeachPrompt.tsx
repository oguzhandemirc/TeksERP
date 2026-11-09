// Tanınmamış belge (fotoğraf bu cihazda) okununca ekran ortasında bir kez sorulur: Tanıt | Vazgeç (kullanıcı 2026-11-09:
// formdaki sarı şerit kaldırıldı). Cevap okuma başına (not + runKey) oturum belleğinde tutulur; yeniden okuma yeniden sorar.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../../components/ModuleSheet';
import { spacing } from '../../../../theme';
import type { TeachEntry } from './useTeachEntry';

export const TEACH_PROMPT_TITLE = 'Belge tanınmadı';
export const TEACH_PROMPT_TEXT = 'Bir kez tanıtın, bu gönderenden gelen sonraki belgeler doğru okunsun.';

const answered = new Set<string>();
/** Test yardımcısı: oturum belleğini boşaltır. */
export const clearTeachPrompts = () => answered.clear();

interface Props {
  entry: Pick<TeachEntry, 'kind' | 'noPhoto' | 'open'>;
  /** Okuma kimliği (not id + runKey): aynı okumada bir kez sorulur. */
  readKey: string;
  /** Sunucu şeridi belgeyi tanınmış sayıyorsa (yerel tanıtma / şablon) false. */
  unrecognized?: boolean;
}

export default function TeachPrompt({ entry, readKey, unrecognized = true }: Props) {
  const [, bump] = useState(0);
  const due = unrecognized && entry.kind === 'untaught' && !entry.noPhoto && !answered.has(readKey);
  const answer = () => { answered.add(readKey); bump((n) => n + 1); };
  return (
    <ModuleSheet
      visible={due}
      size="sm"
      onDismiss={answer}
      title={TEACH_PROMPT_TITLE}
      footer={
        <>
          <Button mode="text" onPress={answer} contentStyle={styles.btn} testID="tanit-sor-vazgec">Vazgeç</Button>
          <Button mode="contained" icon="creation" onPress={() => { answer(); entry.open(); }} contentStyle={styles.btn} testID="tanit-sor-tanit">Tanıt</Button>
        </>
      }
    >
      <Text style={sheet.line} testID="tanit-sor-metin">{TEACH_PROMPT_TEXT}</Text>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({ btn: { minHeight: 56, paddingHorizontal: spacing.sm } });
