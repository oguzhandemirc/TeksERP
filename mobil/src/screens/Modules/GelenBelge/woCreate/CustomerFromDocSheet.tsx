// Belgeden İE formu — "müşteri kayıtlı değil" teklifi (Gülkesim 2026-11-04; modal 2026-11-05). Okuma bitince kendiliğinden
// açılır (not başına bir kez): benzer kayıt yoksa "Yeni müşteri kaydedilsin mi?", benzer varsa mükerrer kart doğmasın diye
// önce "Bunu mu demek istediniz?". Kapatılırsa satırdaki "öneriyi aç" bağlantısı yeniden açar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../../components/ModuleSheet';
import ModalTextInput from '../../../../components/ModalTextInput';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { OwnerUnmatched } from '../../../../services/inboundDoc.service';
import { NO_PERMISSION_TEXT, useCustomerFromDoc } from './useCustomerFromDoc';
import { useIsCompact } from '../../../../hooks/useDeviceType';

interface Props {
  noteId: string;
  noteNo: string;
  unmatched: OwnerUnmatched;
  disabled: boolean;
  onPicked: (customerId: string, name: string) => void;
  /** Satırın müşteri seçicisini (`PickerModal`) açar. */
  onPickFromList: () => void;
}

const TOUCH = { minHeight: 56 } as const;

/**
 * Alt şerit: Vazgeç solda kırmızı, "Listeden seç" sağda; son eylem geniş ekranda en sağda, dar ekranda (el terminali)
 * alt satırda tam genişlik — üç düğme dar ekrana sığmıyor, Vazgeç arkada kalıyordu (saha 2026-11-10).
 */
function OfferFooter({ cancel, fromList, last }: { cancel: React.ReactNode; fromList: React.ReactNode; last: React.ReactNode }) {
  const compact = useIsCompact();
  if (!compact) {
    return (
      <>
        <View style={sheet.footerLeft}>{cancel}</View>
        {fromList}
        {last}
      </>
    );
  }
  return (
    <View style={styles.stack} testID="musteri-ekle-alt-dar">
      <View style={styles.row}>{cancel}<View style={styles.spacer} />{fromList}</View>
      {last}
    </View>
  );
}

export default function CustomerFromDocOffer({ noteId, noteNo, unmatched, disabled, onPicked, onPickFromList }: Props) {
  const c = useCustomerFromDoc({ noteId, unmatched, disabled, onPicked });
  const compact = useIsCompact();
  const fromList = () => {
    c.finish();
    onPickFromList();
  };
  return (
    <>
      <Button mode="text" icon="account-question-outline" onPress={c.open} disabled={disabled} contentStyle={TOUCH}
        style={styles.trigger} testID={`belge-satir-musteri-ekle-${noteNo}`}>
        {`Belgedeki ad: ${unmatched.text} — öneriyi aç`}
      </Button>
      <ModuleSheet
        visible={c.step === 'ask'}
        onDismiss={c.close}
        size="md"
        title="Bunu mu demek istediniz?"
        subtitle={`Belgede “${unmatched.text}” yazıyor`}
        footer={
          <OfferFooter
            cancel={<Button mode="contained" onPress={c.close} buttonColor={colors.danger} textColor={colors.textOnDark} contentStyle={TOUCH} testID="musteri-ekle-vazgec">Vazgeç</Button>}
            fromList={<Button mode="contained-tonal" onPress={fromList} buttonColor={colors.surfaceSunken} textColor={colors.text} contentStyle={TOUCH} testID="musteri-ekle-listeden">Listeden seç</Button>}
            // Mükerrer kart riski: "yeni kaydet" en göze çarpan düğme olmasın — asıl eylem listedeki adaya dokunmak.
            last={<Button mode="outlined" onPress={c.decline} textColor={colors.text} contentStyle={TOUCH} testID="musteri-ekle-hayir">Hiçbiri, yeni kaydet</Button>}
          />
        }
      >
        <View style={styles.list}>
          <Text style={sheet.label}>Benzer adlı kayıtlı müşteriler — doğru olana dokunun</Text>
          {unmatched.candidates.map((x) => (
            <TouchableRipple key={x.customerId} onPress={() => c.pick(x.customerId, x.name)} style={styles.option}
              rippleColor="rgba(15,23,42,0.08)" accessibilityRole="button" accessibilityLabel={`${x.name} seç`} testID={`musteri-ekle-aday-${x.customerId}`}>
              <View style={styles.optionRow}>
                <Icon source="account-outline" size={22} color={colors.brand} />
                {/* Dar ekranda kod adın altına iner: ad satırın tamamını kullanır, kısalmaz. */}
                <View style={styles.optionName}>
                  <TruncatedText style={styles.name}>{x.name}</TruncatedText>
                  {compact && x.code ? <Text style={styles.code}>{x.code}</Text> : null}
                </View>
                {!compact && x.code ? <Text style={styles.code}>{x.code}</Text> : null}
                <Icon source="chevron-right" size={24} color={colors.textSecondary} />
              </View>
            </TouchableRipple>
          ))}
        </View>
      </ModuleSheet>
      <ModuleSheet
        visible={c.step === 'create'}
        onDismiss={c.close}
        size="md"
        title="Yeni müşteri kaydedilsin mi?"
        footer={
          <OfferFooter
            cancel={<Button mode="contained" onPress={c.close} disabled={c.busy} buttonColor={colors.danger} textColor={colors.textOnDark} contentStyle={TOUCH} testID="musteri-ekle-vazgec">Vazgeç</Button>}
            fromList={<Button mode="contained-tonal" onPress={fromList} disabled={c.busy} buttonColor={colors.surfaceSunken} textColor={colors.text} contentStyle={TOUCH} testID="musteri-ekle-listeden">Listeden seç</Button>}
            last={
              <Button mode="contained" onPress={() => void c.save()} buttonColor={colors.successDark} loading={c.busy} disabled={c.busy || !c.canCreate || !c.name.trim()}
                contentStyle={TOUCH} testID="musteri-ekle-kaydet">
                Kaydet ve seç
              </Button>
            }
          />
        }
      >
        <Text style={styles.body} testID="musteri-ekle-govde">
          {'Belgede müşteri adı “'}
          <Text style={styles.bold}>{unmatched.text}</Text>
          {'” okundu. Bu adla kayıtlı müşteri yok. Yeni müşteri olarak kaydedilsin mi?'}
        </Text>
        <Text style={sheet.label}>Müşteri adı</Text>
        <ModalTextInput mode="outlined" value={c.name} onChangeText={c.setName} autoCapitalize="characters" maxLength={100}
          style={sheet.input} testID="musteri-ekle-ad" />
        {!c.canCreate && <Text style={sheet.error} testID="musteri-ekle-yetki-yok">{NO_PERMISSION_TEXT}</Text>}
        {c.canCreate && c.error && <Text style={sheet.error} testID="musteri-ekle-hata">{c.error}</Text>}
      </ModuleSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { alignSelf: 'flex-start', marginTop: spacing.xs },
  stack: { flex: 1, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  list: { gap: spacing.sm },
  body: { fontSize: typography.size.base, color: colors.text, marginBottom: spacing.sm },
  bold: { fontWeight: typography.weight.bold },
  // Aday satırı dokunulabilir kart: dolu zemin + belirgin kenar + sağda ok; ad solda, kod sağda.
  option: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionName: { flex: 1, minWidth: 0 },
  name: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  code: { fontSize: typography.size.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
});
