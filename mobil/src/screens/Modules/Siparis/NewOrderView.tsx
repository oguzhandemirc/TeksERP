import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import WizardSteps from '../../../components/WizardSteps';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { useCustomerBranchesEnabled } from '../../../hooks/useFeatureFlags';
import { colors, spacing, radius } from '../../../theme';
import { useNewOrder, type DraftLine } from './useNewOrder';
import StepCustomer from './StepCustomer';
import StepLines from './StepLines';
import StepConfirm from './StepConfirm';
import OrderLineSheet from './OrderLineSheet';

// =============================================================================
// Yeni sipariş sihirbazı (① Müşteri · ② Kalemler · ③ Onay) — "Sipariş"
// ekranının ikinci görünümü. Kabuk (`SiparisScreen`) listeyi ve gezinmeyi
// tutar; burası yalnız formu bilir.
//
// Adım kabukta tutulur ki Appbar geri tuşu bir ADIM geri gitsin, ilk adımda
// listeye dönsün (Hızlı İş Emri ile aynı beklenti).
// =============================================================================

export const NEW_ORDER_STEP_TITLES = ['MÜŞTERİ', 'KALEMLER', 'ONAY'] as const;

interface Props {
  step: number;
  onStepChange: (step: number) => void;
  /** Sipariş açıldı — kabuk listeyi tazeler. */
  onCreated: () => void;
  /** "Listeye dön" — kabuk görünümü değiştirir. */
  onBackToList: () => void;
}

export default function NewOrderView({ step, onStepChange, onCreated, onBackToList }: Props) {
  const state = useNewOrder();
  const online = useOnlineStatus();
  const branchesEnabled = useCustomerBranchesEnabled();

  // null → kapalı; { line: null } → yeni kalem; { line } → düzenleme.
  const [lineSheet, setLineSheet] = useState<{ line: DraftLine | null } | null>(null);

  const goTo = (i: number) => onStepChange(Math.max(0, Math.min(NEW_ORDER_STEP_TITLES.length - 1, i)));

  const block = state.stepBlock(step);
  const done = state.result !== null;

  const onPrimary = () => {
    if (done) {
      state.startNext();
      goTo(1); // müşteri korunuyor → doğrudan kalemlere dön
      return;
    }
    if (step < 2) {
      if (block) {
        Toast.show({ type: 'info', text1: block });
        return;
      }
      goTo(step + 1);
      return;
    }
    if (!online) {
      Toast.show({
        type: 'error',
        text1: 'Çevrimdışısınız',
        text2: 'Sipariş numarasını sunucu üretir — bağlantı gelince tekrar deneyin.',
      });
      return;
    }
    state.submit(branchesEnabled);
  };

  // Sipariş açılır açılmaz listeyi tazele — operatör geri döndüğünde yenisini
  // görsün (kabuk sayacı artırır; liste queryKey'i onu içerir).
  React.useEffect(() => {
    if (state.result) onCreated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result?.id]);

  const primaryLabel = done
    ? 'Yeni Sipariş'
    : step < 2
      ? 'Devam'
      : state.retrying
        ? 'Tekrar Dene'
        : 'Siparişi Oluştur';

  return (
    <View style={styles.root}>
      <WizardSteps titles={NEW_ORDER_STEP_TITLES} current={step} onGoTo={goTo} />

      <View style={styles.content}>
        {step === 0 && <StepCustomer state={state} branchesEnabled={branchesEnabled} />}
        {step === 1 && (
          <StepLines
            state={state}
            onAdd={() => setLineSheet({ line: null })}
            onEdit={(line) => setLineSheet({ line })}
          />
        )}
        {step === 2 && <StepConfirm state={state} branchesEnabled={branchesEnabled} online={online} />}
      </View>

      <View style={styles.footer}>
        {block && step < 2 && !done ? (
          <View style={styles.blockRow}>
            <Icon source="information-outline" size={16} color={colors.textMuted} />
            <Text style={styles.blockText}>{block}</Text>
          </View>
        ) : null}
        <View style={styles.footerRow}>
          {done && (
            <Button
              mode="outlined"
              icon="format-list-bulleted"
              style={styles.secondary}
              contentStyle={styles.btnInner}
              onPress={onBackToList}
            >
              Listeye Dön
            </Button>
          )}
          <Button
            mode="contained"
            icon={done ? 'plus' : step < 2 ? 'arrow-right' : 'check'}
            style={styles.primary}
            contentStyle={styles.btnInner}
            loading={state.submitting}
            disabled={state.submitting || (!done && step === 2 && state.lines.length === 0)}
            onPress={onPrimary}
          >
            {primaryLabel}
          </Button>
        </View>
      </View>

      <OrderLineSheet
        target={lineSheet}
        customerId={state.customerId}
        onDismiss={() => setLineSheet(null)}
        onSave={(line) => {
          const editing = lineSheet?.line;
          if (editing) state.updateLine(editing.clientId, line);
          else state.addLine(line);
          setLineSheet(null);
        }}
        onSaveAndNext={(line) => state.addLine(line)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  content: { flex: 1, backgroundColor: colors.appBg },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  blockText: { flex: 1, minWidth: 0, fontSize: 12, color: colors.textMuted },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  secondary: { flex: 1, minWidth: 0, borderRadius: radius.md },
  primary: { flex: 1, minWidth: 0, borderRadius: radius.md },
  // 56dp dokunma hedefi — eldivenli parmakla basılacak birincil aksiyon.
  btnInner: { height: 56 },
});
