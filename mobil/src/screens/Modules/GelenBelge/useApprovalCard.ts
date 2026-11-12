// Onay kartı (T2) — detay sorgusu + başlık yaması + onay. ONLINE-ONLY: onay top doğurur, kuyruğa alınmaz.
// Detay okunamazsa (izin yok / eski backend) kart yok: bugünkü "Bitti" yolu aynen kalır (fail-closed).
import { useRef, useState } from 'react';
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
import { duplicateDocNoConflict, type DuplicateDocNoConflict } from './DuplicateDocNoDialog';
import { duplicateBatchNoConflict, duplicateConfirmFlags, type DuplicateBatchNoConflict, type DuplicateConfirms } from './DuplicateBatchNoDialog';

export const approvalDetailKey = (noteId: string | null) => ['gelen-belge', 'onay-karti', noteId] as const;

/** Onay kartı detayı — ekran (okuma kartı notları) ve kart aynı anahtarla okur; tek istek. */
export function useApprovalDetail(noteId: string | null, readDone: boolean) {
  return useQuery({
    queryKey: approvalDetailKey(noteId),
    queryFn: () => inboundDocService.noteDetail(noteId!),
    enabled: !!noteId && readDone,
    retry: false,
    staleTime: 0,
  });
}

export function useApprovalCard(noteId: string | null, readDone: boolean) {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canApprove = has('gelen-belge:approve');
  const [busy, setBusy] = useState<'patch' | 'approve' | null>(null);
  const [result, setResult] = useState<ApproveNoteResult | null>(null);
  const [routeTemplateId, setRouteTemplateId] = useState<string | null>(null);
  // K27 WARN: işi süren aynı belge no'lu eş → soru; "Yine de onayla" bayrakla yeniden gönderir.
  const [duplicate, setDuplicate] = useState<DuplicateDocNoConflict | null>(null);
  // Aynı müşteri parti no: WARN "Yine de aç" önceki onaylarla birlikte yeniden gönderir; BLOCK yalnız bildirilir.
  const [duplicateBatch, setDuplicateBatch] = useState<DuplicateBatchNoConflict | null>(null);
  const confirmsRef = useRef<DuplicateConfirms>({});

  const detail = useApprovalDetail(noteId, readDone);
  const visible = showsApprovalCard(detail.data);
  // Rota listesi yalnız onaylayacak kullanıcıya; okunamazsa seçici yok → sunucunun öneri zinciri.
  const routes = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getActive(),
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

  /** `gate` = diyalogdaki "Yine de" (o kapının onayı eklenir); birincil düğme onayları sıfırlar (yeni mantıksal deneme). */
  const approve = async (gate?: keyof DuplicateConfirms) => {
    if (!noteId || busy || !canApprove) return;
    confirmsRef.current = gate ? { ...confirmsRef.current, [gate]: true } : {};
    setBusy('approve');
    try {
      const r = await inboundDocService.approveNote(noteId, { ...(routeTemplateId ? { routeTemplateId } : {}), ...duplicateConfirmFlags(confirmsRef.current) });
      setDuplicate(null);
      setDuplicateBatch(null);
      setResult(r);
    } catch (e) {
      const conflict = duplicateDocNoConflict(e);
      const batchConflict = duplicateBatchNoConflict(e);
      setDuplicate(conflict);
      setDuplicateBatch(batchConflict);
      if (conflict || batchConflict) return;
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
    duplicate,
    dismissDuplicate: () => setDuplicate(null),
    duplicateBatch,
    dismissDuplicateBatch: () => setDuplicateBatch(null),
    refetch: () => void detail.refetch(),
  };
}

export type ApprovalCardState = ReturnType<typeof useApprovalCard>;
