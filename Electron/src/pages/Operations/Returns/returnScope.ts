import type {
  CreateReturnBatchPayload,
  LotReturnLookupResult,
  ReturnLookupResult,
  ReturnScopeGroup,
  ReturnScopeOrder,
  SackReturnLookupResult,
  ShipmentReturnLookupResult,
} from "./service";

/**
 * İADE KAPSAMI — dört giriş yolu (top · çuval · sevkiyat · sevk partisi) TEK modele
 * iner: `groups` = sevkiyat başına bir grup, grup içinde çuvallar, çuval içinde
 * toplar. İade her zaman TOP satırıyla yazılır; kapsam yalnız "hangi toplar
 * ön-seçili" sorusudur. Birden çok grup = sevkiyat başına bir iade belgesi.
 * Saf; test ikizi `returnScope.test.ts`.
 */
export type ReturnScopeKind = "ROLL" | "SACK" | "SHIPMENT" | "LOT";

export interface ReturnScope {
  kind: ReturnScopeKind;
  /** Başlık: "SP-3" · "CV…" · "SVK…" · top barkodu. */
  label: string;
  groups: ReturnScopeGroup[];
  returnGradingEnabled: boolean;
}

/** Top sorgusu → tek grup, tek sanal çuval ("—"), tek top. */
export function scopeFromRoll(r: ReturnLookupResult): ReturnScope {
  const rollIds = [r.roll.id];
  return {
    kind: "ROLL",
    label: r.roll.barcode ?? r.roll.id,
    returnGradingEnabled: r.returnGradingEnabled,
    groups: [
      {
        shipment: r.shipment ?? { id: "", shipmentNo: "—", dispatchedAt: null },
        customer: r.customer,
        branch: r.branch,
        sacks: [{ id: "roll-only", sackNo: "", packageNo: null, packingGroupName: null, rolls: [r.roll] }],
        // Sunucu adayları zaten bu topa göre süzdü → hepsi bu topa uyar.
        orders: r.candidateOrders.map((o) => ({ ...o, rollIds })),
      },
    ],
  };
}

/** Çuval sorgusu → tek grup, tek çuval; adaylar çuvalın TÜM toplarına uyar. */
export function scopeFromSack(r: SackReturnLookupResult): ReturnScope {
  const rollIds = r.rolls.map((x) => x.id);
  return {
    kind: "SACK",
    label: r.sack.sackNo,
    returnGradingEnabled: r.returnGradingEnabled,
    groups: [
      {
        shipment: r.shipment,
        customer: r.customer,
        branch: r.branch,
        sacks: [{ id: r.sack.id, sackNo: r.sack.sackNo, packageNo: null, packingGroupName: null, rolls: r.rolls }],
        orders: r.candidateOrders.map((o) => ({ ...o, rollIds })),
      },
    ],
  };
}

export function scopeFromShipment(r: ShipmentReturnLookupResult): ReturnScope {
  const { returnGradingEnabled, ...group } = r;
  return { kind: "SHIPMENT", label: r.shipment.shipmentNo, returnGradingEnabled, groups: [group] };
}

export function scopeFromLot(r: LotReturnLookupResult): ReturnScope {
  return { kind: "LOT", label: r.lot.name, returnGradingEnabled: r.returnGradingEnabled, groups: r.groups };
}

/** Varsayılan seçim: TÜMÜ (yaygın durum "komple geri al"; ters varsayılan 20 tık). */
export function allRollIds(scope: ReturnScope): Set<string> {
  return new Set(scope.groups.flatMap((g) => g.sacks.flatMap((s) => s.rolls.map((r) => r.id))));
}

/** Gruptaki SEÇİLİ toplar. */
export function selectedInGroup(g: ReturnScopeGroup, selected: ReadonlySet<string>): string[] {
  return g.sacks.flatMap((s) => s.rolls.map((r) => r.id)).filter((id) => selected.has(id));
}

/**
 * Aday siparişler: seçili topların HEPSİNE uyanlar. "En az birine uyan"ı listelemek
 * yanıltır — sipariş gruptaki tüm seçili toplara uygulanır, sunucu her top için
 * doğrular ve uymayan seçim kaydetmede 400 verirdi. Seçim boşsa aday yok.
 */
export function candidateOrders(g: ReturnScopeGroup, selected: ReadonlySet<string>): ReturnScopeOrder[] {
  const chosen = selectedInGroup(g, selected);
  if (chosen.length === 0) return [];
  return g.orders.filter((o) => chosen.every((id) => o.rollIds.includes(id)));
}

export interface ScopeSummary {
  rollCount: number;
  meters: number;
  /** Seçili topu olan grup sayısı = üretilecek iade belgesi sayısı. */
  docCount: number;
}

export function summarize(scope: ReturnScope, selected: ReadonlySet<string>): ScopeSummary {
  let rollCount = 0;
  let meters = 0;
  let docCount = 0;
  for (const g of scope.groups) {
    let any = false;
    for (const s of g.sacks) {
      for (const r of s.rolls) {
        if (!selected.has(r.id)) continue;
        any = true;
        rollCount += 1;
        meters += Number(r.currentQty || 0);
      }
    }
    if (any) docCount += 1;
  }
  return { rollCount, meters, docCount };
}

/**
 * Sipariş seçimi geçerli mi: seçili topu olan her grupta ya aday yok (siparişsiz
 * kaydedilir) ya da seçilen sipariş adaylar arasında.
 */
export function ordersValid(scope: ReturnScope, selected: ReadonlySet<string>, orderByGroup: ReadonlyMap<string, string | null>): boolean {
  return scope.groups.every((g) => {
    if (selectedInGroup(g, selected).length === 0) return true;
    const cands = candidateOrders(g, selected);
    if (cands.length === 0) return true;
    const chosen = orderByGroup.get(g.shipment.id) ?? null;
    return !!chosen && cands.some((o) => o.id === chosen);
  });
}

/** Toplu gönderim yükü: yalnız seçili topu olan gruplar, sevkiyat sırasıyla. */
export function buildBatchPayload(
  scope: ReturnScope,
  selected: ReadonlySet<string>,
  orderByGroup: ReadonlyMap<string, string | null>,
  common: { reasonId: string | null; reasonText: string | null; note: string | null; qualityGradeId: string | null },
): CreateReturnBatchPayload {
  return {
    groups: scope.groups
      .map((g) => ({ rollIds: selectedInGroup(g, selected), orderId: orderByGroup.get(g.shipment.id) ?? null }))
      .filter((g) => g.rollIds.length > 0),
    ...common,
  };
}

/** Tek aday varsa otomatik seç (bugünkü davranış); yoksa/çoksa null (kullanıcı seçer). */
export function autoOrders(scope: ReturnScope, selected: ReadonlySet<string>): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const g of scope.groups) {
    const cands = candidateOrders(g, selected);
    m.set(g.shipment.id, cands.length === 1 ? cands[0]!.id : null);
  }
  return m;
}
