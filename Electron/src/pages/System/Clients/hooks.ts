import { useQuery } from "@tanstack/react-query";
import { fetchConnectedClients } from "./service";

/**
 * Sayfa açılışında BİR KEZ çeker, sonrası "Yenile" düğmesiyle.
 *
 * ⚠️ OTOMATİK YOKLAMA YOK (kullanıcı kararı): liste bir envanterdir, canlı bir
 * gösterge değil. Sürekli yoklama fabrika ağına ve sunucuya bedel bindirir ve
 * ekranın iddiasını ("son N dakikada istek gönderdi") değiştirmez.
 */
export function useConnectedClients() {
  return useQuery({
    queryKey: ["connected-clients"],
    queryFn: fetchConnectedClients,
    // Açılışta taze veri: sekmeye her dönüldüğünde eski bir fotoğraf değil.
    staleTime: 0,
    refetchOnMount: "always",
  });
}
