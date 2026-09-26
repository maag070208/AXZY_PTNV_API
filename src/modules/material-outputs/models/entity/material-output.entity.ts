export type MaterialOutputMotivo = "DANADO" | "OBSOLETO" | "EXTRAVIO" | "OTRO";

export interface MaterialOutputInput {
  fecha?: string;
  descripcion: string;
  modelo?: string;
  marca?: string;
  proyecto?: string;
  cantidad?: number;
  departamento: string;
  usuario: string;
  observaciones?: string;
  area?: string;
  motivo?: MaterialOutputMotivo;
  unidadFisicaId?: string;
}

export interface MaterialOutputFilters {
  start?: string;
  end?: string;
  departamento?: string;
  usuario?: string;
  area?: string;
  proyecto?: string;
  motivo?: MaterialOutputMotivo;
  q?: string;
}