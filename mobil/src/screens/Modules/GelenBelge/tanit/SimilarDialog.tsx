// K30-A3: kayıttan önce "bu belge mevcut bir tipe benziyor" sorusu. Kullanıcı kararı (2026-11-04): aynı inputa giden farklı
// ifadeler farklı belge tiplerinde → her tip ayrı şablon; benzerse ya o tip güncellenir ya bilerek yeni tip açılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import AppModal from '../../../../components/AppModal';
import { colors, spacing, typography } from '../../../../theme';
import type { SimilarTemplate } from '../../../../types/inboundDocTeach';

interface Props {
  similar: readonly SimilarTemplate[] | null;
  /** Güncellenen şablonun adı (güncelle kipi); null = yeni tip. */
  currentName: string | null;
  onSame: (kod: string) => void;
  onNew: () => void;
  onDismiss: () => void;
}

export default function SimilarDialog({ similar, currentName, onSame, onNew, onDismiss }: Props) {
  const first = similar?.[0];
  return (
    <AppModal visible={!!similar && similar.length > 0} onDismiss={onDismiss} contentStyle={styles.box}>
      <View style={styles.body} testID="tanit-benzer">
        <Text style={styles.title}>{first ? `Bu belge “${first.ad}” tipine benziyor` : ''}</Text>
        <Text style={styles.text}>
          Aynı tipse o şablonu bu belgeyle güncelleyin; farklı bir belge tipiyse yeni tip olarak kaydedin.
        </Text>
        {(similar ?? []).map((s) => (
          <Button key={s.kod} mode="contained" icon="file-replace-outline" onPress={() => onSame(s.kod)} contentStyle={styles.btn} testID={`tanit-benzer-guncelle-${s.kod}`}>
            {`Aynı tip — “${s.ad}” güncellensin`}
          </Button>
        ))}
        <Button mode="outlined" icon={currentName ? 'content-save' : 'plus'} onPress={onNew} contentStyle={styles.btn} testID="tanit-benzer-yeni">
          {currentName ? `Hayır — “${currentName}” güncellensin` : 'Yeni tip olarak kaydet'}
        </Button>
        <Button mode="text" onPress={onDismiss} contentStyle={styles.btn} testID="tanit-benzer-vazgec">
          Vazgeç
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  box: { maxWidth: 560, alignSelf: 'center', width: '92%' },
  body: { gap: spacing.md, padding: spacing.lg },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  text: { fontSize: typography.size.base, color: colors.textSecondary },
  btn: { minHeight: 56 },
});
