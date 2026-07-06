import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
}

/**
 * ScreenChrome'un opsiyonel "2. kat" navbar'ı — birincil bara sığmayan header
 * aksiyonları (chip/buton) için. Dar telefon ekranlarında birincil satır
 * (başlık + geri/ev + profil) zaten dolu olduğunda kullanılır; tablette
 * genelde gerek kalmaz (birincil satırda yer var).
 *
 * Yatayda kayar (ScrollView) — çok chip birikse bile taşma/kırpılma olmaz.
 * Kullanım: `<ScreenChrome secondRow={<>...chip'ler...</>}>`. `secondRow`
 * verilmezse ScreenChrome bu barı hiç render etmez (ekstra yükseklik yok).
 */
export default function HeaderSecondRow({ children }: Props) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Birincil bardan (appbar, #0f172a) bir ton açık — ayrı "kat" hissi verir.
  bar: {
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
