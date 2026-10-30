// Kasa hareketleri KATEGORİ süzgeci (D4-KUC e): düğme → doğrudan modal (combobox yok).
// Değer Masraf Özeti'nin kategori ANAHTARIDIR; istemci anahtar üretmez, seçenek ucundan alır —
// böylece süzülü liste özet satırıyla aynı kovayı görür. Seçenek ucu okunamazsa (eski backend → null) süzgeç gizlenir.
import { useMemo, useState } from "react";
import { Tags } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ParamPickerDialog } from "@/pages/Reports/_v2/ParamPickerDialog";
import { listCashCategoryOptions } from "./categorySuggestions";

interface Props {
  value: string;
  onChange: (key: string) => void;
}

export function CashCategoryFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["finance", "cash-transactions", "categories"],
    queryFn: listCashCategoryOptions,
    staleTime: 60_000,
  });
  const options = useMemo(() => (q.data ?? []).map((o) => ({ deger: o.key, etiket: o.label })), [q.data]);
  if (q.data === null || q.isError) {
    // Seçenekler okunamadı ama URL'den gelen süzgeç etkin: gizli süzgeç eksik liste algısı yaratır — görünür + temizlenebilir.
    if (!value) return null;
    return (
      <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={() => onChange("")}>
        <Tags className="h-4 w-4" />
        Kategori süzgecini kaldır
      </Button>
    );
  }
  const selectedLabel = options.find((o) => o.deger === value)?.etiket;

  return (
    <>
      <Button type="button" variant={value ? "secondary" : "outline"} size="sm" className="h-9 gap-1.5" onClick={() => setOpen(true)}>
        <Tags className="h-4 w-4" />
        {value ? `Kategori: ${selectedLabel ?? "…"}` : "Tüm kategoriler"}
      </Button>
      <ParamPickerDialog
        open={open}
        title="Kategori"
        options={options}
        multiple={false}
        selected={value ? [value] : []}
        allLabel="Tüm kategoriler"
        onApply={(values) => onChange(values[0] ?? "")}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
