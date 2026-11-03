// Belge masası (K23) — saf parçalar: hazır iş emri (kısayol) ön seçimi, kurşun adımı, parti başına makine + gramaj gövdesi.
// Kural sunucudadır (plan makinesi istasyon kapısı quickStart'ta); burası yalnız formu doldurur.
import type { CreateWorkOrderFromNoteBody, DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import type { MultiPartyDraft } from '../woCreate/partyDraft';
import type { RowResult } from '../woCreate/woFromDoc';

/**
 * Ön seçim sırası: kullanıcının seçimi (dokunduysa) > sunucu önerisi (müşterinin son İE rotası → müşteri rotası →
 * fabrika varsayılanı; yalnız kısayolsa) > kısayol sırasında ilk. Kısayol yoksa null (masa kipi çizilmez).
 */
export function pickShortcut(
  shortcuts: readonly ProductionRoute[],
  opts: { touchedId?: string | null; suggestedId?: string | null },
): ProductionRoute | null {
  const byId = (id: string | null | undefined) => (id ? shortcuts.find((r) => r.id === id) ?? null : null);
  return byId(opts.touchedId) ?? byId(opts.suggestedId) ?? shortcuts[0] ?? null;
}

export interface KursunStep {
  sequence: number;
  stationId: string;
}

/** Rotanın ilk kurşun adımı (sunucu `isKursunStation`; eski sunucuda kurşun+KK2 istasyon türü). */
export function kursunStepOf(route: ProductionRoute | null | undefined): KursunStep | null {
  const s = (route?.steps ?? []).filter((x) => x.station?.isKursunStation ?? x.station?.kind === 'PROCESS_QC').sort((a, b) => a.sequence - b.sequence)[0];
  return s ? { sequence: s.sequence, stationId: s.stationId } : null;
}

/** Yalnız rotanın kurşun istasyonunun makineleri (başka istasyon makinesi sunucuda 400 olurdu). */
export function machinesForRoute(route: ProductionRoute | null | undefined, machines: readonly DeskKursunMachine[]): DeskKursunMachine[] {
  const step = kursunStepOf(route);
  return step ? machines.filter((m) => m.stationId === step.stationId) : [];
}

/**
 * Rota şablonunun kurşun adımındaki önerilen makine — sunucu seçim gelmezse bunu klonlar, yani ekranda da bu seçili
 * görünmeli ("Sonra seçilsin" görünüp şablon makinesinin sessizce gitmesi yerine). Listede yoksa (pasif) öneri yok.
 */
export function routeDefaultMachineId(route: ProductionRoute | null | undefined, machines: readonly DeskKursunMachine[]): string | undefined {
  const s = (route?.steps ?? []).filter((x) => x.station?.isKursunStation ?? x.station?.kind === 'PROCESS_QC').sort((a, b) => a.sequence - b.sequence)[0];
  const id = s?.plannedMachineId ?? undefined;
  return id && machinesForRoute(route, machines).some((m) => m.id === id) ? id : undefined;
}

export interface PlanOpts {
  kursunSequence: number | null;
  gramajPropertyId: string | null;
}

// undefined = karar yok (gövde aynen; sunucu şablonu klonlar) · null = "Sonra seçilsin" AÇIKÇA (şablon makinesini ezer).
const planOf = (machineId: string | null | undefined, seq: number | null) =>
  machineId !== undefined && seq !== null ? [{ sequence: seq, plannedMachineId: machineId }] : undefined;

/**
 * Makine (+ çok partide parti başına gramaj) gövdeye eklenir. Seçim yoksa gövde AYNEN döner (bugünkü sözleşme; eski
 * sunucunun strict gövdesine yeni alan gitmez).
 */
export function withDeskPlan(
  body: CreateWorkOrderFromNoteBody,
  f: { machineId?: string | null; multi?: MultiPartyDraft | null },
  opts: PlanOpts,
): CreateWorkOrderFromNoteBody {
  const out: CreateWorkOrderFromNoteBody = { ...body };
  // Kip ekranda neyi gösteriyorsa o gider: PER_PARTY'de üst makine yedek olmaz; SINGLE'da sunucu parti alanlarını okumaz.
  const perParty = !!f.multi && f.multi.mode === 'PER_PARTY';
  const top = perParty ? undefined : planOf(f.machineId, opts.kursunSequence);
  if (top) out.stepPlanning = top;
  if (!perParty || !out.parties) return out;
  out.parties = out.parties.map((p) => {
    const row = f.multi!.rows.find((r) => r.blockNo === p.blockNo);
    const plan = planOf(row?.machineId, opts.kursunSequence);
    // K22: parti hedefi gövdenin hedefini EZER (sunucu `p.targetValues ?? gövde`) → formda alanı olmayan değerler partiye de taşınır.
    const rest = (body.targetValues ?? []).filter((t) => t.propertyId !== opts.gramajPropertyId);
    const gramaj = row?.gramajValueId && opts.gramajPropertyId ? [{ propertyId: opts.gramajPropertyId, valueId: row.gramajValueId }, ...rest] : undefined;
    return { ...p, ...(plan ? { stepPlanning: plan } : {}), ...(gramaj ? { targetValues: gramaj } : {}) };
  });
  return out;
}

/** Oluşan iş emri numaraları — kısa bildirim ve son oluşturulanlar şeridi. */
export interface RecentWo {
  noteNo: string;
  workOrderNos: string[];
  at: number;
  /** Basım için (workOrderNos ile aynı sıra); taslakta boş. */
  workOrderIds?: string[];
  /** Elle refakat kartı basımının sonucu (otomatik basım kapalıyken şeritteki düğme). */
  print?: 'PRINTED' | 'PRINT_FAILED' | null;
}

/** Şeritteki kaydın basım sonucunu işler (liste değişmez nesne). */
export function markRecentPrint(list: readonly RecentWo[], noteNo: string, ok: boolean): RecentWo[] {
  return list.map((x) => (x.noteNo === noteNo ? { ...x, print: ok ? 'PRINTED' : 'PRINT_FAILED' } : x));
}

export const RECENT_WO_MAX = 6;

export function pushRecentWo(list: readonly RecentWo[], item: RecentWo, max = RECENT_WO_MAX): RecentWo[] {
  return [item, ...list.filter((x) => x.noteNo !== item.noteNo)].slice(0, max);
}

/** Kaydedilen satırın şerit kaydı: açıldıysa İE no'ları, taslaksa boş liste ("taslak"); başarısızsa null. */
export function recentFromResult(noteNo: string, result: RowResult | null, at: number): RecentWo | null {
  if (result?.kind === 'OPENED')
    return { noteNo, workOrderNos: result.workOrders.map((w) => w.workOrderNo), workOrderIds: result.workOrders.map((w) => w.workOrderId), at, print: null };
  if (result?.kind === 'DRAFT') return { noteNo, workOrderNos: [], at };
  return null;
}

/**
 * Makine ön seçimi (görünür). `reset` = rota değişti: önceki rotanın makineleri yeni rotada geçersiz (sunucu 400) →
 * hepsi yeni rotanın önerisine döner. Aksi hâlde yalnız kararsız (undefined) seçimler dolar: çok parti sonradan
 * açılırsa partiler belgenin seçili makinesini (yoksa öneriyi) GÖRÜNÜR biçimde alır. Değişiklik yoksa null.
 */
export function seedMachines(
  f: { machineId?: string | null; multi?: MultiPartyDraft | null },
  def: string | undefined,
  reset: boolean,
): { machineId?: string | null; multi?: MultiPartyDraft } | null {
  const out: { machineId?: string | null; multi?: MultiPartyDraft } = {};
  const top = reset ? def : f.machineId === undefined ? def : f.machineId;
  if (top !== f.machineId) out.machineId = top;
  const partyDef = reset ? def : f.machineId ?? def;
  if (f.multi) {
    let changed = false;
    const rows = f.multi.rows.map((r) => {
      const next = reset || r.machineId === undefined ? partyDef : r.machineId;
      if (next === r.machineId) return r;
      changed = true;
      return { ...r, machineId: next };
    });
    if (changed) out.multi = { ...f.multi, rows };
  }
  return 'machineId' in out || out.multi ? out : null;
}
