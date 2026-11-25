import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
  placeholder?: string;
  disabled?: boolean;
  /** Etiketin `htmlFor`u — FormField etiketi tetikleyiciye bağlansın (erişilebilir ad). */
  id?: string;
}

export function EnumSelect<T extends string>({ value, onChange, labels, placeholder, disabled, id }: Props<T>) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger id={id}>
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
