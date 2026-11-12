// Cari kartı › Etiket Şablonları › "Etiket alıcıları" (2026-11-10) — emanet topun etiketine basılan "müşterimizin müşterisi".
// Etiket alıcısını tablet doğurur; burada yeniden adlandırılır, birleştirilir, pasife alınır ve etiket şablonu bağlanır
// (sıra: elle seçim > alıcı şablonu > müşteri kuralı > cihaz). Çıkışlı 409'lar satırda çizilir.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { labelTemplateService, type LabelTemplateListRow } from "@/services/labelTemplateService";
import { consigneeService, type ConsigneeRow } from "./consigneeService";
import { consigneeIssueOf, type ConsigneeIssue } from "./consigneeErrors";
import { ConsigneeMergeDialog } from "./ConsigneeMergeDialog";
import { formatQty } from "@/lib/format";

const NO_TEMPLATE = "__none__";

export function CustomerConsigneesPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const key = ["customer-consignees", customerId];
  const list = useQuery({ queryKey: key, queryFn: () => consigneeService.list(customerId) });
  const templates = useQuery({
    queryKey: ["label-templates", "assignable", "consignee-picker"],
    queryFn: () => labelTemplateService.list({ assignable: true }).then((r) => r.data ?? []),
  });
  const [merge, setMerge] = useState<{ source: ConsigneeRow; targetId: string | null } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  if (list.isLoading) return <Skeleton className="h-24 w-full" />;
  const rows = list.data ?? [];
  // Etiket alıcısının şablonu top etiketidir (backend ROLL_FINISHED atanabilirliği); türsüz şablonlar da uyar.
  const usable = (templates.data ?? []).filter((t) => t.isActive && (t.kind == null || t.kind === "ROLL_FINISHED"));

  return (
    <div className="space-y-2" data-testid="customer-consignees">
      <p className="text-xs text-muted-foreground">
        Emanet topun etiketinde "kimin için" basılan adlar. Tablette yazılınca burada belirir. Bir alıcıya şablon
        bağlarsan o alıcının etiketleri bu şablonla basılır (ör. İngilizce/ABD birimli şablon).
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">Henüz alıcı yok.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((c) => (
            <ConsigneeItem
              key={c.id}
              row={c}
              templates={usable}
              onChanged={refresh}
              onMerge={(targetId) => setMerge({ source: c, targetId })}
            />
          ))}
        </ul>
      )}
      {merge && (
        <ConsigneeMergeDialog
          source={merge.source}
          candidates={rows.filter((r) => r.id !== merge.source.id)}
          initialTargetId={merge.targetId}
          onClose={() => setMerge(null)}
          onDone={() => {
            setMerge(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

interface ItemProps {
  row: ConsigneeRow;
  templates: LabelTemplateListRow[];
  onChanged: () => void;
  onMerge: (targetId: string | null) => void;
}

function ConsigneeItem({ row, templates, onChanged, onMerge }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [issue, setIssue] = useState<ConsigneeIssue | null>(null);
  const onError = (e: unknown) => {
    const x = consigneeIssueOf(e);
    if (x.kind === "other") toast.error(x.message);
    else setIssue(x);
  };
  const rename = useMutation({
    mutationFn: () => consigneeService.rename(row.id, name),
    onSuccess: () => { setEditing(false); setIssue(null); onChanged(); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: () => (row.isActive ? consigneeService.deactivate(row.id) : consigneeService.activate(row.id)),
    onSuccess: () => { setIssue(null); onChanged(); },
    onError,
  });
  const template = useMutation({
    mutationFn: (id: string | null) => consigneeService.setTemplate(row.id, id),
    onSuccess: () => { toast.success("Etiket alıcısının şablonu güncellendi."); onChanged(); },
  });
  const busy = rename.isPending || toggle.isPending || template.isPending;
  const tplMissing = row.labelTemplate && !templates.some((t) => t.id === row.labelTemplate?.id);

  return (
    <li className="space-y-2 p-3 text-sm" data-testid={`consignee-row-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <Input className="h-8 w-56" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} data-testid="consignee-rename-input" />
        ) : (
          <span className={`min-w-40 font-medium ${row.isActive ? "" : "text-muted-foreground line-through"}`}>{row.name}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {row.liveRollCount} canlı top · son kullanım {formatFactory(row.lastUsedAt, "dd.MM.yyyy")}
          {!row.isActive && " · pasif"}
        </span>
        <PermissionGate permission="customer:write">
          <div className="ml-auto flex gap-1">
            {editing ? (
              <>
                <Button size="sm" disabled={busy || !name.trim()} onClick={() => rename.mutate()} data-testid="consignee-rename-save">Kaydet</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(row.name); setIssue(null); }}>Vazgeç</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="consignee-rename">Adı düzelt</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onMerge(null)} data-testid="consignee-merge">Birleştir…</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle.mutate()} data-testid="consignee-toggle">
              {row.isActive ? "Pasife al" : "Aktifleştir"}
            </Button>
          </div>
        </PermissionGate>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Etiket şablonu</span>
        <PermissionGate permission="customer:write" fallback={<span>{row.labelTemplate?.name ?? "Müşterinin şablonu"}</span>}>
          <Select value={row.labelTemplate?.id ?? NO_TEMPLATE} disabled={busy} onValueChange={(v) => template.mutate(v === NO_TEMPLATE ? null : v)}>
            <SelectTrigger className="h-8 max-w-xs" data-testid="consignee-template"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>Müşterinin şablonu</SelectItem>
              {tplMissing && row.labelTemplate && <SelectItem value={row.labelTemplate.id}>{row.labelTemplate.name} (pasif)</SelectItem>}
              {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </PermissionGate>
      </div>
      {issue && <IssueBox issue={issue} onMerge={onMerge} />}
    </li>
  );
}

function IssueBox({ issue, onMerge }: { issue: ConsigneeIssue; onMerge: (targetId: string | null) => void }) {
  if (issue.kind === "other") return null;
  return (
    <div data-testid="consignee-issue"><Callout tone="warning">
      <p>{issue.message}</p>
      {issue.kind === "in-use" && (
        <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-xs" data-testid="consignee-blocking-rolls">
          {issue.rolls.map((r) => <li key={r.id}>{r.barcode ?? "barkodsuz"} · {formatQty(r.meters)} m</li>)}
        </ul>
      )}
      <Button size="sm" variant="outline" className="mt-2" onClick={() => onMerge(issue.kind === "name-taken" ? issue.conflictId : null)} data-testid="consignee-issue-merge">
        Başka alıcıyla birleştir
      </Button>
    </Callout></div>
  );
}
