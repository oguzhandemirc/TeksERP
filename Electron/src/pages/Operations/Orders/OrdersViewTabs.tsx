// SY-K2 — Siparişler ekranının iki görünümü: sipariş listesi · üretim planı (satır + renk). Yeni menü YOK;
// sekme URL'de (`view=plan`), böylece kayıtlı görünüm (URL anlığı) sekmeyi ve renk süzgecini birlikte saklar.
import { useSearchParams } from "react-router-dom";
import { PageTabs } from "@/components/layout/PageTabs";

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
  return <PageTabs label="Siparişler görünümü" tabs={TABS.map((t) => ({ key: t.view, label: t.label }))} active={view} onSelect={(k) => select(k as OrdersView)} />;
}
