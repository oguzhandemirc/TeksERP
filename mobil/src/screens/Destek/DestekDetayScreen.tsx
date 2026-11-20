// Talep ayrıntısı — ince kabuk (mantık `useDestekDetay`, balon `MesajBalonu`).
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ConfirmDialog from '../../components/ConfirmDialog';
import { colors, spacing } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import DestekHeader from './DestekHeader';
import MesajBalonu from './MesajBalonu';
import { StatusBadge } from './TicketRow';
import { destekErrorText, TUR_ETIKET } from './destekMetin';
import { useDestekDetay } from './useDestekDetay';
import { useYeniTalepBaslat } from './useSorunBildir';

type D = ReturnType<typeof useDestekDetay>;

function YanitAlani({ d, onYeniTalep }: { d: D; onYeniTalep: () => void }) {
  return (
    <View style={styles.yanitKap}>
      {d.islemHatasi ? (
        <View style={styles.hataSatir}>
          <HelperText type="error" style={styles.hataMetin}>
            {d.islemHatasi.metin}
          </HelperText>
          {d.islemHatasi.yeniTalepOner ? (
            <Button mode="contained" icon="plus" onPress={onYeniTalep}>
              Yeni talep aç
            </Button>
          ) : null}
        </View>
      ) : null}
      <View style={styles.yanitSatir}>
        <TextInput
          mode="outlined"
          placeholder="Yanıt yazın…"
          value={d.yanit}
          onChangeText={d.setYanit}
          multiline
          style={styles.yanitKutu}
        />
        <Button
          mode="contained"
          icon="send"
          onPress={d.yanitGonder}
          disabled={!d.yanitGecerli || d.mesgul !== null}
          loading={d.mesgul === 'yanit'}
          contentStyle={styles.buyuk}
        >
          Gönder
        </Button>
      </View>
    </View>
  );
}

export default function DestekDetayScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'DestekDetay'>>();
  const insets = useSafeAreaInsets();
  const d = useDestekDetay(params.id);
  const yeniTalep = useYeniTalepBaslat();
  const [kapatSor, setKapatSor] = useState(false);
  const t = d.talep;
  const isClosed = t?.status === 'CLOSED';

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.kok, { paddingBottom: insets.bottom }]}>
      <DestekHeader
        baslik={t?.number ?? params.number ?? 'Talep'}
        altBaslik={t ? `${TUR_ETIKET[t.type] ?? t.type} · ${t.subject}` : undefined}
      />
      {d.yukleniyor ? (
        <ActivityIndicator style={styles.orta} />
      ) : !t ? (
        <View style={styles.orta}>
          <Text style={styles.bilgi}>{destekErrorText(d.hata)}</Text>
          <Button mode="outlined" icon="refresh" onPress={d.yenile} contentStyle={styles.buyuk}>
            Tekrar dene
          </Button>
        </View>
      ) : (
        <>
          <View style={styles.durumSatir}>
            <StatusBadge durum={t.status} />
            <View style={styles.bosluk} />
            {!isClosed ? (
              <Button mode="outlined" icon="check-circle-outline" onPress={() => setKapatSor(true)}
                loading={d.mesgul === 'kapat'} disabled={d.mesgul !== null} contentStyle={styles.buyuk}>
                Çözüldü, kapat
              </Button>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={styles.yazisma}>
            {t.messages.map((m) => (
              <MesajBalonu key={m.id} m={m} />
            ))}
            {isClosed ? <Text style={styles.bilgi}>Talep kapandı. 14 gün içinde yanıt yazarsanız yeniden açılır.</Text> : null}
          </ScrollView>
          <YanitAlani d={d} onYeniTalep={() => yeniTalep(`Talep ${t.number}`)} />
        </>
      )}
      <ConfirmDialog
        kind="simple"
        visible={kapatSor}
        onDismiss={() => setKapatSor(false)}
        title="Talep kapatılsın mı?"
        description="Sorun çözüldüyse talebi kapatın. Gerekirse 14 gün içinde yanıt yazarak yeniden açabilirsiniz."
        confirmLabel="Çözüldü, kapat"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          setKapatSor(false);
          d.kapat();
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kok: { flex: 1, backgroundColor: colors.appBg },
  orta: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  bilgi: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: spacing.sm },
  durumSatir: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  bosluk: { flex: 1 },
  yazisma: { padding: spacing.md },
  yanitKap: { padding: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  hataSatir: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  hataMetin: { flex: 1, fontSize: 14 },
  yanitSatir: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  yanitKutu: { flex: 1, maxHeight: 140 },
  buyuk: { height: 56 },
});
