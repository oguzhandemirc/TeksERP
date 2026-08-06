import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { FindResult } from "@shared/ipc-contract";
import { cn } from "@/lib/utils";

// =============================================================================
// Sayfa içi metin arama çubuğu (Ctrl+F) — tarayıcıdaki aramanın aynısı
// =============================================================================
// Chromium'un kendi `findInPage`'ini kullanır (main süreçte `find.ipc.ts`):
// vurgulama, eşleşmeye kaydırma, sayaç ve İFRAME İÇLERİNDE arama hazır gelir —
// belge önizlemeleri de bu sayede aranabilir.
//
// ⚠️ NE BULUR, NE BULMAZ: yalnız O AN EKRANDA OLAN yazıyı. Uzun listeler
// kaydırdıkça yüklendiği için henüz yüklenmemiş satırlar bulunamaz. Bu sınır
// GİZLENMEZ: yüklenmemiş satır varsa çubukta açıkça yazar (aşağıdaki
// `unloadedHint`). Sessiz kalmak, kullanıcıya "kayıt sistemde yok" dedirtirdi —
// arama aracının yapabileceği en zararlı şey budur.
// =============================================================================

/**
 * Ekranda henüz YÜKLENMEMİŞ liste satırı var mı.
 *
 * İşareti iki sonsuz-kaydırma yolu da basar (`DataTable` ve `AutoLoadMore`) —
 * ikisi ortak bir bileşen paylaşmıyor, o yüzden işaret iki yerde.
 * Yalnız `hasMore` doğruyken basılır: her şey yüklüyse uyarıya gerek yok ve
 * gereksiz uyarı zamanla görünmez olur.
 */
function hasUnloadedRows(): boolean {
  return document.querySelector('[data-find-unloaded="1"]') !== null;
}

export function FindBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<FindResult>({ activeMatchOrdinal: 0, matches: 0 });
  const [unloaded, setUnloaded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const api = window.api?.find;

  // Sonuç sayacı aboneliği — çubuk açıkken dinle, kapanınca bırak.
  useEffect(() => {
    if (!open || !api) return;
    return api.onResult(setResult);
  }, [open, api]);

  // Açılışta odaklan + mevcut metni seç (tarayıcı davranışı: yeniden Ctrl+F
  // basınca üzerine yazabilesin).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    setUnloaded(hasUnloadedRows());
  }, [open]);

  // Kapanışta aramayı durdur ve vurguları temizle — açık kalan sarı vurgular
  // ekranda "hâlâ arıyor" izlenimi bırakır.
  useEffect(() => {
    if (open || !api) return;
    api.stop(true);
    setResult({ activeMatchOrdinal: 0, matches: 0 });
  }, [open, api]);

  const run = useCallback(
    (value: string, opts?: { forward?: boolean; findNext?: boolean }) => {
      if (!api) return;
      if (!value) {
        api.stop(true);
        setResult({ activeMatchOrdinal: 0, matches: 0 });
        return;
      }
      // Her aramada yeniden bak: kullanıcı arama sırasında listeyi kaydırıp
      // satır yüklemiş olabilir.
      setUnloaded(hasUnloadedRows());
      api.start(value, opts);
    },
    [api],
  );

  if (!open) return null;

  const empty = text.length > 0 && result.matches === 0;

  return (
    <div
      role="search"
      aria-label="Sayfada ara"
      className="absolute right-4 top-2 z-50 flex flex-col gap-1 rounded-md border bg-popover p-2 shadow-lg"
    >
      <div className="flex items-center gap-1">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={text}
          placeholder="Sayfada ara…"
          aria-label="Aranacak metin"
          onChange={(e) => {
            setText(e.target.value);
            run(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              // Aynı metinde sonraki/önceki eşleşme (Shift+Enter → geri).
              run(text, { forward: !e.shiftKey, findNext: true });
            }
          }}
          className={cn(
            "h-8 w-56 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            empty && "border-destructive text-destructive",
          )}
        />
        <span
          aria-live="polite"
          className={cn(
            "w-16 shrink-0 text-center text-xs tabular-nums",
            empty ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {text.length === 0 ? "" : `${result.activeMatchOrdinal}/${result.matches}`}
        </span>
        <button
          type="button"
          aria-label="Önceki eşleşme"
          disabled={result.matches === 0}
          onClick={() => run(text, { forward: false, findNext: true })}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Sonraki eşleşme"
          disabled={result.matches === 0}
          onClick={() => run(text, { forward: true, findNext: true })}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Aramayı kapat"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ⚠️ Bu satır isteğe bağlı bir süs DEĞİL: aramanın sınırını söyler.
          Yüklenmemiş satır varken sessiz kalmak, kullanıcıya "kayıt sistemde
          yok" dedirtirdi. */}
      {unloaded && (
        <p className="max-w-[22rem] text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          Yalnız ekranda yüklü satırlarda arandı. Kayıt aramak için listenin
          kendi arama kutusunu kullanın — o tüm kayıtlara bakar.
        </p>
      )}
    </div>
  );
}
