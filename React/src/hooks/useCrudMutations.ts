import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";

interface UseCrudMutationsOptions<T> {
  service: CrudService<T>;
  queryKey: string;
  entityName: string;
  /**
   * Mutation başarılı olduğunda invalidate edilecek ek queryKey'ler.
   * Cross-entity senaryolar için: örn. order güncellenince ["customers"] da invalidate edilebilir.
   * Prefix match ile çalışır, yani ["work-orders"] hem ["work-orders", params] hem de ["work-orders", id] cache'lerini invalidate eder.
   */
  relatedKeys?: (string | readonly unknown[])[];
}

// Hata toast'larını apiClient interceptor'ı backend'in gerçek mesajıyla gösterir.
// Bu hook sadece success toast'larını gösterir; onError'a generic mesaj koymak
// duplicate toast yaratır ve testçinin gerçek hata mesajını görmesini engeller.
export function useCrudMutations<T>({
  service,
  queryKey,
  entityName,
  relatedKeys,
}: UseCrudMutationsOptions<T>) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [queryKey] });
    relatedKeys?.forEach((k) => {
      qc.invalidateQueries({ queryKey: Array.isArray(k) ? [...k] : [k] });
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<T>) => service.create(data),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla oluşturuldu`);
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) =>
      service.update(id, data),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla güncellendi`);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => service.remove(id),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla pasife alındı`);
      invalidate();
    },
  });

  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => service.hardRemove(id),
    onSuccess: () => {
      toast.success(`${entityName} kalıcı olarak silindi`);
      invalidate();
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => service.update(id, { isActive: true } as unknown as Partial<T>),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla aktif edildi`);
      invalidate();
    },
  });

  return { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation };
}
