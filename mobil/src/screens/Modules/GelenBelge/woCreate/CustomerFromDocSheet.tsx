// Belgeden İE formu — "müşteri kayıtlı değil" teklifi: tetikleyici düğme + tek kart (ModuleSheet).
// Aday varsa önce "Bunu mu demek istediniz?"; "Hayır" ya da aday yoksa yeni kayıt (ad düzenlenebilir + Kaydet).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../../components/ModuleSheet';
import ModalTextInput from '../../../../components/ModalTextInput';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { OwnerUnmatched } from '../../../../services/inboundDoc.service';
import { NO_PERMISSION_TEXT, useCustomerFromDoc } from './useCustomerFromDoc';

interface Props {
  noteNo: string;
  unmatched: OwnerUnmatched;
  disabled: boolean;
  onPicked: (customerId: string, name: string) => void;
}

const TOUCH = { minHeight: 56 } as const;

export default function CustomerFromDocOffer({ noteNo, unmatched, disabled, onPicked }: Props) {
  const c = useCustomerFromDoc({ unmatched, onPicked });
  const one = unmatched.candidates.length === 1 ? unmatched.candidates[0] : null;
  return (
    <>
      <Button mode="outlined" icon="account-plus-outline" onPress={c.open} disabled={disabled} contentStyle={TOUCH}
        style={styles.trigger} testID={`belge-satir-musteri-ekle-${noteNo}`}>
        {unmatched.candidates.length > 0 ? 'Müşteri kayıtlı değil — seç / ekle' : 'Müşteri kayıtlı değil — ekle'}
      </Button>
      <ModuleSheet
        visible={c.step === 'ask'}
        onDismiss={c.close}
        size="sm"
        title="Bunu mu demek istediniz?"
        subtitle={`Belgede: “${unmatched.text}”`}
        footer={
          <>
            <Button onPress={c.close} contentStyle={TOUCH}>Vazgeç</Button>
            <Button mode={one ? 'outlined' : 'contained'} onPress={c.decline} contentStyle={TOUCH} testID="musteri-ekle-hayir">
              Hayır, yeni kayıt
            </Button>
            {one && (
              <Button mode="contained" onPress={() => c.pick(one.customerId, one.name)} contentStyle={TOUCH} testID="musteri-ekle-evet">
                Evet
              </Button>
            )}
          </>
        }
      >
        {one ? (
          <View style={styles.ask}>
            <Text style={sheet.label}>Kayıtlı benzer müşteri</Text>
            <TruncatedText style={styles.name} testID="musteri-ekle-aday">{one.name}</TruncatedText>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={sheet.label}>Kayıtlı benzer müşteriler — birine dokunun</Text>
            {unmatched.candidates.map((x) => (
              <TouchableRipple key={x.customerId} onPress={() => c.pick(x.customerId, x.name)} style={styles.option}
                accessibilityRole="button" testID={`musteri-ekle-aday-${x.customerId}`}>
                <TruncatedText style={styles.name}>{x.name}</TruncatedText>
              </TouchableRipple>
            ))}
          </View>
        )}
      </ModuleSheet>
      <ModuleSheet
        visible={c.step === 'create'}
        onDismiss={c.close}
        size="sm"
        title="Yeni müşteri kaydı"
        subtitle="Bu müşteri kayıtlı değil; yalnız adla kaydedilir"
        footer={
          <>
            <Button onPress={c.close} disabled={c.busy} contentStyle={TOUCH}>Vazgeç</Button>
            <Button mode="contained" onPress={() => void c.save()} loading={c.busy} disabled={c.busy || !c.canCreate || !c.name.trim()}
              contentStyle={TOUCH} testID="musteri-ekle-kaydet">
              Kaydet
            </Button>
          </>
        }
      >
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
  ask: { gap: spacing.xs },
  list: { gap: spacing.sm },
  option: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
});
