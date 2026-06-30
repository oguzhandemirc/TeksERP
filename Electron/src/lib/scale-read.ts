import { toast } from "sonner";
import { parseWeight } from "@/lib/weight-codec";
import type { DeviceScale } from "@/hooks/useMachineScale";

/**
 * Kantardan tek brüt-tartı okuması (kg). Cihazın `simulate` bayrağı açıksa sahte
 * değer (test/donanımsız); değilse seri IPC ile oku + parse. Her hata yolunda NET
 * Türkçe toast + null döner — sessiz sahte değer YOK (KK1 `measureFromMachine`
 * deseni). Mobil HAL ile aynı disiplin.
 */
export async function readWeightFromScale(scale: DeviceScale | null): Promise<number | null> {
  if (!scale) {
    toast.error("Kantar tanımlı değil", {
      description: "Cihaz Kaydı'ndan SCALE ekleyin veya bu PC'yi sevkiyat makinesine atayın.",
    });
    return null;
  }
  // Cihazın simülasyon bayrağı açıksa (admin) sahte kg (10–100).
  if (scale.simulate) return Math.round((10 + Math.random() * 90) * 10) / 10;

  if (!window.api?.scale) {
    toast.error("Kantar okunamıyor", { description: "Bu derlemede seri köprü yok (native build)." });
    return null;
  }
  if (!scale.address) {
    toast.error("Kantar adresi tanımsız", { description: "Cihaz Kaydı'nda COM portunu (adres) girin." });
    return null;
  }

  const res = await window.api.scale.read({
    path: scale.address,
    baudRate: typeof scale.port === "number" ? scale.port : undefined,
    pollCommand: scale.pollCommand ?? undefined,
    terminator: scale.terminator ?? undefined,
    timeoutMs: scale.timeoutMs ?? undefined,
  });
  if (!res.ok || !res.raw) {
    toast.error("Kantar okunamadı", {
      description: res.error ?? "Kantar kapalı/menzil dışı veya komut yanlış olabilir.",
    });
    return null;
  }

  const decimals = scale.decimals ?? 2;
  const factor = scale.scale != null ? Number(scale.scale) : 1;
  const v = parseWeight(res.raw, { decimals, scale: Number.isFinite(factor) ? factor : 1 });
  if (v == null || v <= 0) {
    toast.error("Geçerli tartı gelmedi", { description: `Ham yanıt: "${res.raw.trim().slice(0, 40)}"` });
    return null;
  }
  return v;
}
