// Onay kartı (T2) — detay sorgusu + başlık yaması + onay. ONLINE-ONLY: onay top doğurur, kuyruğa alınmaz.
// Detay okunamazsa (izin yok / eski backend) kart yok: bugünkü "Bitti" yolu aynen kalır (fail-closed).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { usePermissions } from '../../../hooks/usePermission';
import { routeService } from '../../../services/route.service';
import {
  inboundDocService,
  type ApproveNoteResult,
  type InboundNotePatch,
} from '../../../services/inboundDoc.service';
import { showsApprovalCard } from './approvalGate';

export const approvalDetailKey = (noteId: string | null) => ['gelen-belge', 'onay-karti', noteId] as const;

export function useApprovalCard(noteId: string | null, readDone: boolean) {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canApprove = has('gelen-belge:approve');
  const [busy, setBusy] = useState<'patch' | 'approve' | null>(null);
  const [result, setResult] = useState<ApproveNoteResult | null>(null);
  const [routeTemplateId, setRouteTemplateId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: approvalDetailKey(noteId),
    queryFn: () => inboundDocService.noteDetail(noteId!),
    enabled: !!noteId && readDone,
    retry: false,
    staleTime: 0,
  });
  const visible = showsApprovalCard(detail.data);
  // Rota listesi yalnız onaylayacak kullanıcıya; okunamazsa seçici yok → sunucunun öneri zinciri.
  const routes = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    enabled: visible && canApprove,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const patch = async (body: InboundNotePatch) => {
    if (!noteId || busy) return;
    setBusy('patch');
    try {
      await inboundDocService.updateNote(noteId, body);
      await qc.invalidateQueries({ queryKey: approvalDetailKey(noteId) });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!noteId || busy || !canApprove) return;
    setBusy('approve');
    try {
      const r = await inboundDocService.approveNote(noteId, routeTemplateId ? { routeTemplateId } : {});
      setResult(r);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Onaylanamadı', text2: e instanceof Error ? e.message : undefined });
      // Sunucu kapısı (409) değişen başlığı söylüyorsa kart tazelenir.
      await qc.invalidateQueries({ queryKey: approvalDetailKey(noteId) });
    } finally {
      setBusy(null);
    }
  };

  return {
    detail: visible ? detail.data! : null,
    canApprove,
    busy,
    result,
    routes: routes.data?.data ?? [],
    routesLoading: routes.isLoading,
    routeTemplateId,
    setRouteTemplateId,
    patch,
    approve,
    refetch: () => void detail.refetch(),
  };
}

export type ApprovalCardState = ReturnType<typeof useApprovalCard>;
