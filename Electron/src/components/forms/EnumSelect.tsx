import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
  placeholder?: string;
  disabled?: boolean;
}

export function EnumSelect<T extends string>({ value, onChange, labels, placeholder, disabled }: Props<T>) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? "Seç..."} />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(labels) as [T, string][]).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
