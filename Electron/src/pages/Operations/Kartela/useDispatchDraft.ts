// Yeni Sevk taslağı — firma + top listesi + araç bilgisi; okutma ve listeden seçim aynı listeye yazar.
import { useState } from "react";
import { toast } from "sonner";
import { rollService } from "@/pages/Operations/Rolls/service";
import { rollScanRejection, rollToPicked, type KartelaPickedRoll } from "./kartelaActions";

export function useDispatchDraft() {
  const [firmId, setFirmId] = useState<string | null>(null);
  const [rolls, setRolls] = useState<KartelaPickedRoll[]>([]);
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState("");
  const [resolving, setResolving] = useState(false);

  /** USB okuyucu / elle giriş — tablet `addRoll`: mükerrer uyarı, durum/çuval/sevkiyat reddi. */
  const addScanned = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    if (rolls.some((r) => r.barcode === code)) {
      toast.info("Bu top zaten eklendi");
      setScan("");
      return;
    }
    setResolving(true);
    try {
      // 404 vb. toast'ı apiClient basar.
      const roll = (await rollService.getByBarcode(code)).data;
      const reject = rollScanRejection(roll);
      if (reject) {
        toast.error(reject);
        return;
      }
      setRolls((prev) => (prev.some((r) => r.id === roll.id) ? prev : [...prev, rollToPicked(roll)]));
      setScan("");
    } catch {
      /* apiClient toast'ı yeterli */
    } finally {
      setResolving(false);
    }
  };

  /** Seçiciden / Kartelalık Stok'tan gelenler zaten WAREHOUSE + serbest süzgeçten geçti (tablet `addRollFromList`). */
  const addPicked = (picked: readonly KartelaPickedRoll[]) =>
    setRolls((prev) => {
      const fresh = picked.filter((p) => !prev.some((r) => r.id === p.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh.map((p) => ({ id: p.id, barcode: p.barcode, itemName: p.itemName, colorName: p.colorName, qty: p.qty }))];
    });

  const removeRoll = (id: string) => setRolls((prev) => prev.filter((r) => r.id !== id));

  const reset = () => {
    setFirmId(null);
    setRolls([]);
    setPlateNumber("");
    setDriverName("");
    setNotes("");
    setScan("");
  };

  return {
    firmId, setFirmId, rolls, plateNumber, setPlateNumber, driverName, setDriverName, notes, setNotes,
    scan, setScan, resolving, addScanned, addPicked, removeRoll, reset,
  };
}

export type DispatchDraft = ReturnType<typeof useDispatchDraft>;
