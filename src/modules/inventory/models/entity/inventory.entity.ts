export type EstadoInventario = "DISPONIBLE" | "PRESTADO" | "DANADO" | "MANTENIMIENTO" | "BAJA";

export type TipoMovimiento =
  | "ENTRADA"
  | "PRESTAMO"
  | "DEVOLUCION"
  | "BAJA"
  | "TRASPASO"
  | "AJUSTE_ENTRADA"
  | "AJUSTE_SALIDA"
  | "MANTENIMIENTO_ENTRADA"
  | "MANTENIMIENTO_SALIDA"
  | "REVERSION";

export type Condicion = "BUENO" | "ACEPTABLE" | "MALO" | "ROTO";

export interface MovimientoDetalleInput {
  dispositivoId: string;
  cantidad: number;
  condicion?: Condicion;
  prestamoDetalleId?: string;
  unidadId?: string;
  observaciones?: string;
}

export interface CreateTipoDispositivoInput {
  code: string;
  name: string;
  folioPrefix: string;
  useSerie?: boolean;
  useMac?: boolean;
  useIp?: boolean;
  useEquipo?: boolean;
}

export interface UpdateTipoDispositivoInput {
  name?: string;
  folioPrefix?: string;
  active?: boolean;
  useSerie?: boolean;
  useMac?: boolean;
  useIp?: boolean;
  useEquipo?: boolean;
}

export interface CreateUnidadInput {
  numeroSerie?: string;
  macAddress?: string;
  ip?: string;
  nombreEquipo?: string;
}

export interface CreateDispositivoInput {
  tipoId: string;
  nombre: string;
  marca: string;
  modelo: string;
  descripcion?: string;
  observaciones?: string;
  cantidadInicial?: number;
  unidades?: CreateUnidadInput[];
}

export interface UpdateDispositivoInput {
  nombre?: string;
  marca?: string;
  modelo?: string;
  descripcion?: string;
  observaciones?: string;
}

export interface UpdateUnidadInput {
  numeroSerie?: string;
  macAddress?: string;
  ip?: string;
  nombreEquipo?: string;
  area?: string;
  departamentoId?: string;
}

export interface UpdateUnidadInput {
  numeroSerie?: string;
  macAddress?: string;
  ip?: string;
  nombreEquipo?: string;
  area?: string;
  departamentoId?: string;
}

export interface UpdateUnidadInput {
  numeroSerie?: string;
  macAddress?: string;
  ip?: string;
  nombreEquipo?: string;
  area?: string;
  departamentoId?: string;
}

export interface CreateMovimientoInput {
  tipo: TipoMovimiento;
  responsableId?: string;
  departamentoId?: string;
  subareaId?: string;
  motivo?: string;
  observaciones?: string;
  prestamoId?: string;
  movimientoId?: string;
  detalles: MovimientoDetalleInput[];
}

export interface CreatePrestamoInput {
  responsableId?: string;
  departamentoId?: string;
  subareaId?: string;
  observaciones?: string;
  detalles: { dispositivoId: string; cantidad: number }[];
}

export interface UpdatePrestamoInput {
  responsableId?: string;
  departamentoId?: string;
  subareaId?: string;
  observaciones?: string;
  dispositivoId?: string;
  cantidad?: number;
}

export interface CreateDevolucionInput {
  prestamoId: string;
  responsableId?: string;
  observaciones?: string;
  detalles: { prestamoDetalleId: string; cantidad: number; condicion: Condicion; observaciones?: string }[];
}