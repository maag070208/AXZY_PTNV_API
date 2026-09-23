import type { AccessEventType } from "@prisma/client";

/**
 * Entrada para registrar un evento de acceso. El `occurredAt` nunca viene del
 * cliente: lo fija el servidor. `deviceTimestamp` es solo auditoría del reloj
 * del dispositivo.
 */
export interface AccessEventCreateInput {
  /** Payload crudo del QR escaneado (JSON `v:2`). */
  qr?: string;
  /** Alternativa manual al QR: id del empleado (method = MANUAL). */
  employeeId?: string;
  type: AccessEventType;
  siteId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  deviceTimestamp?: string | null;
  /** Idempotencia generada en el dispositivo. */
  clientEventId: string;
  deviceId?: string | null;
  deviceCode?: string | null;
  notes?: string | null;
}

export interface AccessEventFilters {
  employeeId?: string;
  siteId?: string;
  type?: string;
  method?: string;
  start?: string;
  end?: string;
  q?: string;
  includeVoided?: boolean;
}

export interface SiteCreateInput {
  name: string;
  code?: string | null;
  active?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
}

export type SiteUpdateInput = Partial<SiteCreateInput>;

/** Actor autenticado que registra/anula (guardia o admin). */
export interface AccessActor {
  id: string;
  name?: string;
}
