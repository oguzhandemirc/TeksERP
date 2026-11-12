// Belgeden İE formu — müşteri seçicisinin "Yeni ekle" kartı (saha 2026-11-10): ilk bakışta YALNIZ ad; "Diğer" başlığına
// dokununca panel kartının önemli alanları aşağı doğru açılır. Yazılan ad listede varsa/benziyorsa önce o gösterilir
// (mükerrer kart doğmasın); birebir aynı ad kaydı kapatır (sunucu ad seddi de 409 verir).
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../../components/ModuleSheet';
import ModalTextInput from '../../../../components/ModalTextInput';
import TruncatedText from '../../../../components/TruncatedText';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import type { PickerOption } from '../../../../components/PickerModal';
import { colors, radius, spacing, typography } from '../../../../theme';
import { NO_PERMISSION_TEXT } from './useCustomerFromDoc';
import { useQuickCustomerAdd } from './useQuickCustomerAdd';
import { QUICK_EXTRA_FIELDS, filledExtraCount } from './quickCustomer';

interface Props {
  visible: boolean;
  /** Seçicinin listesi — eş/benzer ad uyarısı buradan. */
  options: readonly PickerOption[];
  /** Vazgeç: listeye dönülür. */
  onDismiss: () => void;
  /** Yeni kart doğdu ya da listedeki eşi seçildi: formda seçili gelir. */
  onPicked: (customerId: string, name: string) => void;
}

const TOUCH = { minHeight: 56 } as const;

export default function CustomerQuickAddSheet({ visible, options, onDismiss, onPicked }: Props) {
  const q = useQuickCustomerAdd({ options, onCreated: onPicked });
  // Her açılış yeni deneme: boş ad, kapalı "Diğer".
  useEffect(() => {
    if (visible) q.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reset` her çizimde yeni; tetik yalnız açılış
  }, [visible]);
  const close = () => {
    if (!q.busy) onDismiss();
  };
  const filled = filledExtraCount(q.extra);
  const shown = q.hits.exact ? [q.hits.exact] : q.hits.similar;

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={close}
      size="md"
      title="Yeni müşteri"
      footer={
        <>
          <View style={sheet.footerLeft}>
            <Button mode="contained" onPress={close} disabled={q.busy} buttonColor={colors.danger} textColor={colors.textOnDark} contentStyle={TOUCH}
              testID="musteri-yeni-vazgec">
              Vazgeç
            </Button>
          </View>
          <Button mode="contained" onPress={() => void q.save()} buttonColor={colors.successDark} loading={q.busy}
            disabled={q.busy || !q.canCreate || !q.name.trim() || !!q.hits.exact} contentStyle={TOUCH} testID="musteri-yeni-kaydet">
            Kaydet ve seç
          </Button>
        </>
      }
    >
      <Text style={sheet.label}>Müşteri adı</Text>
      <ModalTextInput mode="outlined" value={q.name} onChangeText={q.setName} autoCapitalize="characters" maxLength={100} autoFocus
        style={sheet.input} testID="musteri-yeni-ad" />
      {q.hits.exact && <NoticeStrip tone="warn" text="Bu adla kayıtlı müşteri var — listedekini seçin." testID="musteri-yeni-mukerrer" />}
      {!q.hits.exact && shown.length > 0 && <Text style={sheet.label}>Benzer adlı kayıtlı müşteriler — doğruysa dokunun</Text>}
      {shown.map((o) => (
        <TouchableRipple key={o.value} onPress={() => onPicked(o.value, o.label)} style={styles.option} rippleColor="rgba(15,23,42,0.08)"
          accessibilityRole="button" accessibilityLabel={`${o.label} seç`} testID={`musteri-yeni-benzer-${o.value}`}>
          <View style={styles.optionRow}>
            <Icon source="account-outline" size={22} color={colors.brand} />
            <View style={styles.optionName}>
              <TruncatedText style={styles.name}>{o.label}</TruncatedText>
            </View>
            <Icon source="chevron-right" size={24} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
      ))}

      <TouchableRipple onPress={() => q.setOtherOpen(!q.otherOpen)} style={styles.other} accessibilityRole="button"
        accessibilityState={{ expanded: q.otherOpen }} accessibilityLabel="Diğer bilgiler" testID="musteri-yeni-diger">
        <View style={styles.optionRow}>
          <Icon source={q.otherOpen ? 'chevron-up' : 'chevron-down'} size={26} color={colors.text} />
          <View style={styles.optionName}>
            <Text style={styles.otherTitle}>Diğer</Text>
            <Text style={styles.otherHint}>
              {filled > 0 ? `${filled} alan dolu` : 'Vergi no, yetkili, telefon, e-posta, adres (isteğe bağlı)'}
            </Text>
          </View>
        </View>
      </TouchableRipple>
      {q.otherOpen && (
        <View style={sheet.row} testID="musteri-yeni-diger-alanlar">
          {QUICK_EXTRA_FIELDS.map((f) => (
            <View key={f.key} style={sheet.col}>
              <Text style={sheet.label}>{f.label}</Text>
              <ModalTextInput mode="outlined" value={q.extra[f.key] ?? ''} onChangeText={(v) => q.setField(f.key, v)} maxLength={f.max}
                keyboardType={f.keyboard} autoCapitalize={f.keyboard === 'email-address' ? 'none' : f.upper ? 'characters' : 'sentences'}
                multiline={f.multiline} style={sheet.input} testID={`musteri-yeni-${f.key}`} />
            </View>
          ))}
        </View>
      )}

      {!q.canCreate && <Text style={sheet.error} testID="musteri-yeni-yetki-yok">{NO_PERMISSION_TEXT}</Text>}
      {q.canCreate && q.error && <Text style={sheet.error} testID="musteri-yeni-hata">{q.error}</Text>}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionName: { flex: 1, minWidth: 0 },
  name: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  // "Diğer" açılır başlığı: dolu zemin, ≥56dp; kapalıyken neyin içinde olduğunu ipucu söyler.
  other: { minHeight: 56, justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  otherTitle: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  otherHint: { fontSize: typography.size.sm, color: colors.textSecondary },
});
