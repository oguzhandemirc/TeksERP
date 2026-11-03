// Açık kart listesi araması (K17): fiş / evrak / parti / İE no SUNUCUDA süzülür (`?q=`). Ana liste (acil rozeti,
// sayaç) aramadan etkilenmez; arama ayrı sorgudur ve yalnız ≥ 2 karakterde koşar.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchable } from './decide';

const DEBOUNCE_MS = 350;

export function useOpenCardSearch<T>(key: readonly unknown[], fetch: (q: string) => Promise<{ data?: T[] }>) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const active = searchable(q);
  const query = useQuery({ queryKey: [...key, 'q', q], queryFn: () => fetch(q), enabled: active, staleTime: 10 * 1000 });
  return { text, setText, active, loading: active && query.isLoading, cards: active ? (query.data?.data ?? []) : null };
}
