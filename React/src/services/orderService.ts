import { createCrudService } from "./crudService";
import type { Order } from "@/types/models";

export const orderService = createCrudService<Order>("/api/orders");
