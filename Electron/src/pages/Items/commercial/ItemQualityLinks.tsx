// "Ticari" sekmesi — kumaşın kalite bağlantıları (yalnız okuma): bu ürüne özel müşteri lab şartları ve 4 puan kural
// setleri. Müşterinin "tüm ürünler" şartı ve fabrika seti burada sayılmaz; tanım ve düzeltme Kalite ekranlarında.
import { useQuery } from "@tanstack/react-query";
import { customerLabSpecService } from "@/pages/Quality/Certificates/service";
import { ruleSetService } from "@/pages/Quality/InspectionRules/service";
import { COMMERCIAL_PATHS, specRangeText } from "./itemCommercial";
import { CommercialBlock, MutedLine } from "./CommercialBlock";

export function ItemQualityLinks({ itemId, labSpecs, ruleSets }: { itemId: string; labSpecs: boolean; ruleSets: boolean }) {
  return (
    <>
      {labSpecs && <LabSpecs itemId={itemId} />}
      {ruleSets && <RuleSets itemId={itemId} />}
    </>
  );
}

function LabSpecs({ itemId }: { itemId: string }) {
  const q = useQuery({ queryKey: ["customer-lab-specs", "item", itemId], queryFn: () => customerLabSpecService.list({ itemId }) });
  const rows = q.data ?? [];
  return (
    <CommercialBlock
      title="Müşteri lab şartları"
      info="Bu kumaşa özel müşteri şartları (test türü + alt/üst sınır). Lab sonucu girilince sınır dışı değer işaretlenir. Müşterinin tüm ürünlerine geçen şartlar Sertifikalar → Müşteri spesifikasyonları ekranında."
      openLabel="Müşteri spesifikasyonları ekranında aç"
      openPath={COMMERCIAL_PATHS.labSpecs}
    >
      {q.isLoading ? <MutedLine>Yükleniyor…</MutedLine> : q.isError ? <MutedLine>Şartlar okunamadı.</MutedLine> : rows.length === 0 ? (
        <MutedLine>Bu kumaşa özel müşteri şartı yok.</MutedLine>
      ) : (
        <ul className="divide-y text-sm" aria-label="Müşteri lab şartları">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{s.customer.name}</span>
              <span className="text-muted-foreground">{s.testType.name}</span>
              <span className="w-32 text-right tabular-nums">{specRangeText(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </CommercialBlock>
  );
}

function RuleSets({ itemId }: { itemId: string }) {
  const q = useQuery({ queryKey: ["four-point-rules", "item", itemId], queryFn: () => ruleSetService.listForItem(itemId) });
  const rows = q.data ?? [];
  return (
    <CommercialBlock
      title="4 puan kural setleri"
      info="Bu kumaşa özel müşteri kural setleri; muayenede önce müşteri+ürün seti, yoksa müşteri geneli, yoksa fabrika seti uygulanır."
      openLabel="4 Puan Kuralları ekranında aç"
      openPath={COMMERCIAL_PATHS.ruleSets}
    >
      {q.isLoading ? <MutedLine>Yükleniyor…</MutedLine> : q.isError ? <MutedLine>Kural setleri okunamadı.</MutedLine> : rows.length === 0 ? (
        <MutedLine>Bu kumaşa özel kural seti yok — müşteri geneli ya da fabrika seti uygulanır.</MutedLine>
      ) : (
        <ul className="divide-y text-sm" aria-label="4 puan kural setleri">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-muted-foreground">{r.customer?.name ?? "Fabrika"}</span>
              <span className="w-32 text-right tabular-nums">{r.bands.length} bant</span>
            </li>
          ))}
        </ul>
      )}
    </CommercialBlock>
  );
}
