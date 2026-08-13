import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listCari, money, type CariRow } from "./service";
import { StatementDialog } from "./StatementDialog";

export function CariPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [statementFor, setStatementFor] = useState<CariRow | null>(null);

  const q = useQuery({
    queryKey: ["finance", "cari", search, kind, onlyWithBalance],
    queryFn: () =>
      listCari({
        page: 1,
        pageSize: 100,
        search: search || undefined,
        kind: kind || undefined,
        onlyWithBalance,
      }),
  });

  const rows = q.data?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Cari Hesaplar"
        description="Bakiye POZİTİF ise cari size borçlu (alacağınız), NEGATİF ise siz ona borçlusunuz."
      />

      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Müşteri / fason ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Tümü</option>
          <option value="CUSTOMER">Müşteriler</option>
          <option value="SUBCONTRACTOR">Fason firmalar</option>
        </select>
        <Button
          variant={onlyWithBalance ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyWithBalance((v) => !v)}
        >
          Yalnız bakiyesi olanlar
        </Button>
      </div>

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {/* Cari LAZY açılır — boş liste "bozuk" değil "henüz işlem yok" demektir
                ve kullanıcı bunu bilmezse ekranı hatalı sanır. */}
            Henüz cari hesap yok. Cari hesaplar ilk fatura ya da tahsilat kaydedildiğinde
            kendiliğinden açılır.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Kod</th>
                  <th className="px-3 py-2 text-left">Ünvan</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Vade</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">
                        {c.kind === "CUSTOMER" ? "Müşteri" : "Fason"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.paymentTermDays != null ? `${c.paymentTermDays} gün` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* ⚠️ Para birimleri AYRI satırlarda — tek sayıya indirmek
                          1000 USD ile 30.000 TL'yi toplamak olurdu. */}
                      {c.balances.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          {c.balances.map((b) => (
                            <span
                              key={b.currency}
                              className={
                                b.balance > 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"
                              }
                            >
                              {money(b.balance, b.currency)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setStatementFor(c)}>
                        <FileSpreadsheet className="mr-1 h-4 w-4" />
                        Ekstre
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      {statementFor && (
        <StatementDialog cari={statementFor} open onOpenChange={() => setStatementFor(null)} />
      )}
    </PageShell>
  );
}
