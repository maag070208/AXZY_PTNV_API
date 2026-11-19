import { z } from "@core/swagger/registry";

const id = z.string().min(1).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

/** Filtros del reporte de ajustes al inventario (query string). */
export const HotelAdjustmentReportQueryDto = z.object({
  from: day,
  to: day,
  warehouseId: id,
  productId: id,
  reasonId: id,
  type: z.enum(["ADJUST_IN", "ADJUST_OUT", "WRITE_OFF"]).optional(),
  status: z.enum(["PENDING_APPROVAL", "ACTIVE", "CANCELLED"]).optional(),
});
export type HotelAdjustmentReportQuery = z.infer<typeof HotelAdjustmentReportQueryDto>;
