import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import { formatFactory } from '../../../lib/factory-time';
import TruncatedText from '../../../components/TruncatedText';
import {
  flushPrintReports,
  hydratePrintReports,
  usePrintReports,
  type PrintReportStatus,
  type QueuedPrintReport,
} from '../../../services/printJob.service';
import { SETTINGS_COLORS as C, SettingsPage, settingsStyles } from './settingsUi';

const STATUS_TEXT: Record<PrintReportStatus, string> = {
  ILETILDI: 'İletildi',
  HATA: 'Hata',
  IPTAL: 'İptal',
  BELIRSIZ: 'Belirsiz',
};

const KIND_TEXT: Record<string, string> = {
  ETIKET_TOP: 'Top etiketi',
  ETIKET_CUVAL: 'Çuval etiketi',
  ETIKET_LEVENT: 'Levent etiketi',
  ETIKET_SERBEST: 'Serbest etiket',
  REFAKAT_KARTI: 'Refakat kartı',
  FASON_CEKI: 'Fason çekisi',
  BELGE: 'Belge',
};

/** Özet satırı — Ayarlar menüsü ile ekran aynı metni gösterir. */
export function printReportsSummary(items: QueuedPrintReport[]): string {
  if (items.length === 0) return 'Bekleyen rapor yok';
  const errors = items.filter((i) => i.body.status === 'HATA').length;
  return `${items.length} rapor gönderilmeyi bekliyor${errors > 0 ? ` · ${errors} hata` : ''}`;
}

/**
 * Ayarlar → Basım Raporları — tabletteki basım sonuçlarının (özellikle hataların) panel
 * "Yazdırma geçmişi"ne gidiş kuyruğu. Bağlantı yokken burada bekler, gelince kendiliğinden
 * gönderilir; "Şimdi gönder" yalnız beklemeyi kısaltır (aynı kimlikle — mükerrer satır olmaz).
 */
export function PrintReportsScreen() {
  const items = usePrintReports((s) => s.items);
  const drops = usePrintReports((s) => s.drops);
  const lastSentAt = usePrintReports((s) => s.lastSentAt);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hydratePrintReports();
  }, []);

  const dropped = drops.ttl + drops.cap + drops.rejected + drops.unsupported;

  return (
    <SettingsPage title="Basım Raporları">
      <View style={settingsStyles.card}>
        <Text style={s.title}>{printReportsSummary(items)}</Text>
        <Text style={s.hint}>
          Etiket ve belge basımlarının sonucu panelde Sistem → Yazdırma Geçmişi’ne gider. Bağlantı
          yokken burada bekler (48 saat), bağlantı gelince kendiliğinden gönderilir.
        </Text>
        {lastSentAt ? <Text style={s.hint}>Son gönderim: {formatFactory(lastSentAt, 'dd.MM HH:mm')}</Text> : null}
        {dropped > 0 ? (
          <Text style={s.warn}>
            Gönderilemeden düşen: {dropped}
            {drops.unsupported > 0 ? ` (sunucu bu özelliği tanımıyor: ${drops.unsupported})` : ''}
          </Text>
        ) : null}
        <Button
          mode="contained"
          icon="send"
          style={s.button}
          disabled={busy || items.length === 0}
          loading={busy}
          onPress={() => {
            setBusy(true);
            void flushPrintReports().finally(() => setBusy(false));
          }}
        >
          Şimdi gönder
        </Button>
      </View>

      {items.length > 0 ? (
        <View style={settingsStyles.card}>
          {[...items].reverse().map((i, idx) => (
            <View key={i.body.clientToken} style={[s.row, idx > 0 && s.rowBorder]}>
              <View style={s.rowHead}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {KIND_TEXT[i.body.subjectKind] ?? i.body.subjectKind}
                  {i.body.subjectNo ? ` · ${i.body.subjectNo}` : ''}
                </Text>
                <Text style={[s.badge, i.body.status === 'HATA' ? s.badgeError : null]}>
                  {STATUS_TEXT[i.body.status]}
                </Text>
              </View>
              {i.body.printerName ? <TruncatedText style={s.rowSub}>{i.body.printerName}</TruncatedText> : null}
              <Text style={s.rowSub} numberOfLines={2}>
                {formatFactory(i.queuedAt, 'dd.MM HH:mm')}
                {i.body.errorMessage ? ` · ${i.body.errorMessage}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </SettingsPage>
  );
}

const s = StyleSheet.create({
  title: { color: C.text, fontSize: 17, fontWeight: '700' },
  hint: { color: C.subtext, fontSize: 13, marginTop: 8, lineHeight: 18 },
  warn: { color: C.warning, fontSize: 13, marginTop: 8 },
  button: { marginTop: 16, alignSelf: 'flex-start' },
  row: { paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '600', flex: 1 },
  rowSub: { color: C.subtext, fontSize: 12, marginTop: 4 },
  badge: { color: C.subtext, fontSize: 12, fontWeight: '700' },
  badgeError: { color: C.error },
});
