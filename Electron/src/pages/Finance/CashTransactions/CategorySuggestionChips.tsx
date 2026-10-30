import { useQuery } from "@tanstack/react-query";
import { fetchExpenseCategorySuggestions } from "./categorySuggestions";
import { visibleCategorySuggestions } from "./cashTxnRules";

/** Masraf kategorisi öneri çipleri (D4-H1) — yalnız masrafta; ayar kapalıysa hiç çizilmez. Katalog değil. */
export function CategorySuggestionChips({ active, value, onPick }: { active: boolean; value: string; onPick: (c: string) => void }) {
  const q = useQuery({
    queryKey: ["finance", "cash-transactions", "category-suggestions"],
    queryFn: fetchExpenseCategorySuggestions,
    enabled: active,
    staleTime: 60_000,
  });
  const chips = active && q.data?.enabled ? visibleCategorySuggestions(q.data.categories, value) : [];
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Kategori önerileri">
      {chips.map((c) => (
        <button key={c} type="button" className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onPick(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
