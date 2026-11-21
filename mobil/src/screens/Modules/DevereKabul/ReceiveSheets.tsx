// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — önizleme (onay) ve sonuç kartları (`ModuleSheet`)
// =============================================================================
// Önizleme sunucudan: sipariş başı levent/metre/nominal kg + irsaliye tekrarı uyarısı. KABUL ET hep-ya-hiç
// tek belge yazar; BLOCK ayarında aynı irsaliye kabulü 409 ile durur (burada önceden söylenir).
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import StationActionButton from '../../../components/StationActionButton';
import TruncatedText from '../../../components/TruncatedText';
import { moduleAccents, palette, spacing, typography } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import type { DuplicateNoteMode, ReceiveDocFields, ReceiveDocPreview, ReceiveDocResult } from '../../../services/devereKabul.service';
import { previewBeamName } from './receiveDocPayload';

const m = (v: string | null | undefined) => (v == null ? '—' : `${fmtMeters(Number(v))} m`);
const kg = (v: string | null | undefined) => (v == null ? '' : `${Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} kg`);

interface PreviewProps {
  preview: ReceiveDocPreview;
  /** Önizlemeye gönderilen gövde — gövdesiz satırın elle yazılan no'su buradan. */
  sent: ReceiveDocFields | null;
  duplicateMode: DuplicateNoteMode;
  pending: boolean;
  isOnline: boolean;
  onAccept: () => void;
  onBack: () => void;
}

export function PreviewSheet({ preview, sent, duplicateMode, pending, isOnline, onAccept, onBack }: PreviewProps) {
  const blocked = duplicateMode === 'BLOCK' && preview.deliveryNoteUses.length > 0;
  return (
    <ModuleSheet
      visible
      onDismiss={onBack}
      size="xl"
      title={`Kabul önizlemesi — ${preview.totals.beamCount} levent · ${m(preview.totals.lengthM)}`}
      subtitle={`İrsaliye ${preview.deliveryNoteNo ?? '—'} · ${preview.totals.orderCount} sipariş · hepsi birlikte kaydedilir ya da hiçbiri`}
      footer={<Button onPress={onBack} disabled={pending}>Geri — düzelt</Button>}
    >
      {preview.warnings.map((w) => <Text key={w} style={sheet.warn}>{w}</Text>)}
      {blocked ? <Text style={sheet.error}>Bu irsaliye no bu deverecide daha önce kullanılmış — bu kurulumda tekrar kabul edilmez. İrsaliye no'yu düzeltin.</Text> : null}
      {preview.orders.map((o) => (
        <View key={o.warpingOrderId} style={sheet.box}>
          <Text style={styles.orderTitle}>{`${o.preview.order.orderNo} — ${o.preview.incoming.beamCount} levent · ${m(o.preview.incoming.lengthM)}`}</Text>
          {o.preview.beams.map((b) => (
            <View key={b.index} style={sheet.summaryRow}>
              <TruncatedText style={sheet.summaryLabel}>{`${b.index + 1}. ${previewBeamName(sent, o.warpingOrderId, b.index, b.body)}`}</TruncatedText>
              <Text style={sheet.summaryValue}>{[m(b.lengthM), `hesap ${kg(b.nominalKg)}`, b.weighedNetKg ? `tartı net ${kg(b.weighedNetKg)}` : ''].filter(Boolean).join(' · ')}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.action}>
        <StationActionButton label={`KABUL ET — ${preview.totals.beamCount} levent`} icon="check-decagram" onPress={onAccept} tint={moduleAccents.DevereKabul.tint} loading={pending} loadingLabel="Kaydediliyor…" disabled={!isOnline || blocked} size="xl" testID="devere-kabul-onayla" />
      </View>
    </ModuleSheet>
  );
}

type ResultBeam = ReceiveDocResult['orders'][number]['receipt']['beams'][number];

/** `onReject` yalnız `mobile:devere-ret` yetkisinde verilir — yoksa satır düğmesi çizilmez. */
export function ResultSheet({ result, onClose, onReject }: { result: ReceiveDocResult; onClose: () => void; onReject?: (b: ResultBeam, order: { id: string; orderNo: string }) => void }) {
  return (
    <ModuleSheet
      visible
      onDismiss={onClose}
      title={`Kabul kaydedildi — ${result.docNo}`}
      subtitle={`${result.totals.beamCount} levent · ${m(result.totals.lengthM)} · levent etiketleri yazıcıya gönderiliyor`}
      footer={<Button mode="contained" onPress={onClose} contentStyle={styles.tall}>Tamam — yeni kabul</Button>}
    >
      {result.orders.map((o) => (
        <View key={o.warpingOrderId} style={sheet.box}>
          <Text style={styles.orderTitle}>{o.orderNo}</Text>
          {o.receipt.beams.map((b) => (
            <View key={b.id} style={[sheet.summaryRow, styles.beamRow]}>
              <Text style={sheet.summaryLabel}>{b.beamNo}</Text>
              <Text style={[sheet.summaryValue, styles.grow]}>{[b.physicalBeamNo, m(b.lengthM)].filter(Boolean).join(' · ')}</Text>
              {onReject ? (
                <Button mode="outlined" icon="truck-fast-outline" textColor={palette.orange[800]} onPress={() => onReject(b, { id: o.warpingOrderId, orderNo: o.orderNo })} contentStyle={styles.tall} testID={`devere-ret-satir-${b.beamNo}`}>
                  Geri gönder
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  orderTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, marginBottom: spacing.xs },
  action: { marginTop: spacing.md },
  tall: { height: 56 },
  beamRow: { alignItems: 'center' },
  grow: { flex: 1 },
});
