import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { kursunDagitimService } from "./service";
import type { KursunBulkResult } from "./types";

export const DISTRIBUTION_QUERY_KEY = ["kursun-bypass", "distribution"];

/**
 * Kurşun Planlama ekranının TÜM veri + yazma yolları. Sayfadan ayrıldı çünkü
 * sayfa artık sekme/seçim düzenini de taşıyor ve tek dosyada ikisi birden
 * 300 satır kuralını aşıyordu.
 *
 * Tüm mutasyonlar başarıda TEK sorguyu tazeler — bekleyen liste, dağıtılmışlar
 * ve bayrak aynı payload'dan geliyor.
 */
export function useKursunDistribution() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: DISTRIBUTION_QUERY_KEY,
    queryFn: () => kursunDagitimService.getDistribution(),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
  };

  /**
   * TOPLU sonuç bildirimi — PARÇALI başarı gerçektir ve SÖYLENİR.
   *
   * "42 atandı" deyip 8'inin neden atlandığını yutmak, sessizce yanlış bir
   * cevaptır: planlamacı o 8 işi dağıttığını sanır. Atlananlar ayrı bir hata
   * toast'ında, ilk üçü sebebiyle listelenir (hepsini basmak ekranı doldurur).
   */
  const reportBulk = (res: { message?: string; data: KursunBulkResult }) => {
    const failed = res.data.failed;
    if (failed.length === 0) {
      toast.success(res.message ?? "İşlem tamamlandı.");
      return;
    }
    toast.warning(res.message ?? `${failed.length} satır atlandı.`, {
      description: failed
        .slice(0, 3)
        .map((f) => f.message)
        .join("\n"),
      duration: 8000,
    });
  };

  const assign = useMutation({
    mutationFn: kursunDagitimService.assign,
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri makineye dağıtıldı.");
      refresh();
    },
  });

  const assignBulk = useMutation({
    mutationFn: kursunDagitimService.assignBulk,
    onSuccess: (res) => {
      reportBulk(res);
      refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: (assignmentId: string) => kursunDagitimService.cancel(assignmentId),
    onSuccess: (res) => {
      toast.success(res.message ?? "Dağıtım kaldırıldı.");
      refresh();
    },
  });

  const cancelBulk = useMutation({
    mutationFn: kursunDagitimService.cancelBulk,
    onSuccess: (res) => {
      reportBulk(res);
      refresh();
    },
  });

  const setUrgent = useMutation({
    mutationFn: (v: { stepId: string; isUrgent: boolean }) =>
      kursunDagitimService.setUrgent(v.stepId, v.isUrgent),
    onSuccess: () => {
      toast.success("Acillik durumu güncellendi.");
      refresh();
    },
  });

  const reorder = useMutation({
    mutationFn: kursunDagitimService.reorder,
    onSuccess: () => {
      toast.success("Sıralama güncellendi.");
      refresh();
    },
    // Hata toast'ı apiClient interceptor'ından geliyor; burada yalnız iyimser
    // listeyi sunucudaki gerçek sıraya geri çekiyoruz.
    onError: () => refresh(),
  });

  const busy =
    assign.isPending ||
    assignBulk.isPending ||
    cancel.isPending ||
    cancelBulk.isPending ||
    setUrgent.isPending ||
    reorder.isPending;

  return { query, refresh, busy, assign, assignBulk, cancel, cancelBulk, setUrgent, reorder };
}
