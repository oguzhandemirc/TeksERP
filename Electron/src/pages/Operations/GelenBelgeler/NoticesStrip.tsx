// Okuma uyarıları şeridi: backend `notices` (detay yanıtı; tablet okuma özetiyle AYNI helper) — panel metin ayrıştırmaz,
// kural kurmaz; yalnız başlık + ayrıntı basar. Eski backend alanı göndermezse ya da uyarı yoksa şerit çizilmez.
import { AlertTriangle } from "lucide-react";
import type { NoteNotice } from "./types";

/** `compact`: detayın "Dikkat" kutusunda — kutusuz, her uyarı tek satır (ayrıntı tooltip'te). */
export function NoticesStrip({ notices, compact = false }: { notices: NoteNotice[] | undefined; compact?: boolean }) {
  if (!notices?.length) return null;
  if (compact) {
    return (
      <ul role="status" className="flex flex-col gap-1.5 text-sm" data-testid="notices-strip" aria-label={`Okuma uyarıları (${notices.length})`}>
        {notices.map((n, i) => (
          <li key={`${n.code}-${i}`} className="truncate text-amber-900 dark:text-amber-200" title={n.detail ? `${n.title} — ${n.detail}` : n.title} data-testid="notice" data-code={n.code}>
            <span className="font-medium">{n.title}</span>
            {n.detail && <span className="text-muted-foreground"> — {n.detail}</span>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-xs" data-testid="notices-strip">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Okuma uyarıları ({notices.length})
      </div>
      <ul className="flex flex-col gap-1">
        {notices.map((n, i) => (
          <li key={`${n.code}-${i}`} data-testid="notice" data-code={n.code}>
            <span className="font-medium">{n.title}</span>
            {n.detail && <span className="text-muted-foreground"> — {n.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
