import { createCrudService } from "@/services/crudService";
import type { Customer } from "./types";

export const customerService = createCrudService<Customer>("/api/customers");
