// Cari kayıt sayfası — Hesap hareketleri: MEVCUT ekstre ucu (`/finance/cari/:id/statement`), son 90 gün,
// PARA BİRİMİ BAŞINA (birim seçilir; birimler asla toplanmaz). Dönem/yazdırma için tam ekstre diyaloğu.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { RecordTable } from "@/components/record/RecordTable";
import { cn } from "@/lib/utils";
import { factoryDayEndIso, factoryDayKey, factoryDayStartIso } from "@/lib/factory-time";
import { getStatement, money, type CariRow, type Currency } from "@/pages/Finance/service";
import { StatementDialog } from "@/pages/Finance/StatementDialog";
import { gunCari } from "./cari-time";

const DAYS = 90;

/** Hesabın birimleri: bakiyesi olanlar + varsayılan birim (tekrarsız, varsayılan önde). */
export function ledgerCurrencies(acc: Pick<CariRow, "balances" | "defaultCurrency">): Currency[] {
  return [...new Set([acc.defaultCurrency, ...(acc.balances ?? []).map((b) => b.currency)])];
}

export function CariLedgerTab({ account }: { account: CariRow }) {
  const currencies = ledgerCurrencies(account);
  const [currency, setCurrency] = useState<Currency>(currencies[0]!);
  const [full, setFull] = useState(false);
  const range = useMemo(() => {
    const to = factoryDayKey(new Date());
    const from = factoryDayKey(new Date(Date.now() - DAYS * 86_400_000));
    return { from: factoryDayStartIso(from), to: factoryDayEndIso(to) };
  }, []);
  const q = useQuery({
    queryKey: ["finance", "cari", "statement-tab", account.id, currency, range.from],
    queryFn: () => getStatement({ cariId: account.id, currency, ...range }),
  });
  const s = q.data;
  return (
    <SectionCard
      title="Hesap hareketleri"
      description={`Son ${DAYS} gün · ${s ? `devir ${money(s.opening, currency)} → kapanış ${money(s.closing, currency)}` : "yükleniyor"}`}
      action={
        <>
          {currencies.length > 1 && (
            <div role="group" aria-label="Para birimi" className="flex rounded-lg border border-card-border p-0.5">
              {currencies.map((c) => (
                <button key={c} type="button" aria-pressed={c === currency} onClick={() => setCurrency(c)} className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", c === currency ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setFull(true)}>Tam ekstre</Button>
        </>
      }
      flush
    >
      <RecordTable
        rows={s?.rows ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Bu dönemde hareket yok."
        rowKey={(r) => r.id}
        rowMuted={(r) => Boolean(r.reversedByTxnId)}
        columns={[
          { key: "date", label: "Tarih", render: (r) => gunCari(r.txnDate) },
          { key: "doc", label: "Belge", render: (r) => <span className="font-semibold tabular-nums">{r.docNo ?? "—"}</span> },
          { key: "desc", label: "Açıklama", className: "max-w-[22rem] truncate", title: (r) => r.description ?? r.sourceType, render: (r) => r.description ?? r.sourceType },
          { key: "debit", label: "Borç", align: "right", render: (r) => (r.debit ? money(r.debit, currency) : "") },
          { key: "credit", label: "Alacak", align: "right", render: (r) => (r.credit ? money(r.credit, currency) : "") },
          { key: "run", label: "Bakiye", align: "right", render: (r) => <span className="font-semibold">{money(r.running, currency)}</span> },
        ]}
      />
      {full && <StatementDialog cari={account} open onOpenChange={() => setFull(false)} />}
    </SectionCard>
  );
}
