// Seçili cari (yan panel) URL'de: `?kayit=C:<id>` — sekme/geri dönüşte panel aynı kayıtla açılır.
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { neighborId } from "@/components/record/record-nav";
import { parseRowKey, rowKey, SELECTED_PARAM, type CariRowItem } from "./cari-row";

export function useCariSelection(rows: CariRowItem[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(SELECTED_PARAM);
  const parsed = parseRowKey(raw);
  const selectedKey = parsed ? rowKey(parsed) : null;
  const selected = useMemo(() => rows.find((r) => rowKey(r) === selectedKey) ?? null, [rows, selectedKey]);

  const select = useCallback(
    (row: Pick<CariRowItem, "kind" | "id"> | null) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (row) next.set(SELECTED_PARAM, rowKey(row));
          else next.delete(SELECTED_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const keys = useMemo(() => rows.map(rowKey), [rows]);
  const step = (dir: 1 | -1) => {
    const k = neighborId(keys, selectedKey, dir);
    const r = k ? rows.find((x) => rowKey(x) === k) : null;
    return r ? () => select(r) : null;
  };
  return { selected, selectedKey, select, prev: step(-1), next: step(1) };
}
