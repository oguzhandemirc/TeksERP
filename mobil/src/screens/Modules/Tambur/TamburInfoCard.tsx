// Geniş tablet künye kartı (2026-11-10/11, kullanıcı KESİN düzen): koyu turuncu zemin, iki satır, sütun ayrımı yok.
// Satır 1: müşteri adı (siyah) · kumaş (koyu mavi) + sağ üstte kompakt "mt kalan" karosu; top kodu gösterilmez.
// Satır 2: metre şeridi kartın tam genişliğinde (karo bu satırın yanını tutmaz). Kendi topta ada dokununca Kime?.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import { palette } from '../../../theme/tokens';

export interface TamburInfoCardProps {
  /** Müşteri adı — emanette malın SAHİBİ, kendi topta Kime? hedefi / "Stok". */
  customerName: string;
  owner: { name: string } | null;
  /** Kendi topta Kime? seçicisini açar; emanette null (kilitli). */
  onPickCustomer: (() => void) | null;
  itemLine: string;
  trail: React.ReactNode;
  remaining: number;
  orders: { count: number; onPress: () => void } | null;
}

const OWN_TAG = 'MÜŞTERİ KUMAŞI';
// Büyük harf karşılaştırması: İ/I farkını eşitle (toLocaleUpperCase('tr') yasak).
const norm = (t: string) => t.toUpperCase().replace(/İ/g, 'I');

/** "MÜŞTERİ KUMAŞI" yalnız bir kez: kumaş satırı zaten içeriyorsa etiket basılmaz. */
export function showOwnTag(owner: { name: string } | null, itemLine: string): boolean {
  return !!owner && !norm(itemLine).includes(norm(OWN_TAG));
}

export default function TamburInfoCard(p: TamburInfoCardProps) {
  const danger = p.remaining <= 0.001;
  const name = <TruncatedText style={s.custName} testID="tambur-musteri-adi">{p.customerName}</TruncatedText>;
  return (
    <View style={s.card} testID="tambur-bilgi-karti">
      <View style={s.row1}>
        <View style={s.idLine}>
          {p.onPickCustomer ? (
            <TouchableRipple onPress={p.onPickCustomer} style={s.cust} testID="tambur-kime" accessibilityRole="button" accessibilityLabel={`Müşteri ${p.customerName}. Değiştir`}>
              {name}
            </TouchableRipple>
          ) : (
            <View style={s.cust}>{name}</View>
          )}
          {showOwnTag(p.owner, p.itemLine) && <Text style={s.ownTag}>{OWN_TAG}</Text>}
          <Text style={s.itemLine} numberOfLines={1}>{p.itemLine}</Text>
        </View>
        <View style={s.tiles}>
          {p.orders && (
            <TouchableRipple onPress={p.orders.onPress} borderless style={[s.tile, s.tileOrders]} accessibilityLabel="Siparişler">
              <View style={s.tileInner}>
                <Text style={s.tileValue}>{p.orders.count}</Text>
                <Text style={s.tileSub}>sipariş</Text>
              </View>
            </TouchableRipple>
          )}
          <View style={[s.tile, !p.orders && s.tileLast, danger ? s.tileDanger : s.tileGreen]} testID="tambur-kalan">
            <Text style={s.tileValue}>{p.remaining.toFixed(1)}</Text>
            <Text style={s.tileSub}>mt kalan</Text>
          </View>
        </View>
      </View>
      {p.trail ? <View style={s.row2}>{p.trail}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: palette.orange[600], borderRadius: 14, overflow: 'hidden' },
  row1: { flexDirection: 'row', alignItems: 'stretch' },
  idLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 14, paddingHorizontal: 14, paddingTop: 6 },
  cust: { borderRadius: 8, maxWidth: '45%' },
  custName: { fontSize: 24, fontWeight: '900', color: palette.black },
  ownTag: { fontSize: 13, fontWeight: '800', color: palette.blue[950], letterSpacing: 0.5 },
  itemLine: { fontSize: 16, fontWeight: '700', color: palette.blue[950], flexShrink: 1 },
  row2: { paddingHorizontal: 14, paddingBottom: 6 },
  // Karo kartın üst ve sağ kenarına dayalı; yüksekliği satır 1 kadar.
  tiles: { flexDirection: 'row', alignItems: 'stretch' },
  tile: { minWidth: 104, paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  tileLast: { borderBottomLeftRadius: 12 },
  tileInner: { alignItems: 'center' },
  tileGreen: { backgroundColor: palette.emerald[700] },
  tileDanger: { backgroundColor: palette.red[700] },
  tileOrders: { backgroundColor: palette.amber[600], minWidth: 72, borderBottomLeftRadius: 12 },
  tileValue: { fontSize: 24, fontWeight: '900', color: palette.white, lineHeight: 28 },
  tileSub: { fontSize: 12, fontWeight: '700', color: palette.white },
});
