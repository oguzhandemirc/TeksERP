// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — sağ sütun kabul sonucu kartı + kamera penceresinde "Numara yaz" şeridi
// =============================================================================
// Sonuç pencere değil kart: saha beklemeden yeni kabule geçer; "Geri gönder" satır eylemi (#830 ret akışı) kartta.
// "Numara yaz": QR okunmuyorsa kayıtlı gövde/levent numarayla bulunur (Kamera arızalı ayarı gerekmeden).
// =============================================================================
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, palette, spacing } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import type { ReceiveDocResult } from '../../../services/devereKabul.service';
import { ds, MAIN_BLUE } from './devereKabul.styles';
import type { BeamCardPrintState } from './useBeamCardPrint';

export type ResultBeam = ReceiveDocResult['orders'][number]['receipt']['beams'][number];

const m = (v: string | null | undefined) => (v == null ? '—' : `${fmtMeters(Number(v))} m`);

/** `onReject` yalnız `mobile:devere-ret` yetkisinde verilir — yoksa satır düğmesi çizilmez.
 *  `cards` (S5t): A6 levent kartı düğmesi; ASK ayarında soru bandı olarak öne çıkar. */
export function ResultCard({ result, onClose, onReject, cards }: { result: ReceiveDocResult; onClose: () => void; onReject?: (b: ResultBeam, order: { id: string; orderNo: string }) => void; cards?: BeamCardPrintState }) {
  return (
    <View style={[ds.card, styles.card]} testID="devere-kabul-sonuc">
      <View style={ds.cardTitleRow}>
        <View style={ds.grow}>
          <Text style={[ds.cardTitle, styles.ok]}>{`Kabul kaydedildi — ${result.docNo}`}</Text>
          <Text style={ds.lineSub}>{`${result.totals.beamCount} levent · ${m(result.totals.lengthM)} · etiketler yazıcıya gönderiliyor`}</Text>
        </View>
        {cards && !cards.ask ? (
          <Button mode="outlined" icon="card-text-outline" onPress={cards.print} loading={cards.printing} disabled={cards.printing} contentStyle={ds.tall} testID="devere-kart-bas">
            {cards.printed ? 'Kartları yeniden bas' : 'Levent kartları'}
          </Button>
        ) : null}
        <Button mode="outlined" onPress={onClose} contentStyle={ds.tall} testID="devere-kabul-sonuc-kapat">Tamam</Button>
      </View>
      {cards?.ask ? (
        <View style={styles.askBand} testID="devere-kart-sor">
          <Icon source="card-text-outline" size={28} color={MAIN_BLUE} />
          <Text style={[ds.grow, styles.askText]}>Kılıfa takılacak A6 levent kartları basılsın mı?</Text>
          <Button mode="contained" icon="printer" buttonColor={MAIN_BLUE} onPress={cards.print} loading={cards.printing} disabled={cards.printing} contentStyle={ds.tall} testID="devere-kart-bas">
            Kartları bas
          </Button>
        </View>
      ) : null}
      <ScrollView>
        {result.orders.map((o) => o.receipt.beams.map((b) => (
          <View key={b.id} style={ds.lineRow}>
            <View style={ds.grow}>
              <Text style={ds.lineName}>{b.beamNo}</Text>
              <Text style={ds.lineSub}>{[o.orderNo, b.physicalBeamNo].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={ds.lineM}>{m(b.lengthM)}</Text>
            {onReject ? (
              <TouchableRipple onPress={() => onReject(b, { id: o.warpingOrderId, orderNo: o.orderNo })} style={ds.rowBtnOrange} borderless accessibilityRole="button" accessibilityLabel={`${b.beamNo} geri gönder`} testID={`devere-ret-satir-${b.beamNo}`}>
                <View style={ds.row}>
                  <Icon source="truck-fast-outline" size={22} color={palette.orange[800]} />
                  <Text style={ds.rowBtnOrangeText}>Geri gönder</Text>
                </View>
              </TouchableRipple>
            ) : null}
          </View>
        )))}
      </ScrollView>
    </View>
  );
}

/** Kamera penceresinin altında elle numara girişi — büyük kutu + Bul. */
export function ManualCodeFooter({ placeholder, onSubmit, testID }: { placeholder: string; onSubmit: (code: string) => void; testID?: string }) {
  const [code, setCode] = useState('');
  const submit = () => {
    const c = code.trim();
    if (!c) return;
    setCode('');
    onSubmit(c);
  };
  return (
    <View style={styles.footer}>
      <Text style={ds.label}>QR okunmuyor mu? Numara yaz</Text>
      <View style={ds.row}>
        <ModalTextInput mode="outlined" value={code} onChangeText={setCode} placeholder={placeholder} autoCapitalize="characters" maxLength={64} onSubmitEditing={submit} returnKeyType="search" style={[ds.bigInput, ds.grow]} testID={testID} />
        <Button mode="contained" icon="magnify" buttonColor={MAIN_BLUE} onPress={submit} disabled={!code.trim()} contentStyle={ds.tall} testID={testID ? `${testID}-bul` : undefined}>Bul</Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: '50%' },
  ok: { color: palette.emerald[700] },
  askBand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 12, backgroundColor: palette.blue[50] },
  askText: { fontSize: 16, fontWeight: '700', color: colors.text },
  footer: { padding: spacing.md, gap: spacing.xs, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
