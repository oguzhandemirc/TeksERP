// Sipariş kalemindeki "müşterideki ad". Renk adını SUNUCU çözer (satır adı → kumaşa özel → genel; detay ucu
// `resolvedCustomerColorName`); panel zinciri kopyalamaz. Alanı göndermeyen eski backend'de genel ad haritası YEDEKtir.
import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { customerAliasService } from "@/pages/Customers/aliasService";
import type { ColorNameScope } from "@/services/labelService";
import { orderService } from "./service";
import type { Order, OrderLine } from "./types";

export interface LineCustomerNames {
  item: string | null;
  color: string | null;
  colorScope: ColorNameScope | null;
}

/** Yeni backend her kalemde alanı taşır (değer null olsa bile); eski backend hiç göndermez. */
export const hasServerColorNames = (lines: readonly OrderLine[] | undefined): boolean =>
  (lines ?? []).some((l) => l.resolvedCustomerColorName !== undefined);

export function useOrderLineCustomerNames(order: Order | null, open: boolean): (line: OrderLine) => LineCustomerNames {
  const { hasPermission } = useRoleAccess();
  // İzinsiz kullanıcıda sunucu da yalnız satır adını döner — ana veri adı hiç istenmez.
  const canRead = open && !!order?.customerId && hasPermission("customer-alias:read");
  const inline = hasServerColorNames(order?.lines);

  // Liste satırı çözülmüş adı taşımaz; detay ucu taşır (tablodaki kayıt → aynı önbellek anahtarı).
  const detailQ = useQuery({
    queryKey: ["orders", "detail", order?.id],
    queryFn: () => orderService.getById(order!.id),
    enabled: canRead && !inline && !!order?.id,
    staleTime: 30_000,
  });
  const serverLines = inline ? order?.lines : detailQ.data?.data?.lines;
  const serverResolves = hasServerColorNames(serverLines);
  const legacy = canRead && !serverResolves && (detailQ.isSuccess || detailQ.isError);

  const itemAliasesQuery = useQuery({
    queryKey: ["customer", order?.customerId, "item-aliases"],
    queryFn: () => customerAliasService.listItemAliases(order!.customerId),
    enabled: canRead,
    staleTime: 60_000,
  });
  const legacyColorQuery = useQuery({
    queryKey: ["customer", order?.customerId, "color-aliases"],
    queryFn: () => customerAliasService.listColorAliases(order!.customerId),
    enabled: legacy,
    staleTime: 60_000,
  });

  const itemAliasMap = new Map((itemAliasesQuery.data?.data ?? []).map((a) => [a.itemId, a.alias]));
  const byLine = new Map((serverResolves ? serverLines ?? [] : []).map((l) => [l.id, l]));
  const legacyColor = new Map(
    (legacyColorQuery.data?.data ?? []).filter((a) => a.alias).map((a) => [a.colorId, a.alias as string]),
  );

  return (line) => {
    const server = byLine.get(line.id);
    const color = server
      ? (server.resolvedCustomerColorName ?? null)
      : (line.customerColorName ?? (legacy && line.colorId ? legacyColor.get(line.colorId) ?? null : null));
    return {
      item: line.customerItemName ?? itemAliasMap.get(line.itemId) ?? null,
      color,
      colorScope: server?.colorNameScope ?? null,
    };
  };
}
