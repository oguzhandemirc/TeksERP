// DESEN KARTLARI listesi (Seyitoğlu SY-A3, tasarım §2.8) — Tanımlar → Üretim karosu, `dokumaEnabled`.
// Liste armür ızgarasını taşımaz (sunucu süzer); satır tıklanınca kart sayfası açılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { WeaveDesignCreateDialog } from "./WeaveDesignCreateDialog";
import { weaveDesignApi } from "./service";
import { WEAVE_KIND_LABEL } from "./types";

export const WEAVE_DESIGNS_QUERY_KEY = "weave-designs";

export function WeaveDesignsPage() {
  const nav = useNavigate();
  const { hasPermission } = useRoleAccess();
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const list = useQuery({
    queryKey: [WEAVE_DESIGNS_QUERY_KEY, "list", q, includeInactive],
    queryFn: () => weaveDesignApi.list({ search: q || undefined, includeInactive }),
  });
  const rows = list.data ?? [];
  return (
    <PageShell>
      <PageHeader
        title="Desen Kartları"
        description="Örgü türü · armür planı · atkı sırası · varyantlar. Bir desen birden çok kumaşı besler."
        actions={hasPermission("warpspec:write") && (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni desen</Button>
        )}
      />
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 sm:px-6">
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Desen kodu veya adı ara..." aria-label="Desen ara" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} aria-label="Pasifleri göster" />
          Pasifleri göster
        </label>
      </div>
      <PageBody className="min-h-0 p-4 sm:p-6">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{q ? "Aramaya uyan desen yok." : "Henüz desen kartı yok."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Ad</TableHead>
                <TableHead>Örgü</TableHead>
                <TableHead>Aile</TableHead>
                <TableHead className="text-right">Çerçeve</TableHead>
                <TableHead className="text-right">Desen boyu (cm)</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => nav(`/definitions/weave-designs/${r.id}`)}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{WEAVE_KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                  <TableCell>{r.familyLabel ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.frameCount ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.repeatCm ?? "—"}</TableCell>
                  <TableCell>{r.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
      {createOpen && (
        <WeaveDesignCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => nav(`/definitions/weave-designs/${id}`)}
        />
      )}
    </PageShell>
  );
}
