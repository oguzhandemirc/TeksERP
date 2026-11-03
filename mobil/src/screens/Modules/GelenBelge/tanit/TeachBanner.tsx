// K30-A1: tek form / toplu satır / masa satırında tanıtma girişi. Okuma özeti `tanitim` TANITILMAMIS → belirgin "Bu belge
// tanıtılmamış — Tanıt"; TANITILDI → küçük "Şablonu güncelle (<ad>)". Alan yoksa (eski sunucu / yerleşik şablon) çizilmez.
// Kayıt sonrası belge yeni şablonla yeniden okutulur; sunucu yeniden okumazsa (satırlı taslak, 409) önizleme değerleri forma dolar.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import { usePermissions } from '../../../../hooks/usePermission';
import { inboundDocService, type ReadTanitim } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { lowerTr } from '../../../../utils/trCase';
import { approvalDetailKey } from '../useApprovalCard';
import type { DocRow, WoRowsState } from '../woCreate/useWoRows';
import { localPagesFor } from './localPages';
import TeachModal from './TeachModal';
import { teachPages } from './teachPages';
import type { TeachSaved } from './useTeachModal';

interface Props {
  row: DocRow;
  wo: Pick<WoRowsState, 'rereadRow' | 'applyTaught'>;
  tanitim: ReadTanitim | undefined;
  customers: readonly PickerOption[];
}

const PDF_MIME = 'application/pdf';
const norm = (t: string) => lowerTr(t).replace(/\s+/g, ' ').trim();

export default function TeachBanner({ row, wo, tanitim, customers }: Props) {
  const { has } = usePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const allowed = has('gelen-belge:template') && has('gelen-belge:read');
  const done = row.result?.kind === 'OPENED' || row.result?.kind === 'DRAFT';
  if (!allowed || !tanitim || done || !row.detail) return null;
  const pages = teachPages(row.detail, localPagesFor((row.detail.scans ?? []).map((s) => s.sha256)));
  const code = tanitim.durum === 'TANITILDI' ? tanitim.sablonKodu : null;

  const refill = async (r: TeachSaved) => {
    const scans = (row.detail?.scans ?? []).filter((s) => s.status === 'READ' && s.mimeType !== PDF_MIME);
    let requeued = 0;
    for (const s of scans) {
      try {
        await inboundDocService.requeueScan(s.id);
        requeued += 1;
      } catch {
        // 409 (satırlı taslak / taslak değil) ya da okuyucu yok → aşağıda yerel doldurma.
      }
    }
    if (requeued > 0) {
      qc.removeQueries({ queryKey: approvalDetailKey(row.noteId) });
      wo.rereadRow(row.noteId);
      Toast.show({ type: 'info', text1: 'Belge yeni şablonla yeniden okunuyor', text2: 'Okuma bitince form yeniden dolar.' });
      return;
    }
    const owner = r.fields.musteri ? customers.find((c) => norm(c.label) === norm(r.fields.musteri!)) : undefined;
    wo.applyTaught(row.noteId, r.fields, owner?.value ?? null);
    Toast.show({ type: 'info', text1: 'Form yeni şablonla okunan değerlerle güncellendi', text2: 'Belge yeniden okunamadı (satırları taslakta); değerleri kontrol edin.' });
  };

  const noPhoto = pages.length === 0;
  return (
    <>
      {tanitim.durum === 'TANITILMAMIS' ? (
        <View style={styles.strip} testID="tanit-serit">
          <Icon source="alert-circle-outline" size={28} color={colors.warningText} />
          <Text style={styles.stripText}>
            {noPhoto ? 'Bu belge tanıtılmamış. Tanıtmak için belgeyi bu tabletten okutun.' : 'Bu belge tanıtılmamış — bir kez tanıtın, sonraki belgeler doğru okunsun.'}
          </Text>
          {!noPhoto && (
            <Button mode="contained" icon="creation" onPress={() => setOpen(true)} contentStyle={styles.btn} testID="tanit-serit-ac">
              Tanıt
            </Button>
          )}
        </View>
      ) : (
        !noPhoto && (
          <Button mode="text" icon="file-replace-outline" onPress={() => setOpen(true)} contentStyle={styles.btn} style={styles.link} testID="tanit-serit-guncelle">
            {`Şablonu güncelle (${tanitim.sablonAdi})`}
          </Button>
        )
      )}
      {!noPhoto && <TeachModal visible={open} pages={pages} code={code} onDismiss={() => setOpen(false)} onSaved={(r) => void refill(r)} />}
    </>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningContainer },
  stripText: { flex: 1, minWidth: 200, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.warningText },
  link: { alignSelf: 'flex-start' },
  btn: { minHeight: 56 },
});
