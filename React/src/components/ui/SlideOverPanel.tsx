import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface SlideOverPanelProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  headerActions?: ReactNode;
}

export function SlideOverPanel({
  title,
  isOpen,
  onClose,
  children,
  widthClass = "max-w-md",
  headerActions,
}: SlideOverPanelProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isAnimated, setIsAnimated] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (isOpen) {
      setShouldRender(true);
      // Küçük bir gecikme ile DOM'a eklendikten sonra animasyonu başlat
      timer = setTimeout(() => setIsAnimated(true), 20);
    } else {
      // Önce animasyonu kapat (kapanış animasyonu başlar)
      setIsAnimated(false);
      // Animasyon süresi (300ms) sonunda bileşeni tamamen kaldır
      timer = setTimeout(() => setShouldRender(false), 300);
    }

    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ease-in-out ${
          isAnimated ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          className={`relative w-screen ${widthClass} transform transition-all duration-300 ease-in-out ${
            isAnimated ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
          }`}
        >
          <div className="flex h-full flex-col bg-background shadow-2xl border-l">
            {/* Header */}
            <div className="sticky top-0 bg-background/80 backdrop-blur-md border-b px-6 py-4 flex items-center justify-between z-10 shrink-0">
              <h2 className="text-xl font-bold truncate pr-4 tracking-tight text-foreground">
                {title}
              </h2>
              <div className="flex items-center gap-3">
                {headerActions}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-9 w-9 rounded-full hover:bg-muted transition-colors"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-muted">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SlideOverContentLoader() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-6 bg-muted animate-pulse rounded" />
      ))}
    </div>
  );
}
