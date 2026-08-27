import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { SETTINGS_COLORS as C } from '../screens/Common/settings/settingsUi';
import type { NotTip, SurumNotuYayini } from '../services/surumNotlari';

const dateFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Madde türünün ikon + rengi. Markdown paketi EKLENMEDİ (paket onayı ister ve
 * gereksiz): not verisi yapısal olduğu için zengin görünüm buradan geliyor.
 */
const TIP_GORUNUM: Record<NotTip, { ikon: string; renk: string }> = {
  yeni: { ikon: 'star-four-points', renk: '#4ade80' },
  iyilestirme: { ikon: 'arrow-up-bold-circle', renk: '#60a5fa' },
  duzeltme: { ikon: 'wrench', renk: '#fbbf24' },
};

function tarihBasligi(id: string): string {
  const t = new Date(id.slice(0, 10));
  return Number.isNaN(t.getTime()) ? id : dateFmt.format(t);
}

/** Tek bir yayın turunun kartı — hem açılış modalında hem Ayarlar ekranında. */
export function SurumNotuKarti({ yayin }: { yayin: SurumNotuYayini }) {
  return (
    <View style={s.kart}>
      <Text style={s.baslik}>{yayin.baslik}</Text>
      <Text style={s.tarih}>
        {tarihBasligi(yayin.id)}
        {yayin.surumler?.tablet ? ` · Sürüm ${yayin.surumler.tablet}` : ''}
      </Text>

      {yayin.maddeler.map((m, i) => {
        const g = TIP_GORUNUM[m.tip];
        return (
          <View key={i} style={s.satir}>
            <Icon source={g.ikon} size={18} color={g.renk} />
            <Text style={s.metin}>{m.metin}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  kart: {
    backgroundColor: C.bgSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
  },
  baslik: { color: C.text, fontSize: 16, fontWeight: '700' },
  tarih: { color: C.subtext, fontSize: 12, marginTop: 2, marginBottom: 12 },
  satir: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  metin: { color: C.text, fontSize: 14, lineHeight: 20, flex: 1 },
});
