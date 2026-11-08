// K30-A1: tek form / toplu satır / masa satırında tanıtma girişi. Okuma özeti `tanitim` TANITILMAMIS → amber şerit
// "Bu belge tanınmadı … [Tanıt]"; TANITILDI → "Şablon: <ad>" satırı + "Tanımı düzenle" düğmesi. Alan yoksa (eski sunucu /
// yerleşik şablon) çizilmez. Parçalar ayrı: tek formda Belge şeridi (`DocHeadBand`) düğmeyi kendi satırına koyar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, spacing, typography } from '../../../../theme';
import { useTeachEntry, type TeachEntry, type TeachEntryInput } from './useTeachEntry';

// Fotoğrafın yerel kopyası yoksa (başka tablet, uygulama yeniden açıldı, eski belgeden yeni İE) yeniden okutmak
// eski belgeye fotoğraf eklemez — doğru yol panel tanıtmasıdır (prova 2026-11-06).
export const TEACH_NO_PHOTO_TEXT = 'Bu belge tanınmadı. Fotoğrafı bu tablette yok — panelde Gelen Belgeler → belge → "Bu belgeyi tanıt".';

/** TANITILMAMIS amber şeridi; foto yoksa eylemsiz açıklama (panel yolu). */
export function TeachStrip({ entry }: { entry: TeachEntry }) {
  if (entry.kind !== 'untaught') return null;
  return (
    <NoticeStrip
      tone="warn"
      icon="alert-circle-outline"
      text={entry.noPhoto ? TEACH_NO_PHOTO_TEXT : 'Bu belge tanınmadı. Bir kez tanıtın, sonrakiler doğru okunsun.'}
      action={entry.noPhoto ? undefined : { label: 'Tanıt', icon: 'creation', onPress: entry.open, testID: 'tanit-serit-ac' }}
      testID="tanit-serit"
    />
  );
}

/** Tanınmış + foto varken ikincil düğme: kendi tipimiz "Tanımı düzenle", hazır şablon "Yeniden tanıt" (yeni tip açar). */
export function TemplateUpdateButton({ entry }: { entry: TeachEntry }) {
  if ((entry.kind !== 'taught' && entry.kind !== 'system') || entry.noPhoto) return null;
  return (
    <Button mode="outlined" icon="file-replace-outline" onPress={entry.open} contentStyle={styles.btn} testID="tanit-serit-guncelle">
      {entry.kind === 'system' ? 'Yeniden tanıt' : 'Tanımı düzenle'}
    </Button>
  );
}

/** "Şablon: <ad>" satırı (TANITILDI). */
export function TemplateName({ entry }: { entry: TeachEntry }) {
  if ((entry.kind !== 'taught' && entry.kind !== 'system') || !entry.templateName) return null;
  return (
    <View style={styles.nameRow} testID="tanit-sablon">
      <Text style={styles.name}>{entry.kind === 'system' ? 'Hazır şablon:' : 'Şablon:'}</Text>
      <View style={styles.flex}>
        <TruncatedText style={styles.name}>{entry.templateName}</TruncatedText>
      </View>
    </View>
  );
}

/** Toplu liste / masa: bugünkü yerleşim (şerit ya da şablon satırı + düğme) parçalardan. */
export default function TeachBanner(props: TeachEntryInput) {
  const entry = useTeachEntry(props);
  if (!entry.kind) return null;
  return (
    <>
      <TeachStrip entry={entry} />
      {(entry.kind === 'taught' || entry.kind === 'system') && (
        <View style={styles.row}>
          <TemplateName entry={entry} />
          <TemplateUpdateButton entry={entry} />
        </View>
      )}
      {entry.modal}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  nameRow: { flex: 1, minWidth: 160, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: typography.size.sm, color: colors.textSecondary },
  flex: { flex: 1 },
  btn: { minHeight: 56 },
});
