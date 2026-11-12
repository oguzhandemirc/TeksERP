import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { RowMarkEntity } from "@/lib/row-mark-entities";
import { lookupRowMarks, putRowMark, ROW_MARK_LOOKUP_MAX, type RowMark, type RowMarkInput } from "@/services/rowMarkService";

/** Bir kaydın işaretleri: kişinin kendi işareti + başkalarının paylaştıkları. */
export interface RowMarkEntry {
  mine: RowMark | null;
  shared: RowMark[];
}

export const EMPTY_ENTRY: RowMarkEntry = { mine: null, shared: [] };

/** Şeridi boyayan işaret: kendi rengin önce, yoksa paylaşılan ilk renk; renk yoksa notlu işaret. */
export function primaryMark(e: RowMarkEntry | undefined): RowMark | null {
  if (!e) return null;
  return (e.mine?.color ? e.mine : e.shared.find((m) => m.color)) ?? e.mine ?? e.shared[0] ?? null;
}

/** Satırın `title` ekine düşen not metni: her not ayrı satır, paylaşılanlar "— <ad>" ile. */
export function noteTitle(e: RowMarkEntry | undefined): string | undefined {
  if (!e) return undefined;
  const lines = [
    ...(e.mine?.note ? [`Not: ${e.mine.note}`] : []),
    ...e.shared.filter((m) => m.note).map((m) => `Not: ${m.note} — ${m.ownerName ?? "?"}`),
  ];
  return lines.length ? lines.join("\n") : undefined;
}

/**
 * Görünen satırların işaretleri. Yeni gelen kimlikler (ilk sayfa, sonsuz kaydırma) TOPLU sorulur —
 * istek başına en çok 200; daha önce sorulan kimlik tekrar sorulmaz. Yazım iyimserdir, hata geri alır.
 */
export function useRowMarks(entity: RowMarkEntity | undefined, ids: readonly string[]) {
  // Sağlayıcısız yüzeylerde (DataTable her yerde) zorunlu değil: yoksa yalnız süzgeç tazelemesi atlanır.
  const qc = useContext(QueryClientContext);
  const [entries, setEntries] = useState<Record<string, RowMarkEntry>>({});
  const asked = useRef(new Set<string>());
  const entityRef = useRef(entity);
  // Yazım anındaki taze değer (iyimser güncelleme ve geri alma tabanı); updater içinde okunmaz.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (entityRef.current === entity) return;
    entityRef.current = entity;
    asked.current = new Set();
    setEntries({});
  }, [entity]);

  const idsKey = ids.join(",");
  useEffect(() => {
    if (!entity) return;
    const missing = idsKey ? idsKey.split(",").filter((id) => !asked.current.has(id)) : [];
    if (missing.length === 0) return;
    let alive = true;
    for (let i = 0; i < missing.length; i += ROW_MARK_LOOKUP_MAX) {
      const chunk = missing.slice(i, i + ROW_MARK_LOOKUP_MAX);
      chunk.forEach((id) => asked.current.add(id));
      lookupRowMarks(entity, chunk)
        .then((marks) => {
          if (!alive || entityRef.current !== entity) return;
          setEntries((prev) => {
            const next = { ...prev };
            for (const id of chunk) {
              const own = marks.filter((m) => m.recordId === id);
              next[id] = { mine: own.find((m) => m.mine) ?? null, shared: own.filter((m) => !m.mine) };
            }
            return next;
          });
        })
        // Okunamayan parça sonraki görünümde yeniden sorulur; işaretsiz satır yine çizilir.
        .catch(() => chunk.forEach((id) => asked.current.delete(id)));
    }
    return () => {
      alive = false;
    };
  }, [entity, idsKey]);

  const setMark = useCallback(
    async (recordId: string, patch: Partial<RowMarkInput>) => {
      if (!entity) return;
      const before = entriesRef.current[recordId] ?? EMPTY_ENTRY;
      const cur = before.mine;
      const input: RowMarkInput = { color: cur?.color ?? null, note: cur?.note ?? null, shared: cur?.shared ?? false, ...patch };
      const empty = input.color === null && !input.note?.trim();
      const optimistic: RowMark | null = empty
        ? null
        : { recordId, ...input, mine: true, ownerName: null, updatedAt: new Date().toISOString() };
      setEntries((prev) => ({ ...prev, [recordId]: { ...before, mine: optimistic } }));
      try {
        const saved = await putRowMark(entity, recordId, input);
        setEntries((prev) => ({ ...prev, [recordId]: { ...(prev[recordId] ?? EMPTY_ENTRY), mine: saved } }));
        // "İşaretliler" süzgecinin kimlik listesi bayatladı.
        void qc?.invalidateQueries({ queryKey: ["row-marks", "mine", entity] });
      } catch {
        // Hata cümlesini apiClient basar; burada yalnız iyimser değişiklik geri alınır.
        setEntries((prev) => ({ ...prev, [recordId]: before }));
      }
    },
    [entity, qc],
  );

  return { entries, setMark };
}
