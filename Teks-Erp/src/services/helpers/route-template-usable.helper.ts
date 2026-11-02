// Rota şablonu iş emrine KULLANILABİLİR mi — `WorkOrderService.create` kapısı ile gelen belge rota önerisinin
// (fabrika varsayılanı yazımı/onay anı) TEK yüklemi; ikisi ayrı kural yazarsa öneri create'in reddettiği rotayı verir.
import type { Prisma } from "@prisma/client";

/** Pasif rota ve adımsız rota iş emri doğuramaz; null = kullanılabilir. Mesajlar create'in 400 metniyle aynıdır. */
export function routeTemplateProblem(t: { isActive: boolean; stepCount: number }): string | null {
  if (!t.isActive) return "Pasif bir rota şablonu kullanılamaz";
  if (t.stepCount === 0) return "Rota şablonunda adım yok";
  return null;
}

/** `routeTemplateProblem` null'ın Prisma ikizi (boğaz-ikiz): aktif + en az bir adım. */
export const USABLE_ROUTE_TEMPLATE_WHERE = { isActive: true, steps: { some: {} } } as const satisfies Prisma.RouteWhereInput;
