// =============================================================================
// İPLİK LOTU KUTUSU — seçici değil ARAMA (lot listesi ucu yok)
// =============================================================================
// Lot numarası serbest metindir ve birebir eşleşir. Kutu ENTER ya da odak
// kaybında uygulanır: her harfte sorgu atmak, 64 karakterlik bir lot numarası
// için 64 rapor isteği demektir.
// =============================================================================
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOT_MAX } from "../_hooks/useBeamLot";

export function LotInput({ id, value, onChange }: { id: string; value: string; onChange: (lot: string) => void }) {
  const [draft, setDraft] = useState(value);
  // URL dışarıdan değişirse (geri tuşu, paylaşılan bağlantı) kutu onu izler.
  useEffect(() => setDraft(value), [value]);
  const uygula = () => {
    if (draft.trim() !== value) onChange(draft);
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>İplik lotu</Label>
      <Input
        id={id}
        value={draft}
        maxLength={LOT_MAX}
        placeholder="Lot no (birebir)"
        className="w-48"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={uygula}
        onKeyDown={(e) => {
          if (e.key === "Enter") uygula();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </div>
  );
}
