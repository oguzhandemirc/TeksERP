// Geniş tablet bilgi kartı (2026-11-10, hedef görsel): Müşteri bilgileri | Kumaş bilgileri | "mt kalan".
// Müşteri bölümü tek satır müşteri adı; kendi topta dokununca Kime? seçici, emanette kilitli (sahip). Sipariş karosu
// ve metre şeridi aynen taşındı.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import { colors, palette } from '../../../theme/tokens';

export interface TamburInfoCardProps {
  /** Müşteri adı — emanette malın SAHİBİ, kendi topta Kime? hedefi / "Stok". Etiketin kime basılacağı burada
   *  tekrar edilmez (önizlemede görünür; kullanıcı 2026-11-10). */
  customerName: string;
  owner: { name: string } | null;
  /** Kendi topta Kime? seçicisini açar; emanette null (kilitli). */
  onPickCustomer: (() => void) | null;
  barcode: string | null;
  itemLine: string;
  trail: React.ReactNode;
  remaining: number;
  orders: { count: number; onPress: () => void } | null;
}

export default function TamburInfoCard(p: TamburInfoCardProps) {
  const danger = p.remaining <= 0.001;
  const customer = (
    <View style={s.custInner}>
      <Text style={s.kicker}>MÜŞTERİ BİLGİLERİ</Text>
      <TruncatedText style={s.custName} testID="tambur-musteri-adi">{p.customerName}</TruncatedText>
    </View>
  );
  return (
    <View style={s.card} testID="tambur-bilgi-karti">
      {p.onPickCustomer ? (
        <TouchableRipple onPress={p.onPickCustomer} style={s.cust} testID="tambur-kime" accessibilityRole="button" accessibilityLabel={`Müşteri ${p.customerName}. Değiştir`}>
          {customer}
        </TouchableRipple>
      ) : (
        <View style={s.cust}>{customer}</View>
      )}
      <View style={s.sep} />
      <View style={s.fabric}>
        <Text style={s.kicker}>KUMAŞ BİLGİLERİ</Text>
        <View style={s.fabricTitleRow}>
          {!!p.barcode && <Text style={s.barcode} numberOfLines={1}>{p.barcode}</Text>}
          {p.owner && <Text style={s.ownTag}>MÜŞTERİ KUMAŞI</Text>}
        </View>
        <Text style={s.itemLine} numberOfLines={1}>{p.itemLine}</Text>
        {p.trail}
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
        <View style={[s.tile, danger ? s.tileDanger : s.tileGreen]} testID="tambur-kalan">
          <Text style={s.tileValue}>{p.remaining.toFixed(1)}</Text>
          <Text style={s.tileSub}>mt kalan</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: palette.white, borderRadius: 14, padding: 14, gap: 14, borderWidth: 1, borderColor: palette.slate[200] },
  cust: { width: '26%', borderRadius: 10 },
  custInner: { gap: 4, paddingVertical: 2 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.textMuted },
  custName: { fontSize: 24, fontWeight: '900', color: palette.slate[900] },
  sep: { width: 1, backgroundColor: palette.slate[200] },
  fabric: { flex: 1, gap: 3, minWidth: 0 },
  fabricTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  barcode: { fontSize: 22, fontWeight: '900', color: palette.slate[900] },
  ownTag: { fontSize: 13, fontWeight: '800', color: palette.slate[700], letterSpacing: 0.5 },
  itemLine: { fontSize: 14, color: palette.slate[600] },
  tiles: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  tile: { minWidth: 130, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  tileInner: { alignItems: 'center' },
  tileGreen: { backgroundColor: palette.emerald[700] },
  tileDanger: { backgroundColor: palette.red[700] },
  tileOrders: { backgroundColor: palette.amber[600], minWidth: 90 },
  tileValue: { fontSize: 34, fontWeight: '900', color: palette.white },
  tileSub: { fontSize: 13, fontWeight: '700', color: palette.white },
});
