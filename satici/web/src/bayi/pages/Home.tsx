// BAYİ ANA SAYFA — kendi tavanı ve kullanımı (başka bayiler görünmez).
import { ceilingSummary } from "../../shared/CeilingFields";
import { useGet } from "../../shared/hooks";
import { CLASS_LABEL, MODULE_LABEL, label } from "../../shared/labels";
import type { DealerSelf } from "../../shared/types";
import { Badge, KeyValues, PageTitle, QueryState, Section } from "../../shared/ui";

export function useDealerSelf() {
  return useGet<DealerSelf>(["ben"], "/ben");
}

export function BayiHomePage() {
  const q = useDealerSelf();
  const d = q.data;
  return (
    <>
      <PageTitle title={d?.ad ?? "Bayi"} sub="Yalnız kendi müşterileriniz; lisanslar tavanınız içinde, kendi imza anahtarınızla." />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {d ? (
        <Section title="Tavanım">
          {!d.anahtarBagli ? <p className="warn-box">İmza anahtarınız henüz bağlanmadı: lisans imzalayamazsınız. Satıcıyla görüşün.</p> : null}
          {d.tavan ? (
            <KeyValues
              items={[
                ["Kurulum kullanımı", `${d.kullanim} / ${d.tavan.kurulumAdedi}`],
                ["Sınıflar", d.tavan.siniflar.map((c) => label(CLASS_LABEL, c)).join(", ")],
                ["Modüller", d.tavan.moduller.map((m) => label(MODULE_LABEL, m)).join(", ") || "—"],
                ...(d.tavan.kanallar ? ([["Kanallar", d.tavan.kanallar.join(", ") || "Yok"]] as const) : []),
                ...(d.tavan.kaliciIzni !== undefined ? ([["Kalıcı lisans", d.tavan.kaliciIzni ? "Verebilirsiniz" : "Veremezsiniz"]] as const) : []),
                ...(d.tavan.bakimAyTavani !== undefined ? ([["Bakım süresi", `en çok ${d.tavan.bakimAyTavani} ay`]] as const) : []),
                ["İmza anahtarı", d.anahtarBagli ? <Badge tone="ok">Bağlı</Badge> : <Badge tone="warn">Bağlı değil</Badge>],
              ]}
            />
          ) : (
            <p className="muted">{ceilingSummary(null)}</p>
          )}
        </Section>
      ) : null}
    </>
  );
}
