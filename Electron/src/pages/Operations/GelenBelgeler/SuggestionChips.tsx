// Eşleme önerisi: ≥0,90/alias tek öneri vurgulu, 0,80–0,90 adaylar düz; tık = seçimi uygula (son söz operatörde).
import { Button } from "@/components/ui/button";
import type { MatchCandidate, MatchSuggestion } from "./types";

interface Props {
  suggestion: MatchSuggestion | undefined;
  currentId: string | null;
  onPick: (c: MatchCandidate) => void;
  disabled?: boolean;
}

const pct = (s: number) => `%${Math.round(s * 100)}`;

export function SuggestionChips({ suggestion, currentId, onPick, disabled }: Props) {
  if (!suggestion) return null;
  const cands = [...(suggestion.suggested ? [suggestion.suggested] : []), ...suggestion.list].filter((c) => c.id !== currentId);
  if (cands.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="suggestions">
      {suggestion.rawText && <span className="text-muted-foreground">“{suggestion.rawText}” →</span>}
      {cands.map((c, i) => (
        <Button
          key={c.id}
          type="button"
          size="sm"
          variant={i === 0 && suggestion.suggested ? "secondary" : "ghost"}
          className="h-6 px-2 text-xs"
          disabled={disabled}
          onClick={() => onPick(c)}
          title={suggestion.source === "ALIAS" && i === 0 ? "Daha önce onaylanan eşleme" : "Ad benzerliği"}
        >
          {c.name} {suggestion.source === "ALIAS" && i === 0 ? "(öğrenilmiş)" : pct(c.score)}
        </Button>
      ))}
    </div>
  );
}
