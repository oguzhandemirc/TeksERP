// Canlı okuma (L3) sağ panel: şablonun her başlık alanı = etiket + değer + durum (gri aday / yeşil kilitli / sarı boş /
// gri "Belgede yok"; oy kilidi kendini düzeltince kısa "Düzeltildi"). Kilitli alanda son kareler farklı okuyorsa altında
// "Son karelerde: X" — dokununca X elle kilitlenir. Satıra dokununca düzelt penceresi: elle değer kilitler, "Kilidi aç"
// oylamayı baştan başlatır. Müşteri yalnız bilgidir (forma gitmez; fotoğraftan eşleşir) → düzeltilmez.
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import AppModal from '../../../../components/AppModal';
import ModalTextInput from '../../../../components/ModalTextInput';
import TruncatedText from '../../../../components/TruncatedText';
import { SectionBand, StatusPill, type PillTone } from '../../../../components/form';
import { colors, radius, spacing } from '../../../../theme';
import { isLiveInfoOnly } from './liveLocks';
import { liveProgress } from './liveSummary';
import { liveFieldStatus, liveSuggestion, type LiveField, type LiveVoteState } from './liveVote';

interface Props {
  vote: LiveVoteState;
  onEdit: (key: string, value: string) => void;
  onUnlock: (key: string) => void;
}

type StatusIcon = 'lock' | 'eye-outline' | 'alert-outline' | 'minus-circle-outline' | 'lock-reset';
const STATUS: Record<ReturnType<typeof liveFieldStatus>, { tone: PillTone; text: string; icon: StatusIcon }> = {
  locked: { tone: 'ok', text: 'Kilitli', icon: 'lock' },
  candidate: { tone: 'idle', text: 'Okunuyor', icon: 'eye-outline' },
  empty: { tone: 'warn', text: 'Boş', icon: 'alert-outline' },
  absent: { tone: 'idle', text: 'Belgede yok', icon: 'minus-circle-outline' },
};
const CORRECTED = { tone: 'ok' as PillTone, text: 'Düzeltildi', icon: 'lock-reset' as StatusIcon };
export const LIVE_INFO_PENDING = 'Fotoğraftan eşleşecek';

export default function LiveFieldPanel({ vote, onEdit, onUnlock }: Props) {
  const [editing, setEditing] = useState<LiveField | null>(null);
  const [draft, setDraft] = useState('');
  // Portal içeriği ertelenmiş çizilir: Kaydet bayat kapanıştan değil son yazılan değerden okur.
  const draftRef = useRef('');
  const type = (v: string) => {
    draftRef.current = v;
    setDraft(v);
  };
  const { settled: locked, total } = liveProgress(vote);

  const open = (f: LiveField) => {
    type(f.lock?.value ?? f.candidate ?? '');
    setEditing(f);
  };
  const close = () => setEditing(null);

  return (
    <View style={styles.panel} testID="canli-alan-paneli">
      <SectionBand
        title="Okunan alanlar"
        icon="text-box-search-outline"
        tone={total > 0 && locked === total ? 'ok' : 'idle'}
        aside={total ? `${locked}/${total} tamam` : null}
        style={styles.band}
        testID="canli-alan-baslik"
      />
      {vote.fields.length === 0 ? (
        <Text style={styles.empty}>Belge tanınınca alanlar burada dolar.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {vote.fields.map((f) => (
            <FieldRow key={f.key} field={f} onPress={() => open(f)} onTake={(v) => onEdit(f.key, v)} />
          ))}
        </ScrollView>
      )}
      <AppModal visible={editing !== null} onDismiss={close} contentStyle={styles.dialog}>
        {editing && (
          <View style={styles.dialogBody}>
            <TruncatedText style={styles.dialogTitle}>{editing.label}</TruncatedText>
            <ModalTextInput mode="outlined" value={draft} onChangeText={type} autoFocus testID="canli-alan-girdi" />
            <View style={styles.dialogActions}>
              {editing.lock && (
                <Button mode="outlined" contentStyle={styles.btn} onPress={() => { onUnlock(editing.key); close(); }} testID="canli-alan-kilit-ac">
                  Kilidi aç
                </Button>
              )}
              <Button mode="text" contentStyle={styles.btn} onPress={close}>Vazgeç</Button>
              <Button mode="contained" contentStyle={styles.btn} onPress={() => { onEdit(editing.key, draftRef.current); close(); }} testID="canli-alan-kaydet">
                Kaydet
              </Button>
            </View>
          </View>
        )}
      </AppModal>
    </View>
  );
}

function FieldRow({ field, onPress, onTake }: { field: LiveField; onPress: () => void; onTake: (value: string) => void }) {
  const info = isLiveInfoOnly(field.key);
  const status = liveFieldStatus(field);
  const st = field.lock && field.corrected ? CORRECTED : STATUS[status];
  const value = field.lock?.value ?? field.candidate;
  const tone: PillTone = info ? 'info' : st.tone;
  const empty = status === 'absent' ? 'Belgede yok' : info ? LIVE_INFO_PENDING : '—';
  const suggestion = info ? null : liveSuggestion(field);
  const content = (
    <View style={[styles.row, field.lock && !info && styles.rowLocked]}>
      <View style={styles.rowText}>
        <TruncatedText style={styles.label}>{field.label}</TruncatedText>
        <TruncatedText style={[styles.value, !field.lock && styles.valueCandidate]} testID={`canli-alan-deger-${field.key}`}>
          {value ?? empty}
        </TruncatedText>
      </View>
      <StatusPill tone={tone} icon={info ? 'information-outline' : st.icon} text={info ? 'Bilgi' : st.text} testID={`canli-alan-durum-${field.key}`} />
    </View>
  );
  if (info) return <View testID={`canli-alan-${field.key}`}>{content}</View>;
  return (
    <View>
      <TouchableRipple onPress={onPress} style={styles.touch} accessibilityLabel={`${field.label} düzelt`} testID={`canli-alan-${field.key}`}>
        {content}
      </TouchableRipple>
      {suggestion !== null && (
        <TouchableRipple onPress={() => onTake(suggestion)} style={styles.suggest} accessibilityRole="button"
          accessibilityLabel={`${field.label}: son karelerde ${suggestion}, bunu kullan`} testID={`canli-alan-oneri-${field.key}`}>
          <TruncatedText style={styles.suggestText}>Son karelerde: {suggestion} — dokunun, bunu kullanın</TruncatedText>
        </TouchableRipple>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Şerit modal kartının sağ üst köşesine oturur: yalnız o köşe yuvarlak, diğerleri düz.
  band: { borderRadius: 0, borderTopRightRadius: radius.lg },
  panel: { flex: 1, backgroundColor: colors.surface, gap: spacing.sm, paddingBottom: spacing.sm },
  empty: { padding: spacing.lg, fontSize: 14, color: colors.textSecondary },
  list: { gap: spacing.sm, paddingHorizontal: spacing.sm },
  touch: { borderRadius: radius.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  rowLocked: { borderColor: colors.success },
  rowText: { flex: 1 },
  label: { fontSize: 12, color: colors.textSecondary },
  value: { fontSize: 16, fontWeight: '700', color: colors.text },
  valueCandidate: { fontWeight: '400', color: colors.textMuted },
  suggest: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningContainer, marginTop: spacing.xs },
  suggestText: { fontSize: 14, color: colors.warningText },
  dialog: { width: 480, maxWidth: '94%', borderRadius: radius.lg, padding: spacing.lg },
  dialogBody: { gap: spacing.md },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  btn: { minHeight: 56 },
});
