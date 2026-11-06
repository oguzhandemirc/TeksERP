// Aynı belge tekrar okutuldu: hata yerine mevcut kayda kısayol (2026-11-06). Taslak eşleşmesi kart değildir —
// `useDocScan` o taslağı forma açar. "Yine de yeni kayıt aç" BİLEREK yok: aynı belgeden ikinci kayıt mükerrer üretimdir.
import React, { Suspense, lazy, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { formatFactory } from '../../../lib/factory-time';
import { WORK_ORDER_STATUS_LABEL } from '../../../utils/labels';
import type { SameDocumentMatch } from '../../../services/inboundDoc.service';
import { TERIM } from '../../../lib/terim';

// Tembel: İE detayı (okutma geri bildirimi, ses) yalnız düğmeye basılınca yüklenir — belge ekranlarının yükü artmaz.
const WorkOrderDetailSheet = lazy(() => import('../HizliIsEmri/WorkOrderDetailSheet'));

const woLabel = (w: { workOrderNumber: string; status: string }) => `${w.workOrderNumber} (${WORK_ORDER_STATUS_LABEL[w.status] ?? w.status})`;

/** Kartın saf metni (test React'siz okur). */
export function sameDocumentText(m: SameDocumentMatch): { title: string; lines: string[]; liveWorkOrderId: string | null; canStartNew: boolean } {
  const when = formatFactory(m.note.approvedAt ?? m.note.createdAt, 'dd.MM.yyyy HH:mm');
  const live = m.workOrders.filter((w) => w.status !== 'CANCELLED');
  if (m.state === 'CANCELLED') {
    return { title: 'Bu belge iptal edilmiş', lines: [`${when}'de ${m.note.noteNo} olarak kaydedildi, sonra iptal edildi.`, 'Yeniden işlemek için kaydı panelde inceleyin.'], liveWorkOrderId: null, canStartNew: false };
  }
  const head = `Bu belge ${when}'de işlendi → ${m.workOrders.length ? m.workOrders.map(woLabel).join(', ') : m.note.noteNo}`;
  const lines = [head];
  if (!live.length) lines.push(m.workOrders.length ? `Bu belgenin ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edildi.` : `Bu belgeden henüz ${TERIM.terbiyeIsEmri.tekilKucuk} açılmadı.`);
  return { title: 'Bu belge daha önce okutuldu', lines, liveWorkOrderId: live[0]?.id ?? null, canStartNew: live.length === 0 };
}

interface Props {
  match: SameDocumentMatch | null;
  onClose: () => void;
  /** Verilirse canlı İE yoksa "Bu belgeden yeni İE aç" görünür (form ekranları). */
  onNewWorkOrder?: (note: { id: string; noteNo: string }) => void;
}

export default function SameDocumentCard({ match, onClose, onNewWorkOrder }: Props) {
  const [woId, setWoId] = useState<string | null>(null);
  if (!match) return null;
  const t = sameDocumentText(match);
  const startNew = t.canStartNew && onNewWorkOrder ? () => onNewWorkOrder({ id: match.note.id, noteNo: match.note.noteNo }) : null;
  return (
    <>
      <ModuleSheet
        visible={!woId}
        onDismiss={onClose}
        title={t.title}
        subtitle={match.note.noteNo}
        footer={
          <>
            <Button mode="text" onPress={onClose}>Kapat</Button>
            {t.liveWorkOrderId ? <Button mode="contained" onPress={() => setWoId(t.liveWorkOrderId)}>{`${TERIM.terbiyeIsEmri.cumleBasi.belirtme} aç / düzenle`}</Button> : null}
            {startNew ? <Button mode="contained" onPress={startNew}>{`Bu belgeden yeni ${TERIM.terbiyeIsEmri.tekilKucuk} aç`}</Button> : null}
          </>
        }
      >
        <View>
          {t.lines.map((l) => <Text key={l} style={sheet.hint}>{l}</Text>)}
        </View>
      </ModuleSheet>
      {woId ? (
        <Suspense fallback={null}>
          <WorkOrderDetailSheet workOrderId={woId} onClose={() => { setWoId(null); onClose(); }} onChanged={() => undefined} />
        </Suspense>
      ) : null}
    </>
  );
}
