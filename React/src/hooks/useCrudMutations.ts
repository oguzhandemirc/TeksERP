import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";

interface UseCrudMutationsOptions<T> {
  service: CrudService<T>;
  queryKey: string;
  entityName: string;
}

export function useCrudMutations<T>({
  service,
  queryKey,
  entityName,
}: UseCrudMutationsOptions<T>) {
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] });

  const createMutation = useMutation({
    mutationFn: (data: Partial<T>) => service.create(data),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla oluşturuldu`);
      invalidate();
    },
    onError: () => {
      toast.error(`${entityName} oluşturulurken hata oluştu`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) =>
      service.update(id, data),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla güncellendi`);
      invalidate();
    },
    onError: () => {
      toast.error(`${entityName} güncellenirken hata oluştu`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => service.remove(id),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla pasife alındı`);
      invalidate();
    },
    onError: () => {
      toast.error(`${entityName} silinirken hata oluştu`);
    },
  });

  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => service.hardRemove(id),
    onSuccess: () => {
      toast.success(`${entityName} kalıcı olarak silindi`);
      invalidate();
    },
    onError: () => {
      toast.error(`${entityName} kalıcı silinirken hata oluştu`);
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => service.update(id, { isActive: true } as unknown as Partial<T>),
    onSuccess: () => {
      toast.success(`${entityName} başarıyla aktif edildi`);
      invalidate();
    },
    onError: () => {
      toast.error(`${entityName} aktif edilirken hata oluştu`);
    },
  });

  return { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation };
}
