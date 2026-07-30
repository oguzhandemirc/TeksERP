import { toast } from "sonner";
import { parseWeight } from "@/lib/weight-codec";
import type { DeviceScale } from "@/hooks/useMachineScale";

/** Tartının kaynağı — backend'e beyan edilir (`weighSack.source`). */
export type WeighSource = "SCALE" | "MANUAL" | "SIMULATED";

/**
 * Kantardan tek brüt-tartı okuması. Cihazın `simulate` bayrağı açıksa sahte değer
 * (test/donanımsız); değilse seri IPC ile oku + parse. Her hata yolunda NET Türkçe
 * toast + null döner — sessiz sahte değer YOK (KK1 `measureFromMachine` deseni).
 * Mobil HAL ile aynı disiplin.
 *
 * `source` de döner: simüle değer backend'e `SIMULATED` olarak BEYAN edilir ve
 * `shipping.simulatedWeightEnabled` kapalıyken (default) 400 ile reddedilir. Çuval
 * kg'si sevk irsaliyesine/çeki listesine basıldığı için uydurma değer canlı veriye
 * girmemeli. ⚠️ Electron'da bu beyan TEK sinyaldir: kantar yerel tercihlerden
 * (`machine-config`, DB kaydı OLMAYAN "local-scale") çözülebildiği için backend o
 * cihazı göremez ve çapraz kontrol yapamaz.
 */
export async function readWeightFromScale(
  scale: DeviceScale | null,
): Promise<{ kg: number; source: WeighSource } | null> {
  if (!scale) {
    toast.error("Kantar tanımlı değil", {
      description: "Cihaz Kaydı'ndan SCALE ekleyin veya bu PC'yi sevkiyat makinesine atayın.",
    });
    return null;
  }
  // Cihazın simülasyon bayrağı açıksa (admin) sahte kg (10–100).
  // ⚠️ UYARI BURADA veriliyor — eskiden Electron'da HİÇ uyarı yoktu: tek uyarı
  // mutasyon BAŞARILI olduktan SONRA `useSackWeighAction` içindeydi, yani uydurma
  // değer önce DB'ye yazılıyordu. Mobil paritesi (`useSackWeigh`).
  if (scale.simulate) {
    const v = Math.round((10 + Math.random() * 90) * 10) / 10;
    toast.warning("SİMÜLASYON tartısı", {
      description: `${v} kg gerçek ölçüm DEĞİL — cihaz kaydında "simülasyon" açık. Kaydetmek için Cihaz Kaydı'ndan kapatın ya da elle girin.`,
      duration: 8000,
    });
    return { kg: v, source: "SIMULATED" };
  }

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
  return { kg: v, source: "SCALE" };
}
