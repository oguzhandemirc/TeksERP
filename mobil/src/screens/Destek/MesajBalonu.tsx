// Yazışma balonu: müşteri sağda, ekip solda, sistem ortada küçük.
// Ek: önizleme `variant=thumb`; dokununca asıl görsel tam ekran (`original`).
// Silinmiş ekte bağlantı İSTENMEZ, "Ek süresi dolduğu için silindi" yazılır.
// Bağlantı 5 dk geçerli → sorgu 4 dk taze sayılır, sonra yeniden istenir.
import React, { useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import AppModal from '../../components/AppModal';
import TruncatedText from '../../components/TruncatedText';
import { factoryLocaleString } from '../../lib/factory-time';
import { colors, radius, spacing } from '../../theme';
import { destekService, type DestekEk, type DestekMesaj } from '../../services/destek.service';
import { boyutMetni, errorCode, silinmisEkMetni } from './destekMetin';

const LINK_FRESH_MS = 4 * 60_000;

function useEkBaglanti(ek: DestekEk, variant: 'thumb' | 'original', etkin: boolean) {
  return useQuery({
    queryKey: ['destek', 'ek', ek.id, variant],
    queryFn: () => destekService.ekBaglanti(ek.id, variant),
    enabled: etkin && !ek.deleted,
    staleTime: LINK_FRESH_MS,
    gcTime: LINK_FRESH_MS,
    retry: false,
  });
}

function TamEkranEk({ ek, onKapat }: { ek: DestekEk; onKapat: () => void }) {
  const q = useEkBaglanti(ek, 'original', true);
  return (
    <AppModal visible onDismiss={onKapat} position="center" contentStyle={styles.tamKap}>
      <View style={styles.tamUst}>
        <TruncatedText style={styles.tamAd} revealOnTap>
          {[ek.name, ' · ', boyutMetni(ek.size)]}
        </TruncatedText>
        <IconButton icon="close" size={28} onPress={onKapat} accessibilityLabel="Kapat" />
      </View>
      {q.data ? (
        <Image source={{ uri: q.data }} style={styles.tamGorsel} resizeMode="contain" />
      ) : q.isError ? (
        <Text style={styles.ekHata}>Görsel açılamadı.</Text>
      ) : (
        <ActivityIndicator style={styles.tamGorsel} />
      )}
    </AppModal>
  );
}

/** Görsel olmayan ek (PDF) tarayıcıda/görüntüleyicide açılır; hata sessiz. */
function pdfAc(ek: DestekEk): void {
  destekService
    .ekBaglanti(ek.id, 'original')
    .then((url) => Linking.openURL(url))
    .catch(() => undefined);
}

function EkOnizleme({ ek }: { ek: DestekEk }) {
  const [acik, setAcik] = useState(false);
  const q = useEkBaglanti(ek, 'thumb', true);
  if (ek.deleted || errorCode(q.error) === 'ATTACHMENT_EXPIRED') {
    return <Text style={styles.silinmis}>{silinmisEkMetni(ek)}</Text>;
  }
  const gorselMi = ek.mime.startsWith('image/');
  return (
    <>
      <TouchableRipple onPress={gorselMi ? () => setAcik(true) : () => pdfAc(ek)} accessibilityLabel={`Eki aç: ${ek.name}`}>
        {gorselMi && q.data ? (
          <Image source={{ uri: q.data }} style={styles.kucuk} resizeMode="cover" />
        ) : (
          <TruncatedText style={styles.ekAd}>{[ek.name, ' · ', boyutMetni(ek.size)]}</TruncatedText>
        )}
      </TouchableRipple>
      {acik && gorselMi ? <TamEkranEk ek={ek} onKapat={() => setAcik(false)} /> : null}
    </>
  );
}

export default function MesajBalonu({ m }: { m: DestekMesaj }) {
  if (m.kind === 'SYSTEM') {
    return <Text style={styles.sistem}>{m.body}</Text>;
  }
  const benim = m.kind === 'CUSTOMER';
  return (
    <View style={[styles.balon, benim ? styles.sag : styles.sol]}>
      <TruncatedText style={styles.yazar}>
        {[
          benim ? m.authorName ?? 'Siz' : m.authorName ?? 'Destek ekibi',
          ' · ',
          factoryLocaleString(m.createdAt, 'tr-TR', { dateStyle: 'short', timeStyle: 'short' }),
        ]}
      </TruncatedText>
      <Text style={styles.govde}>{m.body}</Text>
      {m.attachments.map((ek) => (
        <EkOnizleme key={ek.id} ek={ek} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sistem: { alignSelf: 'center', color: colors.textMuted, fontSize: 12, marginVertical: spacing.xs },
  balon: { maxWidth: '85%', borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginVertical: spacing.xs },
  sag: { alignSelf: 'flex-end', backgroundColor: colors.brandContainer },
  sol: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  yazar: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  govde: { fontSize: 15, color: colors.text, lineHeight: 21 },
  kucuk: { width: 160, height: 120, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  ekAd: { color: colors.brand, fontSize: 14, textDecorationLine: 'underline', paddingVertical: spacing.xs },
  silinmis: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  ekHata: { color: colors.dangerText, padding: spacing.lg },
  tamKap: { width: '95%', height: '90%', padding: spacing.sm },
  tamUst: { flexDirection: 'row', alignItems: 'center' },
  tamAd: { flex: 1, fontSize: 14, color: colors.text },
  tamGorsel: { flex: 1, width: '100%' },
});
