// SY-K2 — Siparişler ekranının iki görünümü: sipariş listesi · üretim planı (satır + renk). Yeni menü YOK;
// sekme URL'de (`view=plan`), böylece kayıtlı görünüm (URL anlığı) sekmeyi ve renk süzgecini birlikte saklar.
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

export type OrdersView = "list" | "plan";

export function readOrdersView(params: URLSearchParams): OrdersView {
  return params.get("view") === "plan" ? "plan" : "list";
}

const TABS: Array<{ view: OrdersView; label: string }> = [
  { view: "list", label: "Siparişler" },
  { view: "plan", label: "Üretim planı" },
];

export function OrdersViewTabs({ view }: { view: OrdersView }) {
  const [, setSearchParams] = useSearchParams();
  // Sekme değişince öteki görünümün süzgeç/sayfa anahtarları taşınmaz (iki görünüm ayrı küme sayar).
  const select = (v: OrdersView) => setSearchParams(v === "plan" ? new URLSearchParams({ view: "plan" }) : new URLSearchParams());
  return (
    <div className="flex shrink-0 gap-1 px-3 pt-2" role="tablist" aria-label="Siparişler görünümü">
      {TABS.map((t) => (
        <Button key={t.view} type="button" role="tab" aria-selected={view === t.view} size="sm" variant={view === t.view ? "default" : "ghost"} className="h-8" onClick={() => select(t.view)}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}
