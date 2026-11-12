// Seçili sipariş (yan panel) URL'de: `?kayit=<id>` — sekme/geri dönüşte panel aynı kayıtla açılır.
// Eski derin bağ `?focus=<id>` (cari, pano, İE detayı) `?kayit=`e çevrilir; listede olmayan kayıt uçtan çekilir.
import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { neighborId } from "@/components/record/record-nav";
import type { Order } from "../types";
import { ORDER_SELECTED_PARAM } from "./order-record";
import { useOrderRecord } from "./useOrderRecordData";

const LEGACY_FOCUS_PARAM = "focus";

export function useOrderSelection(rows: Order[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get(LEGACY_FOCUS_PARAM);
  useEffect(() => {
    if (!focus) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(LEGACY_FOCUS_PARAM);
        next.set(ORDER_SELECTED_PARAM, focus);
        return next;
      },
      { replace: true },
    );
  }, [focus, setSearchParams]);

  const selectedId = searchParams.get(ORDER_SELECTED_PARAM);
  const inList = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  // Kayıt listede yoksa (süzgeç dışı / derin bağ) uçtan çekilir; 404'te panel açılmaz.
  const fetched = useOrderRecord(selectedId && !inList ? selectedId : null);
  const selected = inList ?? (fetched.data && fetched.data.id === selectedId ? fetched.data : null);

  const select = useCallback(
    (id: string | null) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(ORDER_SELECTED_PARAM, id);
          else next.delete(ORDER_SELECTED_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const step = (dir: 1 | -1) => {
    const id = neighborId(ids, selectedId, dir);
    return id ? () => select(id) : null;
  };
  return { selected, selectedId, select, prev: step(-1), next: step(1) };
}
