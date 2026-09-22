import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { NumberingFormDialog } from "./NumberingFormDialog";
import { NumberingTable } from "./NumberingTable";
import { numberingService } from "./service";
import type { NumberSeriesRow } from "./types";

const NUMBERING_KEY = ["number-series"] as const;

/** Faz C yalnız SEVKİYAT ailesini açar; Faz D bu etiketi genişletir. */
const GORUNEN_GRUP = "sevkiyat";

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

  // Etki sayısı SUNUCUDAN, seri seçildiğinde. Uydurulmaz.
  useEffect(() => {
    if (!secili) return;
    let iptal = false;
    setEtki(null);
    void numberingService.impact(secili.key).then((n) => { if (!iptal) setEtki(n); });
    return () => { iptal = true; };
  }, [secili]);

  const gorunen = rows.filter((r) => r.panelGroup === GORUNEN_GRUP);

  return (
    <PageShell>
      <PageBody>
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Numaralandırma</h1>
            <p className="text-sm text-muted-foreground">
              Sevkiyat ailesinin numara biçimi. Değişiklik yalnız BUNDAN SONRA açılacak
              kayıtları etkiler; geçmiş numaralar ve basılmış belgeler değişmez.
            </p>
          </div>

          <NumberingTable rows={gorunen} onEdit={setSecili} />
        </div>

        <NumberingFormDialog
          row={secili}
          etkiSayisi={etki}
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
