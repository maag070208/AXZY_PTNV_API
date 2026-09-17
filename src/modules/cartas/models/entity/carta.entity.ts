export interface CartaItemInput {
  deviceId?: string;
  descripcion?: string;
  marca?: string;
  modelo?: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  controlActivos?: string;
  area?: string;
}

export interface CartaInput {
  consecutivo?: string;
  fecha?: string;
  numeroEmpleado?: string;
  empresa?: string;
  departamento?: string;
  areaBoss?: string;
  deliveryBy?: string;
  creadoPorId?: string;
  responsableId?: string | null;
  encargadoId?: string | null;
  departmentId?: string | null;
  subareaId?: string | null;
  item: CartaItemInput;
}

export interface ReturnCartaInput {
  returnedBy: string;
  returnCondition: string;
}