import { z } from "@core/swagger/registry";

const chargeStatus = z.enum(["NOT_CHARGED", "PENDING", "CHARGED", "WAIVED"]);
const chargeAmount = z.number().min(0).max(9999999).nullish();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

/** Registro directo de una pérdida por huésped (JSON; sin fotos). */
export const HotelGuestLossCreateDto = z.object({
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).nullish(),
  roomId: z.string().min(1),
  guestName: z.string().trim().min(1).max(120),
  lines: z
    .array(z.object({ productId: z.string().min(1), lotId: z.string().min(1).nullish(), quantity: z.number().positive().max(999999) }))
    .min(1)
    .max(50),
  chargeStatus: chargeStatus.optional(),
  chargeAmount,
  notes: z.string().trim().max(500).nullish(),
});
export type HotelGuestLossCreateInput = z.infer<typeof HotelGuestLossCreateDto>;

/** Conversión de un préstamo no devuelto (el huésped sale del préstamo). */
export const HotelGuestLossFromLoanDto = z.object({
  chargeStatus: chargeStatus.optional(),
  chargeAmount,
  notes: z.string().trim().max(500).nullish(),
});
export type HotelGuestLossFromLoanInput = z.infer<typeof HotelGuestLossFromLoanDto>;

/** Conversión de un adicional faltante (el extra no guarda huésped: se captura). */
export const HotelGuestLossFromExtraDto = HotelGuestLossFromLoanDto.extend({ guestName: z.string().trim().min(1).max(120) });
export type HotelGuestLossFromExtraInput = z.infer<typeof HotelGuestLossFromExtraDto>;

/** Filtros del reporte de pérdidas por huésped (query string). */
export const HotelGuestLossReportQueryDto = z.object({
  from: day,
  to: day,
  roomId: z.string().min(1).optional(),
  guestName: z.string().trim().min(1).max(120).optional(),
});
export type HotelGuestLossReportQuery = z.infer<typeof HotelGuestLossReportQueryDto>;
