// =============================================================================
// GELEN BELGE → İŞ EMRİ ROTA ÖNERİSİ (TEK zincir; plan ucu = elle açma diyaloğu ön dolumu + otomatik iş emri)
// =============================================================================
// Kaynaklar: LAST_WORK_ORDER (sahibin rotalı son iş emri) · CUSTOMER_ROUTE (`Route.customerId` = sahip, TEK aday;
// birden çoksa belirsiz → atlanır) · FACTORY_DEFAULT (`gelenBelge.defaultRouteTemplateId`). Sıra ayardan:
// CUSTOMER_FIRST (varsayılan = bugünkü) müşteri → müşteri rotası → fabrika; FACTORY_FIRST fabrika → müşteri → müşteri
// rotası. Kayıtlı fabrika rotası kullanılamıyorsa FAIL-CLOSED: zincir durur (başka rotaya sessizce düşülmez).
// Öneri değer yazmaz; kapsama/tambur kat tipi/kategori uyarısı `quickStart → create` kapısındadır (ikinci kural yok).
// İleride iş emri türü ("tür sor" düğmesi) girdi nesnesine `kind` olarak eklenecek — imza bunun için nesnedir.
// =============================================================================
import prisma from "../lib/prisma";
import { TERIM } from "../constants/terim";
import { routeTemplateProblem, USABLE_ROUTE_TEMPLATE_WHERE } from "./helpers/route-template-usable.helper";
import { readIncomingDocDefaultRouteId, readRouteSuggestionPriority } from "./system-setting.service";

const IE = TERIM.terbiyeIsEmri;

export type RouteSuggestionSource = "LAST_WORK_ORDER" | "CUSTOMER_ROUTE" | "FACTORY_DEFAULT";

export interface RouteSuggestionInput {
  readonly ownerCustomerId: string | null;
}

export interface RouteSuggestion {
  readonly routeTemplateId: string | null;
  readonly routeName: string | null;
  readonly source: RouteSuggestionSource | null;
  /** Denenip kullanılamayan kaynakların Türkçe nedenleri (deneme sırasıyla); öneri bulunduysa öncekiler. */
  readonly notes: readonly string[];
}

type Step = { kind: "hit"; id: string; name: string } | { kind: "miss"; note: string } | { kind: "stop"; note: string };

async function fromLastWorkOrder(owner: string | null): Promise<Step> {
  if (!owner) return { kind: "miss", note: "Belgenin sahibi yok; müşteri geçmişi okunamadı." };
  const last = await prisma.workOrder.findFirst({
    where: { routeTemplateId: { not: null }, routeTemplate: USABLE_ROUTE_TEMPLATE_WHERE, batches: { some: { rolls: { some: { ownerCustomerId: owner } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { routeTemplate: { select: { id: true, name: true } } },
  });
  return last?.routeTemplate ? { kind: "hit", ...last.routeTemplate } : { kind: "miss", note: `Müşterinin rotalı önceki ${IE.tekilKucuk} yok.` };
}

async function fromCustomerRoute(owner: string | null): Promise<Step> {
  if (!owner) return { kind: "miss", note: "Belgenin sahibi yok; müşteriye tanımlı rota aranamadı." };
  const rows = await prisma.route.findMany({
    where: { customerId: owner, ...USABLE_ROUTE_TEMPLATE_WHERE },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 3,
    select: { id: true, name: true },
  });
  if (rows.length === 1) return { kind: "hit", ...rows[0]! };
  if (rows.length === 0) return { kind: "miss", note: "Müşteriye tanımlı kullanılabilir rota şablonu yok." };
  return { kind: "miss", note: `Müşteriye tanımlı birden çok rota şablonu var (${rows.map((r) => r.name).join(", ")}${rows.length > 2 ? "…" : ""}); hangisi olduğu belirsiz.` };
}

async function fromFactoryDefault(): Promise<Step> {
  const id = await readIncomingDocDefaultRouteId();
  if (!id) return { kind: "miss", note: "Fabrika varsayılan rotası ayarlanmamış." };
  const problem = await factoryRouteProblem(id);
  if (problem.problem) return { kind: "stop", note: `Fabrika varsayılan rotası (${problem.name ?? "silinmiş"}) kullanılamıyor: ${problem.problem}.` };
  return { kind: "hit", id, name: problem.name! };
}

/** Fabrika varsayılan rotası iş emri doğurabilir mi — ayar yazımı (400) ve onay anı (atla) TEK kapı. */
export async function factoryRouteProblem(routeId: string): Promise<{ name: string | null; problem: string | null }> {
  const r = await prisma.route.findUnique({ where: { id: routeId }, select: { name: true, isActive: true, _count: { select: { steps: true } } } });
  if (!r) return { name: null, problem: "Rota şablonu bulunamadı" };
  return { name: r.name, problem: routeTemplateProblem({ isActive: r.isActive, stepCount: r._count.steps }) };
}

/** Rota önerisi — plan ucu ve otomatik iş emrinin TEK kaynağı. */
export async function suggestRoute(input: RouteSuggestionInput): Promise<RouteSuggestion> {
  const owner = input.ownerCustomerId;
  const priority = await readRouteSuggestionPriority();
  const chain: Array<[RouteSuggestionSource, () => Promise<Step>]> = [
    ["LAST_WORK_ORDER", () => fromLastWorkOrder(owner)],
    ["CUSTOMER_ROUTE", () => fromCustomerRoute(owner)],
  ];
  if (priority === "FACTORY_FIRST") chain.unshift(["FACTORY_DEFAULT", fromFactoryDefault]);
  else chain.push(["FACTORY_DEFAULT", fromFactoryDefault]);
  const notes: string[] = [];
  for (const [source, run] of chain) {
    const step = await run();
    if (step.kind === "hit") return { routeTemplateId: step.id, routeName: step.name, source, notes };
    notes.push(step.note);
    if (step.kind === "stop") break;
  }
  return { routeTemplateId: null, routeName: null, source: null, notes };
}
