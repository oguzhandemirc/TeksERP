import { History, X } from "lucide-react";
import { normalizeApiBaseUrl } from "@/lib/api-config";

interface Props {
  urls: string[];
  /** Diyalogda o an yazılı adres — eşleşen satır vurgulanır. */
  current: string;
  onPick: (url: string) => void;
  onDrop: (url: string) => void;
}

/** Son kullanılan adresler — hızlı seçim; × listeden çıkarır. */
export function RecentAddressList({ urls, current, onPick, onDrop }: Props) {
  if (urls.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        Son kullanılanlar
      </div>
      <div className="flex flex-col gap-1">
        {urls.map((url) => {
          const active = normalizeApiBaseUrl(current) === normalizeApiBaseUrl(url);
          return (
            <div
              key={url}
              className={`flex items-center gap-1 rounded-md border pl-2 pr-1 text-xs ${
                active ? "border-primary/50 bg-primary/5" : "border-border"
              }`}
            >
              <button
                type="button"
                onClick={() => onPick(url)}
                className="flex-1 truncate py-1.5 text-left font-mono hover:text-foreground"
                title={`Seç: ${url}`}
              >
                {url}
              </button>
              <button
                type="button"
                onClick={() => onDrop(url)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label="Listeden çıkar"
                title="Listeden çıkar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
