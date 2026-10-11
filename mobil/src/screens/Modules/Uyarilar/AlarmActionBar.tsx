// =============================================================================
// TEZGAH ALARMI — eylem çubuğu (Üstlen · Bırak · Sustur 15/30/60 · Susturmayı kaldır · Not)
// =============================================================================
// Hangi düğmenin çizileceği `lib/loomAlarm/policy` (saf); asıl kapı sunucuda (izin + atomik claim).
// Not girişi ayrı pencerede (`ModuleSheet` + `ModalTextInput`); 500 karakter sunucu sınırıyla aynı.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import { alarmButtons, type LoomAlarmAccess } from '../../../lib/loomAlarm/policy';
import type { LoomAlarmActions } from '../../../hooks/useLoomAlarmActions';
import { SNOOZE_MINUTES, type LoomAlarmItem } from '../../../types/loomAlarm';
import { colors, spacing, typography } from '../../../theme';

const NOTE_MAX = 500;

interface Props {
  alarm: LoomAlarmItem;
  access: Pick<LoomAlarmAccess, 'canAct' | 'canReleaseOthers'>;
  meId: string | null;
  now: number;
  actions: LoomAlarmActions;
}

export default function AlarmActionBar({ alarm, access, meId, now, actions }: Props) {
  const b = alarmButtons(alarm, access, meId, now);
  const [noteOpen, setNoteOpen] = useState(false);
  const busy = actions.busy !== null;
  if (!access.canAct) return null;
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {b.ack && (
          <Button mode="contained" icon="hand-back-right" onPress={() => void actions.ack()} disabled={busy} loading={actions.busy === 'ack'} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>
            Üstlen
          </Button>
        )}
        {(b.release || b.releaseOther) && (
          <Button mode="outlined" icon="hand-back-left-off" onPress={() => void actions.release()} disabled={busy} loading={actions.busy === 'release'} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>
            {b.release ? 'Üstlenmeyi bırak' : 'Başkasının üstlenmesini bırak'}
          </Button>
        )}
        {b.unsnooze && (
          <Button mode="outlined" icon="bell-ring" onPress={() => void actions.unsnooze()} disabled={busy} loading={actions.busy === 'unsnooze'} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>
            Susturmayı kaldır
          </Button>
        )}
        {b.note && (
          <Button mode="outlined" icon="note-plus" onPress={() => setNoteOpen(true)} disabled={busy} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>
            Not ekle
          </Button>
        )}
      </View>
      {b.snooze && (
        <View style={styles.row}>
          <Text style={styles.snoozeLabel}>Sustur:</Text>
          {SNOOZE_MINUTES.map((m) => (
            <Button key={m} mode="outlined" icon="bell-sleep" onPress={() => void actions.snooze(m)} disabled={busy} loading={actions.busy === 'snooze'} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>
              {`${m} dk`}
            </Button>
          ))}
        </View>
      )}
      {b.snooze && <Text style={styles.hint}>Susturma yalnız tekrar çalmayı keser; üst kademeye iletimi durdurmaz.</Text>}
      <NoteSheet visible={noteOpen} busy={actions.busy === 'note'} onDismiss={() => setNoteOpen(false)} onSave={async (t) => (await actions.note(t)) && setNoteOpen(false)} />
    </View>
  );
}

function NoteSheet(p: { visible: boolean; busy: boolean; onDismiss: () => void; onSave: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const close = () => {
    setText('');
    p.onDismiss();
  };
  return (
    <ModuleSheet
      visible={p.visible}
      onDismiss={close}
      title="Alarma not ekle"
      subtitle="Not alarm defterine yazılır; sonradan yalnız geri çekilebilir."
      size="sm"
      footer={
        <View style={styles.row}>
          <Button mode="outlined" onPress={close} style={styles.grow} contentStyle={styles.tall} labelStyle={styles.label}>Vazgeç</Button>
          <Button
            mode="contained"
            onPress={() => void p.onSave(trimmed).then(() => setText(''))}
            disabled={trimmed.length === 0 || p.busy}
            loading={p.busy}
            style={styles.grow}
            contentStyle={styles.tall}
            labelStyle={styles.label}
          >
            Kaydet
          </Button>
        </View>
      }
    >
      <ModalTextInput value={text} onChangeText={setText} label="Not" mode="outlined" multiline maxLength={NOTE_MAX} />
      <Text style={styles.hint}>{`${trimmed.length}/${NOTE_MAX}`}</Text>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  grow: { flexGrow: 1 },
  tall: { minHeight: 56 },
  label: { fontSize: typography.size.base, fontWeight: typography.weight.bold },
  snoozeLabel: { fontSize: typography.size.base, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hint: { fontSize: typography.size.xs, color: colors.textMuted },
});
