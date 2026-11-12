import { useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

/**
 * Sunucu aramalı tek istekli liste için arama durumu: `search` kutunun anlık değeri,
 * `term` sunucuya giden (300 ms bekletilmiş, kırpılmış; boşsa `undefined` = arama yok).
 * Süzme SUNUCUDA — `term` sorgu anahtarına ve istek parametresine girer.
 */
export function useListSearch(delayMs = 300): { search: string; setSearch: (v: string) => void; term: string | undefined } {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, delayMs).trim();
  return { search, setSearch, term: debounced || undefined };
}
