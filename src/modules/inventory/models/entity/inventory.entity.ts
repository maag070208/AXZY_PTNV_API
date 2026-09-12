import type {
  AuditTransactionClient,
} from "../../../audit/models/entity/audit.entity";

export type MovementTipo =
  | "ENTRADA"
  | "SALIDA"
  | "TRASLADO"
  | "BAJA"
  | "PRESTAMO"
  | "DEVOLUCION";

export type MovementCondicion = "BUENO" | "ACEPTABLE" | "MALO" | "ROTO";

export interface MovementInput {
  deviceId: string;
  tipo: MovementTipo;
  locationId?: string;
  notas?: string;
  userId: string;
  userName?: string;
  prestamoId?: string;
  prestadoA?: string;
  fechaRetornoEsperado?: string;
  condicion?: MovementCondicion;
  motivoBaja?: string;
  cartaId?: string;
}

export interface MovementFilters {
  deviceId?: string;
  locationId?: string;
  start?: string;
  end?: string;
}

export type { AuditTransactionClient };