// Tanıtma fotoğrafı: ZoomableScan (yakınlaştır/kaydır korunur) üstünde kelime kutuları; kısa tık kelimeyi seçer.
// Küçük yazı için "Kelime ara" listesi aynı seçimi yapar (klavyeyle de erişilir).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { lowerTr } from "@/lib/tr-case";
import { Button } from "@/components/ui/button";
import { ZoomableScan } from "../ZoomableScan";
import { useScanImage } from "../useScanImage";
import { SCAN_PURGED_TEXT } from "../photoRetention";
import { teachMarks, wordAt, type TeachState } from "./teachDraft";
import type { ScanWord } from "./types";

interface Props {
  scanId: string;
  pageLabel: string;
  words: readonly ScanWord[];
  state: TeachState;
  onToggle: (i: number) => void;
}

const MAX_HITS = 40;

export function WordSearch({ words, state, onToggle }: Pick<Props, "words" | "state" | "onToggle">) {
  const [q, setQ] = useState("");
  const needle = lowerTr(q.trim());
  const hits = needle ? words.map((w, i) => ({ w, i })).filter(({ w }) => lowerTr(w.text).includes(needle)).slice(0, MAX_HITS) : [];
  return (
    <div className="space-y-1" data-testid="teach-word-search">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kelime ara (küçük yazıyı listeden seçin)" aria-label="Kelime ara" />
      {hits.length > 0 && (
        <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
          {hits.map(({ w, i }) => (
            <Button key={i} type="button" size="sm" variant={state.selected.includes(i) ? "default" : "outline"} aria-pressed={state.selected.includes(i)} onClick={() => onToggle(i)} data-testid={`teach-word-${i}`}>
              {w.text}
            </Button>
          ))}
        </div>
      )}
      {needle && hits.length === 0 && <p className="text-xs text-muted-foreground">Bu yazı fotoğrafta okunmadı.</p>}
    </div>
  );
}

export function TeachScan({ scanId, pageLabel, words, state, onToggle }: Props) {
  const img = useScanImage(scanId);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="teach-scan">
      {img.isLoading && <div className="text-sm text-muted-foreground">Fotoğraf yükleniyor…</div>}
      {img.isError && <div className="text-sm text-destructive">Fotoğraf alınamadı.</div>}
      {img.purged && <div className="text-sm text-muted-foreground" data-testid="scan-purged">{SCAN_PURGED_TEXT}</div>}
      {img.url && (
        <ZoomableScan
          key={scanId}
          url={img.url}
          alt={pageLabel}
          highlight={null}
          marks={teachMarks(state, words)}
          onTap={(p) => {
            const i = wordAt(words, p);
            if (i !== null) onToggle(i);
          }}
        />
      )}
      <WordSearch words={words} state={state} onToggle={onToggle} />
    </div>
  );
}
