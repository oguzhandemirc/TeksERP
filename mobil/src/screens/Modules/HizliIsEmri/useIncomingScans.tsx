// İE Belgeler → kaynak gelen belgenin taranmış fotoğrafları: liste sorgusu + tam ekran görüntüleyici (yakınlaştırmalı
// `PagePreviewModal`, Belge Tara'nın bileşeni). İzin `gelen-belge:read` yoksa ya da modül kapalıysa (403) satır çıkmaz.
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import PagePreviewModal from '../GelenBelge/PagePreviewModal';
import { incomingScanService } from '../../../services/incomingScan.service';
import { usePermissions } from '../../../hooks/usePermission';
import { incomingScanItems, scanDataUri, type IncomingScanItem } from './incomingScans';

const NO_UPLOADED: ReadonlySet<string> = new Set();
const imageKey = (scanId: string) => ['incoming-scan-image', scanId] as const;

export function useIncomingScans(workOrderId: string | null, visible: boolean) {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canRead = has('gelen-belge:read');
  const q = useQuery({
    queryKey: ['work-order-incoming-scans', workOrderId],
    queryFn: () => incomingScanService.workOrderNotes(workOrderId as string),
    enabled: visible && !!workOrderId && canRead,
    retry: false,
  });
  const items = useMemo(() => (q.isError ? [] : incomingScanItems(q.data?.notes)), [q.data, q.isError]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ pages: { sha256: string; uri: string }[]; index: number } | null>(null);

  /** Açılabilir TÜM sayfalar yüklenir (sayfa geçişi beklemesiz); dokunulan sayfadan başlar. */
  const open = async (item: IncomingScanItem) => {
    if (!item.viewable || openingId) return;
    setOpeningId(item.scanId);
    try {
      const viewable = items.filter((i) => i.viewable);
      const loaded = await Promise.allSettled(
        viewable.map((i) =>
          qc.fetchQuery({
            queryKey: imageKey(i.scanId),
            queryFn: () => incomingScanService.scanContent(i.scanId).then((c) => scanDataUri(c.mimeType, c.bytes)),
            staleTime: 5 * 60 * 1000,
          }),
        ),
      );
      const pages = viewable.flatMap((i, k) => {
        const r = loaded[k];
        return r.status === 'fulfilled' ? [{ sha256: i.scanId, uri: r.value }] : [];
      });
      const index = pages.findIndex((p) => p.sha256 === item.scanId);
      if (index < 0) {
        const fail = loaded[viewable.findIndex((i) => i.scanId === item.scanId)];
        const msg = fail?.status === 'rejected' ? (fail.reason as Error)?.message : undefined;
        Toast.show({ type: 'error', text1: 'Belge fotoğrafı açılamadı', text2: msg });
        return;
      }
      setViewer({ pages, index });
    } finally {
      setOpeningId(null);
    }
  };

  const viewerEl = (
    <PagePreviewModal
      pages={viewer?.pages ?? []}
      index={viewer ? viewer.index : null}
      uploaded={NO_UPLOADED}
      onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
      onDismiss={() => setViewer(null)}
      testID="ie-gelen-belge-foto"
    />
  );
  return { items, openingId, open, viewer: viewerEl };
}
