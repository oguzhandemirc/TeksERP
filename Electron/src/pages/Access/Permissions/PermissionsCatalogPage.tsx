import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Smartphone, Shield, Search, Info, Asterisk } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/RefreshButton";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import { categoryLabels, moduleLabels, isWildcard, type Permission } from "@/types/permissions";
import { cn } from "@/lib/utils";

const QUERY_KEY = "permission-catalog";

const categoryIcons: Record<string, typeof Monitor> = {
  web: Monitor,
  mobile: Smartphone,
  admin: Shield,
};

export function PermissionsCatalogPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: permissionCatalogService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const grouped = useMemo(() => {
    const list = (query.data?.data ?? []).filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.code.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (moduleLabels[p.module] ?? p.module).toLowerCase().includes(q)
      );
    });

    const byCat = new Map<string, Map<string, Permission[]>>();
    for (const p of list) {
      const cat = byCat.get(p.category) ?? new Map<string, Permission[]>();
      const arr = cat.get(p.module) ?? [];
      arr.push(p);
      cat.set(p.module, arr);
      byCat.set(p.category, cat);
    }
    return byCat;
  }, [query.data, search]);

  return (
    <PageShell>
      <PageHeader
        title="Yetki Kataloğu"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kod, açıklama veya modül..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Toplam{" "}
          <span className="text-foreground font-medium">
            {query.data?.data.length ?? 0}
          </span>{" "}
          yetki
        </div>
      </div>

      <PageBody className="overflow-x-hidden p-6">
        {query.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : grouped.size === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Eşleşen yetki yok.
          </div>
        ) : (
          <div className="rounded-md border">
            <Table containerClassName="overflow-visible" className="table-fixed">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-72">Yetki</TableHead>
                  <TableHead>Açıklama</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(grouped.entries()).map(([category, modules]) => {
                  const Icon = categoryIcons[category] ?? Shield;
                  const total = Array.from(modules.values()).reduce((a, l) => a + l.length, 0);
                  return (
                    <Fragment key={category}>
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={2} className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {categoryLabels[category] ?? category}
                            </span>
                            <Badge variant="muted" className="font-normal">
                              {total}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {Array.from(modules.entries()).map(([module, perms]) => (
                        <Fragment key={module}>
                          <TableRow className="bg-muted/10">
                            <TableCell colSpan={2} className="py-1.5 pl-7">
                              <span className="text-sm font-medium">{moduleLabels[module] ?? module}</span>
                            </TableCell>
                          </TableRow>
                          {perms.map((p) => {
                            const wild = isWildcard(p.code);
                            return (
                              <TableRow key={p.id} className={cn(wild && "bg-destructive/5")}>
                                <TableCell className="py-1.5 pl-10">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span
                                      className={cn(
                                        "truncate font-mono text-xs",
                                        wild && "font-semibold text-destructive",
                                      )}
                                      title={p.code}
                                    >
                                      {p.code}
                                    </span>
                                    {wild && (
                                      <Badge
                                        variant="destructive"
                                        className="shrink-0 text-[10px]"
                                        title="Bu yetki, kategorideki tüm alt yetkileri otomatik kapsar."
                                      >
                                        tüm yetkiler
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="break-words py-1.5 text-xs text-muted-foreground">
                                  {p.description}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-6 space-y-2">
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <Asterisk className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div>
              <span className="font-medium text-destructive">"tüm yetkiler" rozeti</span> taşıyan kodlar (örn.{" "}
              <code className="rounded bg-muted px-1 font-mono">admin:*</code>,{" "}
              <code className="rounded bg-muted px-1 font-mono">mobile:*</code>) ait olduğu kategoriye yeni eklenen yetkiler dahil <span className="font-medium">o kategorideki tüm yetkileri otomatik kapsar</span>. Dikkatli ata.
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Yetki tanımları sistem kurulumunda <span className="font-mono">seed</span> dosyasından yüklenir. Yeni yetki eklemek için backend tarafında tanımlanması gerekir.
            </div>
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}
