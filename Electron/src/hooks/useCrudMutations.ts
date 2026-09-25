import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";

interface Options<T> {
  service: CrudService<T>;
  queryKey: string;
  entityName: string;
}

export function useCrudMutations<T>({ service, queryKey, entityName }: Options<T>) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] });
  // Sunucunun engel olmayan notu (ör. pasife alınan kartta canlı top) başarı tostunun
  // yanında AYRI uyarı olarak basılır; yutulursa kullanıcı etkiyi hiçbir ekranda görmez.
  const showWarnings = (res: ApiResponse<unknown> | undefined) => {
    for (const w of res?.warnings ?? []) toast.warning(w, { duration: 8000 });
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<T>) => service.create(data),
    onSuccess: (res) => {
      toast.success(`${entityName} oluşturuldu.`);
      showWarnings(res);
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) => service.update(id, data),
    onSuccess: (res) => {
      toast.success(`${entityName} güncellendi.`);
      showWarnings(res);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => service.remove(id),
    onSuccess: (res, id) => {
      toast.success(`${entityName} silindi.`, {
        action: {
          label: "Geri al",
          onClick: () => {
            void service.restore(id).then((restored) => {
              toast.success(`${entityName} geri alındı.`);
              showWarnings(restored);
              invalidate();
            });
          },
        },
      });
      showWarnings(res);
      invalidate();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => service.restore(id),
    onSuccess: (res) => {
      toast.success(`${entityName} aktifleştirildi.`);
      showWarnings(res);
      invalidate();
    },
  });

  // Kalıcı silme (yalnız hiç kullanılmamış kayıt için — backend guard'lı). 409'da
  // apiClient interceptor'ı backend'in somut mesajını toast'lar; geri-al yok.
  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => service.hardRemove(id),
    onSuccess: (res) => {
      toast.success(`${entityName} kalıcı olarak silindi.`);
      showWarnings(res);
      invalidate();
    },
  });

  return { createMutation, updateMutation, removeMutation, restoreMutation, hardRemoveMutation };
}
