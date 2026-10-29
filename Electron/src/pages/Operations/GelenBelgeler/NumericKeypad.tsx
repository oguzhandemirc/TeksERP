// Büyük sayısal klavye (dokunmatik/fare) — fiziksel klavye de çalışır (girdi kutusu odakta kalır).
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ",", "0"] as const;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export function NumericKeypad({ value, onChange, onSubmit, disabled }: Props) {
  const press = (k: string) => {
    if (k === "," && value.includes(",")) return;
    onChange(value + k);
  };
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Sayısal klavye">
      {KEYS.map((k) => (
        <Button key={k} type="button" variant="outline" className="h-14 text-2xl" disabled={disabled} onClick={() => press(k)}>
          {k}
        </Button>
      ))}
      <Button type="button" variant="outline" className="h-14" disabled={disabled} aria-label="Sil" onClick={() => onChange(value.slice(0, -1))}>
        <Delete className="h-6 w-6" />
      </Button>
      <Button type="button" variant="ghost" className="h-14 text-base" disabled={disabled} onClick={() => onChange("")}>
        Temizle
      </Button>
      <Button type="button" className="col-span-2 h-14 text-lg" disabled={disabled} onClick={onSubmit}>
        Onayla ve sonraki
      </Button>
    </div>
  );
}
