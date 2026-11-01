// Dokuma iş emri formunda "Tezgâh önerisi" bölümü (SY-M3, tasarım §14.8). Taslak (ürün + varyant + çözgü + plan m)
// üzerinden salt okuma; ürün seçilmeden sorgu atılmaz. Kapı çağıranda (`gates.loomSuggestionVisible`).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiErrorMessage } from "@/services/apiClient";
import { LoomCandidateList } from "./LoomSuggestionParts";
import { LOOM_SUGGESTION_QUERY_KEY, loomSuggestionService } from "./service";
import type { LoomSuggestionDraft } from "./types";

/** Form değerlerinden taslak; ürün yoksa null (sorgu yok). Plan metresi geçersizse gönderilmez. */
export function draftOf(v: { itemId?: string; recipeId?: string; warpSpecId?: string; plannedM?: string }): LoomSuggestionDraft | null {
  if (!v.itemId) return null;
  const m = Number(String(v.plannedM ?? "").replace(",", "."));
  return { itemId: v.itemId, recipeId: v.recipeId || null, warpSpecId: v.warpSpecId || null, plannedM: Number.isFinite(m) && m > 0 ? m : null };
}

export function LoomSuggestionSection({ draft: liveDraft }: { draft: LoomSuggestionDraft | null }) {
  // Plan metresi yazılırken her tuşta istek atılmasın: taslak, metin anahtarı üzerinden 400 ms debounce edilir.
  const debouncedKey = useDebouncedValue(JSON.stringify(liveDraft), 400);
  const draft = useMemo(() => JSON.parse(debouncedKey) as LoomSuggestionDraft | null, [debouncedKey]);
  const q = useQuery({
    queryKey: [...LOOM_SUGGESTION_QUERY_KEY, "draft", draft],
    queryFn: () => loomSuggestionService.forDraft(draft!),
    enabled: draft !== null,
    staleTime: 30_000,
  });
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Tezgâh önerisi">
      <div>
        <h4 className="text-sm font-medium">Tezgâh önerisi</h4>
        <p className="text-xs text-muted-foreground">Yalnız sıralamadır; işi istediğiniz tezgâha verebilirsiniz.</p>
      </div>
      {draft === null ? (
        <p className="text-xs text-muted-foreground">Öneri için önce kumaş seçin.</p>
      ) : q.isLoading ? (
        <p className="text-xs text-muted-foreground">Tezgâhlar değerlendiriliyor…</p>
      ) : q.isError ? (
        <p className="text-xs text-destructive">{apiErrorMessage(q.error, "Tezgâh önerisi alınamadı")}</p>
      ) : (
        <>
          {q.data?.warnings.map((w) => (
            <p key={w.code} className="text-xs text-warning">{w.message}</p>
          ))}
          <LoomCandidateList candidates={q.data?.candidates ?? []} />
        </>
      )}
    </section>
  );
}
