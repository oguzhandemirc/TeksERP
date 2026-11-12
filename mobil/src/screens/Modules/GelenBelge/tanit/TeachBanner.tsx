// K30-A1: tek form / toplu satır / masa satırında tanıtma girişi. Okuma özeti `tanitim` TANITILMAMIS → ortada bir kez
// "Belge tanınmadı" sorusu (`TeachPrompt`) + başlıkta "Tanıt" ikonu; TANITILDI → şablon adı + "Tanımı düzenle" ikonu.
// Fotoğraf bu cihazda yoksa yalnız panel yolunu anlatan amber şerit. Alan yoksa (eski sunucu / yerleşik şablon) çizilmez. Parçalar ayrı: tek formda Belge şeridi (`DocHeadBand`) düğmeyi kendi satırına koyar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Tooltip } from 'react-native-paper';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, spacing, typography } from '../../../../theme';
import TeachPrompt from './TeachPrompt';
import { useTeachEntry, type TeachEntry, type TeachEntryInput } from './useTeachEntry';

// Fotoğrafın yerel kopyası yoksa (başka tablet, uygulama yeniden açıldı, eski belgeden yeni İE) yeniden okutmak
// eski belgeye fotoğraf eklemez — doğru yol panel tanıtmasıdır (prova 2026-11-06).
export const TEACH_NO_PHOTO_TEXT = 'Bu belge tanınmadı. Fotoğrafı bu tablette yok — panelde Gelen Belgeler → belge → "Bu belgeyi tanıt".';

/** Tanınmamış + fotoğraf bu cihazda yok: eylemsiz açıklama (panel yolu). Fotoğraf varsa soru `TeachPrompt`ta. */
export function TeachStrip({ entry }: { entry: TeachEntry }) {
  if (entry.kind !== 'untaught' || !entry.noPhoto) return null;
  return <NoticeStrip tone="warn" icon="alert-circle-outline" text={TEACH_NO_PHOTO_TEXT} testID="tanit-serit" />;
}

/** Düğmenin adı (erişilebilirlik + ipucu): tanınmamış "Tanıt", kendi tipimiz "Tanımı düzenle", hazır şablon "Yeniden tanıt". */
export function templateUpdateLabel(kind: TeachEntry['kind']): string {
  return kind === 'untaught' ? 'Tanıt' : kind === 'system' ? 'Yeniden tanıt' : 'Tanımı düzenle';
}

/** Başlık ikonunun görünümü; foto yoksa / giriş yoksa null. Tanınmamışta soru kapatılsa da tanıtma yolu burada kalır. */
export function templateAction(entry: TeachEntry): { icon: string; label: string; testID: string } | null {
  if (!entry.kind || entry.noPhoto) return null;
  const label = templateUpdateLabel(entry.kind);
  return entry.kind === 'untaught' ? { icon: 'creation', label, testID: 'belge-tanit' } : { icon: 'file-replace-outline', label, testID: 'tanit-serit-guncelle' };
}

/** Foto varken başlıkta tek ikon (56dp; komşu ikonlarla aynı); ad basılı tutunca ipucunda. */
export function TemplateUpdateButton({ entry }: { entry: TeachEntry }) {
  const a = templateAction(entry);
  if (!a) return null;
  return (
    <Tooltip title={a.label}>
      <IconButton icon={a.icon} size={28} iconColor={colors.brand} onPress={entry.open} style={styles.icon}
        accessibilityLabel={a.label} testID={a.testID} />
    </Tooltip>
  );
}

/** Şablon adı (TANITILDI) — önek yok; sığmazsa kısalır, basılı tutunca tam ad. */
export function TemplateName({ entry }: { entry: TeachEntry }) {
  if ((entry.kind !== 'taught' && entry.kind !== 'system') || !entry.templateName) return null;
  return (
    <View style={styles.nameRow} testID="tanit-sablon" accessibilityLabel={`${entry.kind === 'system' ? 'Hazır şablon' : 'Şablon'}: ${entry.templateName}`}>
      <TruncatedText style={styles.name}>{entry.templateName}</TruncatedText>
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
      <View style={styles.row}>
        <TemplateName entry={entry} />
        <TemplateUpdateButton entry={entry} />
      </View>
      <TeachPrompt entry={entry} readKey={`${props.row.noteId}:${props.row.runKey}`} />
      {entry.modal}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  // Tek satırlık belge şeridinde ikonları dışarı itmesin: dar sütunda ad kısalır (tam ad TruncatedText balonunda).
  nameRow: { flex: 1, minWidth: 96 },
  name: { fontSize: typography.size.sm, color: colors.textSecondary },
  icon: { width: 56, height: 56, margin: 0 },
});
