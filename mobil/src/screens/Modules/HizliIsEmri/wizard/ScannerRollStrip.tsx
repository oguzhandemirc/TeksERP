import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';

import type { ScannedRoll, ScanReject } from '../useQuickWorkOrder';
import { colors, palette } from '../../../../theme';

interface Props {
  rolls: ScannedRoll[];
  totalQty: number;
  onRemove: (barcode: string) => void;
  /** Kabul edilmeyen okumalar — şeridin EN ÜSTÜNDE kırmızı satır olarak durur. */
  rejects: ScanReject[];
  onDismissReject: (id: number) => void;
  /** Az önce mükerrer okutulan barkod — o satır vurgulanır. */
  duplicateBarcode: string | null;
  /** Farklı en okutulduysa satırlarda en de gösterilir (aksi halde gürültü). */
  showWidth: boolean;
}

/**
 * Tarayıcı modalının ALTINDAKİ "son okutulanlar" şeridi.
 *
 * Neden burada ve neden silme tuşu var: yanlış eklenen top, tam da yanlışın
 * yapıldığı yerde — tarayıcıdan çıkmadan — görülüp geri alınabilmeli. Modal
 * kapanınca fark edilen hata operatörü akıştan koparıyor ve pratikte hiç fark
 * edilmiyordu (tek iz, kaybolup giden bir toast'tı).
 *
 * Üç sonucun üçü de burada görünür (bkz. `services/scanFeedback`): kabul edilen
 * yeşil vurguyla en üstte, MÜKERRER olan kendi satırında yanıp söner, RET ise
 * sebebiyle birlikte kırmızı satır olarak ~10 sn durur. Toast bunların hiçbirini
 * yapamaz — 3 sn'de kaybolur ve operatör topu bırakıp döndüğünde ekran boştur.
 *
 * Sıralama YENİDEN ESKİYE. Şeridin işi "en son ne oldu" sorusunu cevaplamaktır,
 * tam envanter dökümü değil (o `ScannedRollsModal`'da).
 */
export default function ScannerRollStrip({
  rolls,
  totalQty,
  onRemove,
  rejects,
  onDismissReject,
  duplicateBarcode,
  showWidth,
}: Props) {
  const recent = [...rolls].reverse();
  const empty = recent.length === 0 && rejects.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Icon source="playlist-check" size={16} color={colors.textOnDarkMuted} />
        <Text style={styles.headText}>Son okutulanlar</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.headTotal}>
          {rolls.length} top · {Math.round(totalQty)} m
        </Text>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Henüz top okutulmadı</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Ret satırları en üstte: en yeni olay onlardır ve operatörün
              görmesi gereken tek şey odur. */}
          {rejects.map((r) => (
            <View key={`rej-${r.id}`} style={[styles.row, styles.rowReject]}>
              <Icon source="alert-circle" size={16} color={palette.red[500]} />
              <View style={styles.rejectText}>
                <Text style={styles.rejectBarcode} numberOfLines={1}>
                  {r.barcode}
                </Text>
                <Text style={styles.rejectReason} numberOfLines={1}>
                  {r.reason}
                </Text>
              </View>
              <TouchableRipple
                onPress={() => onDismissReject(r.id)}
                borderless
                style={styles.remove}
                accessibilityLabel={`${r.barcode} uyarısını kapat`}
              >
                <Icon source="close" size={20} color={colors.textOnDarkMuted} />
              </TouchableRipple>
            </View>
          ))}

          {recent.map((r, i) => {
            const dup = duplicateBarcode === r.barcode;
            return (
              <View
                key={r.barcode}
                style={[styles.row, i === 0 && !dup && styles.rowLatest, dup && styles.rowDuplicate]}
              >
                <Text style={styles.barcode} numberOfLines={1}>
                  {r.barcode}
                </Text>
                {dup ? <Text style={styles.dupTag}>zaten listede</Text> : null}
                {showWidth && r.width != null ? (
                  <Text style={styles.width}>{r.width} cm</Text>
                ) : null}
                <Text style={styles.qty}>{Math.round(r.qty)} m</Text>
                <TouchableRipple
                  onPress={() => onRemove(r.barcode)}
                  borderless
                  style={styles.remove}
                  accessibilityLabel={`${r.barcode} topunu listeden çıkar`}
                >
                  <Icon source="close" size={20} color={palette.red[500]} />
                </TouchableRipple>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Yükseklik SABİT: kamera kadrajı top eklendikçe küçülmemeli (BarcodeScannerModal
  // sheet ölçüsünü bu yüksekliğe göre büyütüyor — FOOTER_H ile hizalı).
  root: { height: 156, backgroundColor: palette.slate[900], borderTopWidth: 1, borderTopColor: palette.slate[700] },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.slate[800],
  },
  headText: { color: colors.textOnDarkMuted, fontSize: 12, fontWeight: '700' },
  headTotal: { color: '#fff', fontSize: 13, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: palette.slate[500], fontSize: 13, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingVertical: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.slate[800],
  },
  // En son okutulan satır vurgulu — operatör "az önce ne ekledim"i tek bakışta görür.
  rowLatest: { backgroundColor: 'rgba(16,185,129,0.12)' },
  // Mükerrer: amber. Yeşil (kabul) ile kırmızı (ret) arasında bilinçli bir üçüncü
  // renk — "bir şey oldu ama yeni bir şey eklenmedi".
  rowDuplicate: { backgroundColor: 'rgba(245,158,11,0.22)' },
  rowReject: { backgroundColor: 'rgba(239,68,68,0.16)' },
  barcode: { flex: 1, color: '#fff', fontFamily: 'monospace', fontSize: 13 },
  dupTag: { color: palette.amber[500], fontSize: 11, fontWeight: '800' },
  width: { color: palette.amber[500], fontSize: 12, fontWeight: '700' },
  qty: { color: colors.textOnDarkMuted, fontSize: 13, fontWeight: '700' },
  rejectText: { flex: 1 },
  rejectBarcode: { color: '#fff', fontFamily: 'monospace', fontSize: 13 },
  rejectReason: { color: palette.red[500], fontSize: 11, fontWeight: '700', marginTop: 1 },
  remove: { padding: 9, borderRadius: 999 },
});
