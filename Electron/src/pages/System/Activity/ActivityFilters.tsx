import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { systemLogService } from "@/services/systemLogService";
import { tableLabel, actionLabels } from "./labels";
import type { SystemLogDomainAction } from "@/types/systemLog";

export interface ActivityFilterState {
  userId?: string;
  tableName?: string;
  action?: SystemLogDomainAction;
  dateFrom?: string;
  dateTo?: string;
}

interface Props {
  value: ActivityFilterState;
  onChange: (next: ActivityFilterState) => void;
}

const ANY = "__any__";

export function ActivityFilters({ value, onChange }: Props) {
  const usersQuery = useQuery({
    queryKey: ["system-log-users"],
    queryFn: () => systemLogService.users().then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tablesQuery = useQuery({
    queryKey: ["system-log-tables"],
    queryFn: () => systemLogService.tables().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const hasActiveFilter = !!(
    value.userId ||
    value.tableName ||
    value.action ||
    value.dateFrom ||
    value.dateTo
  );

  const set = <K extends keyof ActivityFilterState>(
    key: K,
    raw: string | undefined,
  ) => {
    onChange({ ...value, [key]: raw && raw !== ANY ? raw : undefined });
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-b bg-card/30 px-6 py-3">
      <Field label="Kullanıcı">
        <Select value={value.userId ?? ANY} onValueChange={(v) => set("userId", v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(usersQuery.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.fullName || u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Modül">
        <Select value={value.tableName ?? ANY} onValueChange={(v) => set("tableName", v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(tablesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>
                {tableLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="İşlem">
        <Select value={value.action ?? ANY} onValueChange={(v) => set("action", v)}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(Object.keys(actionLabels) as SystemLogDomainAction[]).map((a) => (
              <SelectItem key={a} value={a}>
                {actionLabels[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Başlangıç">
        <Input
          type="date"
          className="h-9 w-40"
          value={value.dateFrom?.slice(0, 10) ?? ""}
          onChange={(e) =>
            set("dateFrom", e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined)
          }
        />
      </Field>

      <Field label="Bitiş">
        <Input
          type="date"
          className="h-9 w-40"
          value={value.dateTo?.slice(0, 10) ?? ""}
          onChange={(e) =>
            set("dateTo", e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined)
          }
        />
      </Field>

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
          className="h-9 gap-1 text-muted-foreground"
        >
          <X className="h-3 w-3" />
          Temizle
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
