import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";
import { showServerWarnings } from "@/lib/serverNotes";

interface Options<T> {
  service: CrudService<T>;
  queryKey: string;
  entityName: string;
}

export function useCrudMutations<T>({ service, queryKey, entityName }: Options<T>) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] });
  // Uyarılar genel basımdan (App.tsx MutationCache) gelir; geri-al tostundaki `restore`
  // bir mutation DEĞİL, orada açık çağrı şart.

  const createMutation = useMutation({
    mutationFn: (data: Partial<T>) => service.create(data),
    onSuccess: () => {
      toast.success(`${entityName} oluşturuldu.`);
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) => service.update(id, data),
    onSuccess: () => {
      toast.success(`${entityName} güncellendi.`);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => service.remove(id),
    onSuccess: (_data, id) => {
      toast.success(`${entityName} silindi.`, {
        action: {
          label: "Geri al",
          onClick: () => {
            void service.restore(id).then((restored) => {
              toast.success(`${entityName} geri alındı.`);
              showServerWarnings(restored);
              invalidate();
            });
          },
        },
      });
      invalidate();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => service.restore(id),
    onSuccess: () => {
      toast.success(`${entityName} aktifleştirildi.`);
      invalidate();
    },
  });

  // Kalıcı silme (yalnız hiç kullanılmamış kayıt için — backend guard'lı). 409'da
  // apiClient interceptor'ı backend'in somut mesajını toast'lar; geri-al yok.
  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => service.hardRemove(id),
    onSuccess: () => {
      toast.success(`${entityName} kalıcı olarak silindi.`);
      invalidate();
    },
  });

  return { createMutation, updateMutation, removeMutation, restoreMutation, hardRemoveMutation };
}
