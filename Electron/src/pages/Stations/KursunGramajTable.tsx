import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addRow, moveRow, setDefault, toggleActive, type KursunGramajRow } from "./kursun-station";

/** Gramaj satırları (gr/m): ekle · pasife al (silme yok) · sırala · TEK varsayılan. Düğmeler `type="button"`. */
export function KursunGramajTable({ rows, onChange }: { rows: KursunGramajRow[]; onChange: (rows: KursunGramajRow[]) => void }) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  return (
    <>
          <div className="text-xs font-medium">Gramajlar (gr/m)</div>
          <table className="w-full text-sm" data-testid="kursun-gramaj-table">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.code ?? `new-${i}`} className={r.isActive ? "" : "opacity-50"}>
                  <td className="py-1 pr-2">{r.name}</td>
                  <td className="w-28 py-1 pr-2">
                    <Input
                      aria-label={`${r.name} gr/m`}
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="radio" name="kursun-default" checked={r.isDefault} disabled={!r.isActive} onChange={() => undefined} onClick={() => onChange(setDefault(rows, i))} aria-label={`${r.name} varsayılan`} />
                      Varsayılan
                    </label>
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    <Button type="button" variant="ghost" size="sm" aria-label="Yukarı" onClick={() => onChange(moveRow(rows, i, -1))}><ArrowUp className="h-3 w-3" /></Button>
                    <Button type="button" variant="ghost" size="sm" aria-label="Aşağı" onClick={() => onChange(moveRow(rows, i, 1))}><ArrowDown className="h-3 w-3" /></Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onChange(toggleActive(rows, i))}>{r.isActive ? "Pasife al" : "Aktif et"}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <Input placeholder="Ad (ör. 40 gr)" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Yeni gramaj adı" />
            <Input placeholder="gr/m" className="w-24" inputMode="decimal" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} aria-label="Yeni gramaj gr/m" />
            <Button
              type="button"
              variant="outline"
              disabled={newName.trim() === ""}
              onClick={() => { onChange(addRow(rows, newName, newAmount)); setNewName(""); setNewAmount(""); }}
            >
              Ekle
            </Button>
          </div>
    </>
  );
}
