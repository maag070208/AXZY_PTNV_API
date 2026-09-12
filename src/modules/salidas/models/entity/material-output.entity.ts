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
  deviceId?: string;
}

export interface MaterialOutputFilters {
  start?: string;
  end?: string;
  departamento?: string;
  usuario?: string;
  area?: string;
  proyecto?: string;
  q?: string;
}