import type {
  KursunBypassMachineOption,
  KursunDistributionAssignedRow,
  KursunDistributionWaitingRow,
} from "./types";

export const POOL_TAB = "pool" as const;

export interface DistributionTab {
  /** `"pool"` ya da makine id'si — sekme state'inin anahtarı. */
  key: string;
  label: string;
  /** Sekmedeki iş emri sayısı (rozet). */
  count: number;
  /** Sekmedeki toplam metraj — "hangi makine dolu" sorusu sekmeye BAKARAK yanıtlanır. */
  meters: number;
  /** Bayat dağıtım sayısı (yalnız makine sekmelerinde anlamlı). */
  staleCount: number;
}

/**
 * Sekme şeridini kurar: önce **Havuz**, sonra her AKTİF kurşun makinesi.
 *
 * ⚠️ Sekmeler MAKİNE LİSTESİNDEN doğar, dağıtılmış satırlardan DEĞİL. Yani işi
 * olmayan makinenin de sekmesi vardır. Gerekçe: "Makine 2 boş mu, yoksa sekmesi
 * mi yok?" sorusu operatörü durdurur; ayrıca boş makine tam da iş verilecek
 * yerdir — onu ekrandan silmek, dağıtım kararını zorlaştırır.
 *
 * Sayı + metraj sekme ETİKETİNDE durur: eski tasarımda iki bölüm üst üsteydi ve
 * "hangi makine ne kadar dolu" tek bakışta görünüyordu. Sekmeye geçince o
 * görünürlük kaybolurdu; şerit onu geri verir.
 *
 * ⚠️ Makinesi SİLİNMİŞ/PASİFLEŞMİŞ ama hâlâ açık ataması olan satırlar için de
 * sekme üretilir (`orphan`): aksi halde o işlere ulaşılamaz ve havuza
 * döndürülemezlerdi.
 */
export function buildTabs(
  machines: KursunBypassMachineOption[],
  waiting: KursunDistributionWaitingRow[],
  assigned: KursunDistributionAssignedRow[],
): DistributionTab[] {
  const tabs: DistributionTab[] = [
    {
      key: POOL_TAB,
      label: "Havuz",
      count: waiting.length,
      meters: waiting.reduce((s, r) => s + r.totalMeters, 0),
      staleCount: 0,
    },
  ];

  const seen = new Set<string>();
  for (const m of machines) {
    seen.add(m.id);
    const rows = assigned.filter((r) => r.machineId === m.id);
    tabs.push({
      key: m.id,
      label: m.name,
      count: rows.length,
      meters: rows.reduce((s, r) => s + r.totalMeters, 0),
      staleCount: rows.filter((r) => r.stale).length,
    });
  }

  // Artık atama hedefi olmayan (pasifleşmiş/silinmiş) makinedeki açık işler.
  for (const row of assigned) {
    if (seen.has(row.machineId)) continue;
    seen.add(row.machineId);
    const rows = assigned.filter((r) => r.machineId === row.machineId);
    tabs.push({
      key: row.machineId,
      label: `${row.machineName} (pasif)`,
      count: rows.length,
      meters: rows.reduce((s, r) => s + r.totalMeters, 0),
      staleCount: rows.filter((r) => r.stale).length,
    });
  }

  return tabs;
}
