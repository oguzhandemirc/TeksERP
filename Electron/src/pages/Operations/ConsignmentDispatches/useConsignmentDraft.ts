// Yeni emanet çıkış belgesi formunun durumu: müşteri + kalemler, sunucu önizlemesi (yazmaz) ve kayıt.
// clientToken MANTIKSAL DENEME başına (`useAttemptToken`): yük değişince yeni deneme; yalnız belirsiz hatada yapışır.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAttemptToken } from "@/lib/attemptToken";
import { buildBody, upsertItem, type DraftItem, type DraftMeta } from "./draft";
import {
  CONSIGNMENT_DISPATCHES_QUERY_KEY,
  createConsignmentDispatch,
  previewConsignmentDispatch,
} from "./service";
import type { ConsignmentDispatchDto } from "./types";

const EMPTY_META: DraftMeta = { plateNumber: "", driverName: "", notes: "" };

export function useConsignmentDraft(open: boolean, onCreated: (d: ConsignmentDispatchDto) => void) {
  const qc = useQueryClient();
  const [ownerCustomerId, setOwner] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [meta, setMeta] = useState<DraftMeta>(EMPTY_META);
  const attempt = useAttemptToken();

  useEffect(() => {
    if (!open) return;
    setOwner(null);
    setItems([]);
    setMeta(EMPTY_META);
  }, [open]);

  const body = useMemo(
    () => (ownerCustomerId ? buildBody(ownerCustomerId, items, meta) : null),
    [ownerCustomerId, items, meta],
  );
  const bodyKey = JSON.stringify(body);
  // Yük değişti = başka bir belge denemesi → taze token (eski belirsiz denemenin token'ı yeni içerikle gitmesin).
  useEffect(() => attempt.renew(), [bodyKey, open, attempt]);

  const previewBody =
    body && body.items.length > 0 ? { ...body, plateNumber: null, driverName: null, notes: null } : null;
  const previewQ = useQuery({
    queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY, "preview", previewBody],
    queryFn: () => previewConsignmentDispatch(previewBody!),
    enabled: open && previewBody !== null,
    staleTime: 0,
  });

  const createM = useMutation({
    mutationFn: () => createConsignmentDispatch({ ...body!, clientToken: attempt.token() }),
    onSuccess: (d) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["warp-beams"] });
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      onCreated(d);
    },
    onError: (e) => {
      attempt.onFailure(e);
      // Kesin ret (sahip/levent/bakiye değişti) → önizleme tazelenir, engelli satır yeniden işaretlenir.
      void previewQ.refetch();
    },
  });

  const changeOwner = (id: string | null) => {
    setOwner(id);
    setItems([]); // Kalemlerin sahibi yeni müşteriyle uyuşmayabilir — taslak sıfırlanır (sessiz uyuşmazlık yok).
  };

  const preview = previewQ.data;
  const canSubmit = Boolean(
    body && items.length > 0 && preview?.canCreate && !previewQ.isFetching && !createM.isPending,
  );

  return {
    ownerCustomerId,
    changeOwner,
    items,
    addItem: (it: DraftItem) => setItems((xs) => upsertItem(xs, it)),
    removeItem: (key: string) => setItems((xs) => xs.filter((x) => x.key !== key)),
    meta,
    setMeta,
    preview,
    previewLoading: previewQ.isFetching,
    previewError: previewQ.isError,
    retryPreview: () => void previewQ.refetch(),
    canSubmit,
    submit: () => createM.mutate(),
    submitting: createM.isPending,
  };
}
