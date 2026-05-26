// Dashboard widget kayıtları — settings dialog, layout hook ve render
// kodu buradan okur. Üç grup var; her grup kendi içinde sırası
// değişebilir, gruplar arası da sıralama mümkün. Item'lar gruplar
// arasında taşınmaz.

export type GroupKey = "kpi" | "stationLoad" | "panels";

export interface WidgetDef {
  key: string;
  label: string;
}

export interface GroupDef {
  key: GroupKey;
  label: string;
  items: WidgetDef[];
}

export const GROUPS: GroupDef[] = [
  {
    key: "kpi",
    label: "Üst Kartlar",
    items: [
      { key: "kpi:openOrders", label: "Açık Sipariş" },
      { key: "kpi:openWorkOrders", label: "Açık İş Emri" },
      { key: "kpi:readyToShip", label: "Sevke Hazır" },
      { key: "kpi:warehouse", label: "Depoda Bekleyen" },
      { key: "kpi:atSubcontractor", label: "Fason'da" },
      { key: "kpi:todayDefects", label: "Günlük Hata" },
      { key: "kpi:inProduction", label: "Üretimde" },
    ],
  },
  {
    key: "stationLoad",
    label: "İstasyon Doluluk",
    items: [{ key: "panel:stationLoad", label: "İstasyon Doluluk" }],
  },
  {
    key: "panels",
    label: "Liste Panelleri",
    items: [
      { key: "panel:upcomingOrders", label: "Vadesi Yaklaşan Siparişler" },
      { key: "panel:overdueWorkOrders", label: "Geciken İş Emirleri" },
      { key: "panel:upcomingWorkOrders", label: "Yakında Başlayacak İş Emirleri" },
    ],
  },
];

export const DEFAULT_GROUP_ORDER: GroupKey[] = GROUPS.map((g) => g.key);

export function getGroup(key: GroupKey): GroupDef {
  const g = GROUPS.find((x) => x.key === key);
  if (!g) throw new Error(`Unknown group: ${key}`);
  return g;
}

export function getDefaultItemOrder(groupKey: GroupKey): string[] {
  return getGroup(groupKey).items.map((i) => i.key);
}

/** Item key → label lookup'ı (registry'deki tüm itemları tarar). */
export function getItemLabel(key: string): string | undefined {
  for (const g of GROUPS) {
    const it = g.items.find((i) => i.key === key);
    if (it) return it.label;
  }
  return undefined;
}

/** Item key → groupKey lookup'ı. */
export function findItemGroup(key: string): GroupKey | undefined {
  for (const g of GROUPS) {
    if (g.items.some((i) => i.key === key)) return g.key;
  }
  return undefined;
}
