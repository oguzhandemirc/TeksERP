import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Package, Search } from "lucide-react";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface OpenSackRoll {
  id: string;
  barcode: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  orderNumber: string | null;
  allocatedQty: number | null;
}

interface OpenSack {
  id: string;
  sackNumber: string;
  weightKg: number | null;
  notes: string | null;
  customer: { id: string; code: string; name: string };
  shipment: { id: string; shipmentNumber: string; status: string } | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  totalRollWeight: number;
  rolls: OpenSackRoll[];
  createdAt: string;
}

function listOpenSacks() {
  return apiClient
    .get<ApiResponse<OpenSack[]>>("/api/sacks/open")
    .then((r) => r.data);
}

export function OpenSacksTab() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["sacks", "open"],
    queryFn: listOpenSacks,
  });

  const sacks: OpenSack[] = query.data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    if (!q) return sacks;
    return sacks.filter(
      (s) =>
        s.sackNumber.toLocaleLowerCase("tr").includes(q) ||
        s.customer.name.toLocaleLowerCase("tr").includes(q) ||
        s.rolls.some((r) =>
          (r.barcode ?? "").toLocaleLowerCase("tr").includes(q),
        ),
    );
  }, [sacks, search]);

  // Müşteriye göre grupla
  const groups = useMemo(() => {
    const m = new Map<
      string,
      { customer: OpenSack["customer"]; sacks: OpenSack[] }
    >();
    for (const s of filtered) {
      const key = s.customer.id;
      if (!m.has(key)) m.set(key, { customer: s.customer, sacks: [] });
      m.get(key)!.sacks.push(s);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.customer.name.localeCompare(b.customer.name, "tr"),
    );
  }, [filtered]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Sevkiyata bağlanmamış çuvallar — tartı/paket operatörü tarafından
          doldurulmuş, sevk bekleyen.
        </p>
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            className="h-8 w-64 pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Çuval no / müşteri / barkod..."
          />
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
          {search
            ? "Arama sonucu yok."
            : "Açık çuval yok — sevkiyata hazırlanmış tüm çuvallar zaten yola çıkmış."}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ customer, sacks: customerSacks }) => {
            const grandTotalQty = customerSacks.reduce(
              (s, sk) => s + sk.totalQty,
              0,
            );
            const grandTotalRolls = customerSacks.reduce(
              (s, sk) => s + sk.rollCount,
              0,
            );
            return (
              <section key={customer.id} className="rounded-md border">
                <header className="bg-muted/40 flex items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="text-muted-foreground h-4 w-4" />
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {customer.code}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs tabular-nums">
                    {customerSacks.length} çuval · {grandTotalRolls} top ·{" "}
                    {grandTotalQty.toLocaleString("tr-TR")} m
                  </div>
                </header>
                <ul className="divide-y">
                  {customerSacks.map((sack) => {
                    const isOpen = expanded.has(sack.id);
                    return (
                      <li key={sack.id}>
                        <button
                          type="button"
                          onClick={() => toggle(sack.id)}
                          className="hover:bg-muted/40 flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors"
                        >
                          <Package className="text-muted-foreground h-4 w-4 shrink-0" />
                          <span className="font-mono text-xs font-semibold">
                            {sack.sackNumber}
                          </span>
                          {sack.shipment ? (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                            >
                              Sevkiyatta: {sack.shipment.shipmentNumber}
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              Depoda
                            </Badge>
                          )}
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {sack.rollCount} top ·{" "}
                            {sack.totalQty.toLocaleString("tr-TR")} m
                          </span>
                          {sack.weightKg != null && (
                            <span className="text-foreground text-xs tabular-nums">
                              · Brüt: {sack.weightKg.toFixed(1)} kg
                            </span>
                          )}
                          {sack.weightKg == null && (
                            <Badge
                              variant="outline"
                              className="border-orange-300 text-[10px] text-orange-700"
                            >
                              Tartılmadı
                            </Badge>
                          )}
                          <span className="text-muted-foreground ml-auto text-xs">
                            {isOpen ? "▼" : "▶"} İçerik
                          </span>
                        </button>

                        {isOpen && (
                          <div className="border-t bg-slate-50/50 px-3 py-2 dark:bg-slate-900/30">
                            {sack.rolls.length === 0 ? (
                              <p className="text-muted-foreground text-xs italic">
                                Bu çuvalda top yok
                              </p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead className="text-muted-foreground">
                                  <tr>
                                    <th className="py-1 text-left font-medium">
                                      Barkod
                                    </th>
                                    <th className="py-1 text-left font-medium">
                                      Ürün
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      En
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Metre
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Kg
                                    </th>
                                    <th className="py-1 text-left font-medium">
                                      Kalite
                                    </th>
                                    <th className="py-1 text-left font-medium">
                                      Sipariş
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sack.rolls.map((roll) => (
                                    <tr key={roll.id} className="border-t">
                                      <td className="py-1 font-mono">
                                        {roll.barcode}
                                      </td>
                                      <td className="py-1">
                                        <span className="text-muted-foreground mr-1.5 font-mono text-[10px]">
                                          {roll.itemCode}
                                        </span>
                                        {roll.itemName}
                                        {roll.colorName && (
                                          <span className="text-muted-foreground">
                                            {" "}
                                            · {roll.colorName}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1 text-right tabular-nums">
                                        {roll.width ?? "—"}
                                      </td>
                                      <td className="py-1 text-right tabular-nums">
                                        {roll.currentQty.toFixed(1)}
                                      </td>
                                      <td className="py-1 text-right tabular-nums">
                                        {roll.weightKg?.toFixed(1) ?? "—"}
                                      </td>
                                      <td className="py-1">
                                        <Badge
                                          variant="muted"
                                          className="text-[10px]"
                                        >
                                          {roll.qualityGrade}
                                        </Badge>
                                      </td>
                                      <td className="py-1 font-mono text-[10px]">
                                        {roll.orderNumber ?? (
                                          <span className="text-muted-foreground">
                                            stok
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {sack.notes && (
                              <p className="text-muted-foreground mt-2 text-xs italic">
                                Not: {sack.notes}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
