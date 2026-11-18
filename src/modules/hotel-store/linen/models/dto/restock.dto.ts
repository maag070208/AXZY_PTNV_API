import { z } from "@core/swagger/registry";

export const HotelRestockRequestDto = z
  .object({
    warehouseId: z.string().min(1),
    /** Entero 1–5 (default 1); el rango se valida con `parseRestockFactor` para responder HOTEL_RESTOCK_FACTOR_INVALID. */
    factor: z.number().optional(),
  })
  .openapi("HotelRestockRequestInput");
