import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { NumberingFormDialog } from "./NumberingFormDialog";
import { NumberingTable } from "./NumberingTable";
import { numberingService } from "./service";
import type { NumberSeriesRow, SeriesExhaustion } from "./types";

const NUMBERING_KEY = ["number-series"] as const;

/**
 * Satırları BÖLÜMLERE ayırır — sıra SUNUCUDAN gelir (satırlar grup sırasında
 * dizili), başlık da satırın kendisinden. Panelde ne grup listesi ne etiket
 * kopyası tutulur: ikisi de tutulsaydı backend yeni bir grup eklediğinde satır
 * SESSİZCE düşerdi ("kaydedilen ama görünmeyen kayıt" sınıfı).
 */
function bolumlereAyir(rows: NumberSeriesRow[]): Array<{ key: string; label: string; rows: NumberSeriesRow[] }> {
  const out: Array<{ key: string; label: string; rows: NumberSeriesRow[] }> = [];
  for (const r of rows) {
    const son = out[out.length - 1];
    if (son && son.key === r.panelGroup) son.rows.push(r);
    else out.push({ key: r.panelGroup, label: r.panelGroupLabel || r.panelGroup, rows: [r] });
  }
  return out;
}

/**
 * NUMARALANDIRMA — numara biçimi VERİ, kod değil.
 *
 * ⚠️ KİLİTLİ SERİLER DE ÇİZİLİR ve gerekçeleriyle: "çuval numarası neden burada
 * yok?" sorusunun ekranda cevabı YOKTUR, "neden kilitli?" sorusununki VARDIR.
 * Üç kilit sınıfı üç FARKLI cümle taşır çünkü üçü farklı gün kalkar — ve
 * kullanıcı yalnız BİRİNİ (saha güncellemesi) kendisi çözebilir.
 */
export function NumberingPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: NUMBERING_KEY,
    queryFn: numberingService.list,
    staleTime: 60_000,
  });
  const [secili, setSecili] = useState<NumberSeriesRow | null>(null);
  const [etki, setEtki] = useState<number | null>(null);
  const [tukenme, setTukenme] = useState<SeriesExhaustion | null>(null);

  // Etki sayısı SUNUCUDAN, seri seçildiğinde. Uydurulmaz.
  useEffect(() => {
    if (!secili) return;
    let iptal = false;
    setEtki(null);
    setTukenme(null);
    void numberingService.impact(secili.key).then((n) => { if (!iptal) setEtki(n); });
    void numberingService.exhaustion(secili.key).then((d) => { if (!iptal) setTukenme(d); });
    return () => { iptal = true; };
  }, [secili]);

  const bolumler = bolumlereAyir(rows);

  return (
    <PageShell>
      <PageHeader
        title="Numaralandırma"
        description="Belge, kart ve kod serilerinin numara biçimi. Değişiklik yalnız bundan sonra açılacak kayıtları etkiler; geçmiş numaralar ve basılmış belgeler değişmez."
        actions={<RefreshButton queryKey={[...NUMBERING_KEY]} successMessage="Seriler yenilendi" />}
      />
      <PageBody className="p-6">
        <div className="space-y-5">
          {bolumler.map((b) => (
            <section key={b.key} className="overflow-hidden rounded-lg border bg-card">
              <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
                <h2 className="text-sm font-semibold">{b.label}</h2>
                <span className="text-xs text-muted-foreground">{b.rows.length} seri</span>
              </header>
              <NumberingTable rows={b.rows} onEdit={setSecili} />
            </section>
          ))}
        </div>

        <NumberingFormDialog
          row={secili}
          etkiSayisi={etki}
          exhaustion={tukenme}
          /* ⚠️ Birim BACKEND'den: panel "hangi seri belge sayar" kuralını
             KOPYALAMAZ — kural iki yerde yaşarsa biri bayatlar. */
          birim={secili?.countBirim === "belge" ? "belgenin" : "kaydın"}
          onClose={() => setSecili(null)}
          onSaved={() => { setSecili(null); void qc.invalidateQueries({ queryKey: NUMBERING_KEY }); }}
        />
      </PageBody>
    </PageShell>
  );
}
