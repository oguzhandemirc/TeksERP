// Elle satır ekleme. Parti token'ı mantıksal deneme başına (useAttemptToken): zaman aşımı tekrarı satırı ikilemez.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import { addLines } from "./service";
import { parseTrNumber } from "./review-queue";

interface Props {
  noteId: string;
  defaultBlock: number;
  onAdded: () => void;
}

export function AddLineForm({ noteId, defaultBlock, onAdded }: Props) {
  const [meters, setMeters] = useState("");
  const [kg, setKg] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [block, setBlock] = useState(String(defaultBlock));
  const attempt = useAttemptToken();
  // Değer değişimi yeni mantıksal deneme: zaman aşımından sonra değişen girdi eski satırın replay'ine düşmesin.
  const edit = (set: (v: string) => void, v: string) => {
    attempt.renew();
    set(v);
  };
  const m = parseTrNumber(meters);
  const add = useMutation({
    mutationFn: () =>
      addLines(noteId, [{ meters: m as number, weightKg: parseTrNumber(kg), senderRollNo: rollNo.trim() || null, blockNo: Math.max(1, Math.trunc(Number(block)) || 1) }], attempt.token()),
    onSuccess: () => {
      attempt.onSuccess();
      setMeters("");
      setKg("");
      setRollNo("");
      onAdded();
    },
    onError: (e) => attempt.onFailure(e),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (m !== null) add.mutate();
      }}
      data-testid="add-line-form"
    >
      <Input aria-label="Blok" className="h-9 w-16" type="number" min={1} value={block} onChange={(e) => edit(setBlock, e.target.value)} />
      <Input aria-label="Top no" placeholder="Top no" className="h-9 w-24" value={rollNo} onChange={(e) => edit(setRollNo, e.target.value)} />
      <Input aria-label="Yeni satır metre" placeholder="Metre *" inputMode="decimal" className="h-9 w-28" value={meters} onChange={(e) => edit(setMeters, e.target.value)} />
      <Input aria-label="Yeni satır kilo" placeholder="Kilo" inputMode="decimal" className="h-9 w-24" value={kg} onChange={(e) => edit(setKg, e.target.value)} />
      <Button type="submit" size="sm" disabled={m === null || add.isPending}>
        <Plus className="mr-1 h-4 w-4" />
        Satır ekle
      </Button>
    </form>
  );
}
