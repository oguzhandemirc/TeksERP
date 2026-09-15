// =============================================================================
// FASON DOKUMA (G1p) — İPLİK şeridi: iş toplamları (giden · dönen · sarılan · kalan) + fasoncu bakiyesi
// =============================================================================
// Toplamlar sevk özetinden (iptal edilmemiş sevkler); fasoncu bakiyesi K1(b) TÜRETİLMİŞ uçtan
// (`/api/subcontractor/:id/yarn-balance`, kalem × lot). `sarilanKaynak` görünür: "ölçüldü mü
// hesaplandı mı" gizlenmez. Yalnız iplik modülü ETKİN iken çizilir (ebeveyn karar verir).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Callout } from "@/components/ui/callout";
import { formatKg } from "@/pages/Operations/WarpBeams/types";
import { kgSourceLabel } from "./fason-summary";
import { fasonWeavingService } from "./service";
import { Stat } from "./FasonLists";
import type { FasonYarnTotals } from "./types";
import { FASON_QUERY_KEY } from "./useFasonMutations";

export function FasonYarnStrip({ totals, subcontractorId }: { totals: FasonYarnTotals | undefined; subcontractorId: string | null }) {
  const balance = useQuery({
    queryKey: [FASON_QUERY_KEY, "yarn-balance", subcontractorId],
    queryFn: () => fasonWeavingService.yarnBalance(subcontractorId ?? ""),
    enabled: Boolean(subcontractorId),
  });
  const rows = balance.data?.data ?? [];
  return (
    <div className="space-y-2">
      {totals && (
        <div className="grid grid-cols-4 gap-2 rounded-md border p-3 text-sm">
          <Stat label="Giden iplik" value={formatKg(totals.sentKg)} />
          <Stat label="Dönen iplik" value={formatKg(totals.returnedKg)} />
          <Stat label="Sarılan (levent)" value={formatKg(totals.woundKg)} hint="nominal kg — kaynağı satırda beyanlı" />
          <Stat label="Fasonda kalan" value={formatKg(totals.remainingKg)} hint="giden − dönen − sarılan (türetilmiş)" />
        </div>
      )}
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Fasoncudaki iplik (tüm işler, kalem × lot)</h3>
        {balance.isError ? (
          <Callout tone="danger">Fasoncu iplik bakiyesi alınamadı — bu bir “iplik yok” cevabı DEĞİLDİR (iplik modülü kapalı, yetki yok ya da ağ).</Callout>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu fasoncuda iplik yok.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-normal">Kalem</th>
                <th className="text-left font-normal">Lot</th>
                <th className="text-right font-normal">Giden</th>
                <th className="text-right font-normal">Dönen</th>
                <th className="text-right font-normal">Sarılan</th>
                <th className="text-left font-normal">Kaynak</th>
                <th className="text-right font-normal">Kalan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.itemId}|${r.lotId ?? ""}`} className="border-t">
                  <td className="font-mono">{r.itemCode}</td>
                  <td>{r.lotNo ?? "—"}</td>
                  <td className="text-right tabular-nums">{formatKg(r.outKg)}</td>
                  <td className="text-right tabular-nums">{formatKg(r.returnedKg)}</td>
                  <td className="text-right tabular-nums">{formatKg(r.sarilanKg)}</td>
                  <td className="text-xs text-muted-foreground">{kgSourceLabel(r.sarilanKaynak)}</td>
                  <td className="text-right font-semibold tabular-nums">{formatKg(r.remainingKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
