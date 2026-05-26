import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrudService } from "@/services/crudService";

interface Options<T> {
  service: CrudService<T>;
  queryKey: string;
  entityName: string;
}

export function useCrudMutations<T>({ service, queryKey, entityName }: Options<T>) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] });

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
    onSuccess: () => {
      toast.success(`${entityName} silindi.`);
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

  return { createMutation, updateMutation, removeMutation, restoreMutation };
}
