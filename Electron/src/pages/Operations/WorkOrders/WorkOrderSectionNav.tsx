import { useEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

export interface NavSection {
  id: string;
  label: string;
}

/**
 * Sticky bölüm navigasyonu — uzun detay sayfasında yön bulma. Tıklayınca ilgili
 * bölüme kaydırır; scroll-spy ile o an görünen bölümü tema primary'siyle vurgular.
 * IntersectionObserver kökü, sayfanın scroll konteyneri (scrollRef).
 */
export function WorkOrderSectionNav({
  sections,
  scrollRef,
}: {
  sections: NavSection[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      // Üst ~%22'lik bant: aktif = o an tepeye en yakın geçen bölüm.
      { root, rootMargin: "-22% 0px -70% 0px", threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections, scrollRef]);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 py-2">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              active === s.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
