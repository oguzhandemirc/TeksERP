import { useQuery } from "@tanstack/react-query";
import { Warehouse } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerBranchService } from "./branchService";

const NULL_SENTINEL = "__none__";

interface Props {
  customerId: string | null | undefined;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  nullable?: boolean;
  noneLabel?: string;
  disabled?: boolean;
}

export function BranchSelect({
  customerId,
  value,
  onChange,
  nullable = true,
  noneLabel = "— (şube seçilmedi)",
  disabled: disabledProp,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-branches", customerId, "select"],
    queryFn: () => customerBranchService.list(customerId as string, false),
    enabled: Boolean(customerId),
    staleTime: 60_000,
  });

  const branches = data?.data ?? [];
  const noCustomer = !customerId;
  const noBranches = !isLoading && branches.length === 0;
  const disabled = disabledProp || noCustomer || (noBranches && !nullable);

  const placeholder = noCustomer
    ? "Önce müşteri seçin"
    : isLoading
      ? "Yükleniyor..."
      : noBranches
        ? "Bu müşterinin aktif şubesi yok"
        : "Şube seç...";

  const current = value ?? (nullable ? NULL_SENTINEL : undefined);

  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NULL_SENTINEL ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <div className="flex items-center gap-2 min-w-0">
          <Warehouse className="h-4 w-4 shrink-0 text-primary" />
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent>
        {nullable && (
          <SelectItem value={NULL_SENTINEL} className="text-muted-foreground">
            {noneLabel}
          </SelectItem>
        )}
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
            {b.city && <span className="text-muted-foreground"> — {b.city}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
