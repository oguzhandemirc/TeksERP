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
      // Bir sonraki render cycle'da animasyonu başlat
      timer = setTimeout(() => setIsAnimated(true), 10);
    } else {
      setIsAnimated(false);
      // Animasyon süresi (300ms) sonunda bileşeni DOM'dan kaldır
      timer = setTimeout(() => setShouldRender(false), 300);
    }

    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
      {/* Arka Plan (Backdrop) */}
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 ease-in-out ${
          isAnimated ? "opacity-50" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`relative w-full ${widthClass} bg-background border-l shadow-xl flex flex-col transition-transform duration-300 ease-in-out transform ${
          isAnimated ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between z-10 shrink-0">
          <h2 className="text-lg font-semibold truncate pr-4">{title}</h2>
          <div className="flex items-center gap-2">
            {headerActions}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
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
