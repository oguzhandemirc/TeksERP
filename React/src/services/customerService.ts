import { createCrudService } from "./crudService";
import type { Customer } from "@/types/models";

export const customerService = createCrudService<Customer>("/api/customers");
