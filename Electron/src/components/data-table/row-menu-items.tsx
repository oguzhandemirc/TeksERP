import { toast } from "sonner";
import { Copy, PanelTop, SquareArrowOutUpRight, SquarePlus } from "lucide-react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useTabsStore } from "@/store/tabs";

/**
 * Sekme-duyarlı navigasyon. Sağ-tık menüsünde "bu sekme / yeni sekme / arka plan"
 * seçenekleri açıkça sunulduğu için olay-tabanlı `useOpenTarget` yerine doğrudan
 * store aksiyonlarını kullanırız.
 */
export function useRowNav() {
  const openTab = useTabsStore((s) => s.openTab);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return {
    openHere: (path: string, state?: unknown) => navigateActive(path, { state }),
    openNewTab: (path: string, state?: unknown) => openTab(path, { forceNew: true, state }),
    openBackground: (path: string, state?: unknown) =>
      openTab(path, { forceNew: true, background: true, state }),
  };
}

/** Bir hedef rotayı bu sekmede / yeni sekmede / arka planda açan 3 standart öğe. */
export function RowOpenItems({
  path,
  openLabel = "Tam ekran aç",
  state,
}: {
  path: string;
  openLabel?: string;
  state?: unknown;
}) {
  const nav = useRowNav();
  return (
    <>
      <ContextMenuItem onSelect={() => nav.openHere(path, state)}>
        <SquareArrowOutUpRight /> {openLabel}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => nav.openNewTab(path, state)}>
        <SquarePlus /> Yeni sekmede aç
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => nav.openBackground(path, state)}>
        <PanelTop /> Arka planda yeni sekmede aç
      </ContextMenuItem>
    </>
  );
}

/** Bir metni panoya kopyalayan öğe. Değer boşsa hiç render edilmez. */
export function CopyMenuItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <ContextMenuItem
      onSelect={() => {
        void navigator.clipboard.writeText(value);
        toast.success(`${label} kopyalandı`);
      }}
    >
      <Copy /> {label} kopyala
    </ContextMenuItem>
  );
}
