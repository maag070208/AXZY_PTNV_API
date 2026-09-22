import type { APIRequestContext, APIResponse } from "@playwright/test";

export type Estado = "DISPONIBLE" | "PRESTADO" | "DANADO" | "MANTENIMIENTO" | "BAJA";
export type Condicion = "BUENO" | "ACEPTABLE" | "MALO" | "ROTO";
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

export interface TipoDispositivo {
  id: string;
  code: string;
  name: string;
  folioPrefix: string;
  contador: number;
  active: boolean;
}

export interface Dispositivo {
  id: string;
  tipoId: string;
  nombre: string;
  marca: string;
  modelo: string;
}

export interface Unidad {
  id: string;
  activoFijo: string;
  numeroSerie: string | null;
  macAddress: string | null;
  ip: string | null;
  nombreEquipo: string | null;
  area: string;
  estado: Estado;
  departamentoId: string | null;
  dispositivoId: string;
}

export interface Existencias extends Record<Estado, number> {
  activa: number;
  historica: number;
}

export interface MovimientoDetalle {
  id: string;
  dispositivoId: string;
  cantidad: number;
  condicion: Condicion | null;
  observaciones: string | null;
}

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  usuarioId: string;
  responsableId: string | null;
  departamentoId: string | null;
  motivo: string | null;
  observaciones: string | null;
  status: "ACTIVO" | "CANCELADO";
  reversaDeId: string | null;
  detalles: MovimientoDetalle[];
}

export interface PrestamoDetalle {
  id: string;
  dispositivoId: string;
  cantidad: number;
  devuelto: number;
}

export interface Prestamo {
  id: string;
  consecutivo: string;
  status: "ACTIVO" | "PARCIAL" | "DEVUELTO" | "CANCELADO";
  movimientoId: string | null;
  responsableId: string | null;
  departamentoId: string | null;
  observaciones: string | null;
  detalles: PrestamoDetalle[];
  devoluciones: { id: string; consecutivo: string }[];
}

export interface KardexRow {
  tipo: TipoMovimiento;
  entrada: number;
  salida: number;
  saldo: number;
  condicion: Condicion | null;
  motivo: string | null;
}

export interface Kardex {
  dispositivo: Dispositivo;
  existencias: Existencias;
  rows: KardexRow[];
}

/** Respuesta cruda, para los casos donde lo que se verifica es el error. */
export interface Res<T> {
  status: number;
  body: T;
}

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

/**
 * `baseURL` incluye el prefijo `/api/v1`, y `new URL("/x", base)` lo borraría:
 * las rutas viajan siempre relativas.
 */
const ruta = (path: string): string => path.replace(/^\/+/, "");

const leer = async <T>(res: APIResponse): Promise<Res<T>> => {
  const texto = await res.text();
  let body: unknown = null;
  try {
    body = texto ? JSON.parse(texto) : null;
  } catch {
    body = texto;
  }
  return { status: res.status(), body: body as T };
};

/**
 * Cliente del módulo de inventario sobre la API real.
 *
 * Los métodos con nombre de negocio (`crearTipo`, `prestar`, `darDeBaja`…)
 * exigen el status de éxito y devuelven el cuerpo ya tipado, para que los tests
 * se lean como la especificación funcional. Para los caminos de error están los
 * métodos crudos `post`/`get`/`put`, que nunca lanzan.
 */
export class InventarioApi {
  constructor(private readonly request: APIRequestContext) {}

  // --- Crudos: no lanzan, devuelven status + cuerpo ---------------------------
  async post<T = ErrorBody>(path: string, data?: unknown): Promise<Res<T>> {
    return leer<T>(await this.request.post(ruta(path), { data: data ?? {} }));
  }

  async get<T = ErrorBody>(path: string): Promise<Res<T>> {
    return leer<T>(await this.request.get(ruta(path)));
  }

  async put<T = ErrorBody>(path: string, data?: unknown): Promise<Res<T>> {
    return leer<T>(await this.request.put(ruta(path), { data: data ?? {} }));
  }

  async del<T = ErrorBody>(path: string): Promise<Res<T>> {
    return leer<T>(await this.request.delete(ruta(path)));
  }

  private async exigir<T>(res: Res<T | ErrorBody>, esperado: number, accion: string): Promise<T> {
    if (res.status !== esperado) {
      throw new Error(
        `${accion}: se esperaba HTTP ${esperado} y la API respondió ${res.status} → ${JSON.stringify(res.body)}`
      );
    }
    return res.body as T;
  }

  // --- Catálogo y alta -------------------------------------------------------
  async crearTipo(input: {
    code: string;
    name: string;
    folioPrefix: string;
    useSerie?: boolean;
    useMac?: boolean;
    useIp?: boolean;
    useEquipo?: boolean;
  }): Promise<TipoDispositivo> {
    return this.exigir(await this.post<TipoDispositivo>("/inventario/tipos", input), 201, "crearTipo");
  }

  async listarTipos(): Promise<TipoDispositivo[]> {
    return this.exigir(await this.get<TipoDispositivo[]>("/inventario/tipos"), 200, "listarTipos");
  }

  async tipo(id: string): Promise<TipoDispositivo> {
    const tipos = await this.listarTipos();
    const tipo = tipos.find((t) => t.id === id);
    if (!tipo) throw new Error(`Tipo ${id} no encontrado en el catálogo`);
    return tipo;
  }

  async crearDispositivo(input: {
    tipoId: string;
    nombre: string;
    marca: string;
    modelo: string;
    descripcion?: string;
    observaciones?: string;
    cantidadInicial?: number;
    unidades?: { numeroSerie?: string; macAddress?: string; ip?: string; nombreEquipo?: string }[];
  }): Promise<Dispositivo> {
    return this.exigir(
      await this.post<Dispositivo>("/inventario/dispositivos", input),
      201,
      "crearDispositivo"
    );
  }

  async existencias(dispositivoId: string): Promise<Existencias> {
    return this.exigir(
      await this.get<Existencias>(`/inventario/dispositivos/${dispositivoId}/existencias`),
      200,
      "existencias"
    );
  }

  async unidades(dispositivoId: string): Promise<Unidad[]> {
    return this.exigir(
      await this.get<Unidad[]>(`/inventario/dispositivos/${dispositivoId}/unidades`),
      200,
      "unidades"
    );
  }

  async kardex(dispositivoId: string): Promise<Kardex> {
    return this.exigir(
      await this.get<Kardex>(`/inventario/dispositivos/${dispositivoId}/kardex`),
      200,
      "kardex"
    );
  }

  // --- Movimientos -----------------------------------------------------------
  async movimiento(input: {
    tipo: "BAJA" | "MANTENIMIENTO_ENTRADA" | "MANTENIMIENTO_SALIDA";
    motivo?: string;
    observaciones?: string;
    detalles: {
      dispositivoId: string;
      cantidad: number;
      condicion?: Condicion;
      unidadId?: string;
      observaciones?: string;
    }[];
  }): Promise<Movimiento> {
    return this.exigir(
      await this.post<Movimiento>("/inventario/movimientos", input),
      201,
      `movimiento ${input.tipo}`
    );
  }

  async verMovimiento(id: string): Promise<Movimiento> {
    return this.exigir(await this.get<Movimiento>(`/inventario/movimientos/${id}`), 200, "verMovimiento");
  }

  async listarMovimientos(filtros: { tipo?: string; dispositivoId?: string } = {}): Promise<Movimiento[]> {
    const qs = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return this.exigir(
      await this.get<Movimiento[]>(`/inventario/movimientos${qs ? `?${qs}` : ""}`),
      200,
      "listarMovimientos"
    );
  }

  async revertir(movimientoId: string): Promise<Movimiento> {
    return this.exigir(
      await this.post<Movimiento>(`/inventario/movimientos/${movimientoId}/revertir`),
      201,
      "revertir"
    );
  }

  // --- Préstamos y devoluciones ---------------------------------------------
  /**
   * `POST /inventario/prestamos` devuelve el *movimiento*, no el préstamo, así
   * que aquí se resuelve el préstamo asociado para que los tests trabajen con
   * la entidad de negocio (consecutivo, status, detalles).
   */
  async prestar(input: {
    responsableId?: string;
    departamentoId?: string;
    subareaId?: string;
    observaciones?: string;
    detalles: { dispositivoId: string; cantidad: number }[];
  }): Promise<{ movimiento: Movimiento; prestamo: Prestamo }> {
    const movimiento = await this.exigir(
      await this.post<Movimiento>("/inventario/prestamos", input),
      201,
      "prestar"
    );
    const prestamo = await this.prestamoDeMovimiento(movimiento.id);
    return { movimiento, prestamo };
  }

  async listarPrestamos(filtros: { status?: string; responsableId?: string } = {}): Promise<Prestamo[]> {
    const qs = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return this.exigir(
      await this.get<Prestamo[]>(`/inventario/prestamos${qs ? `?${qs}` : ""}`),
      200,
      "listarPrestamos"
    );
  }

  async prestamoDeMovimiento(movimientoId: string): Promise<Prestamo> {
    const prestamos = await this.listarPrestamos();
    const prestamo = prestamos.find((p) => p.movimientoId === movimientoId);
    if (!prestamo) throw new Error(`No hay préstamo ligado al movimiento ${movimientoId}`);
    return prestamo;
  }

  async prestamo(id: string): Promise<Prestamo> {
    return this.exigir(await this.get<Prestamo>(`/inventario/prestamos/${id}`), 200, "prestamo");
  }

  async devolver(input: {
    prestamoId: string;
    responsableId?: string;
    observaciones?: string;
    detalles: {
      prestamoDetalleId: string;
      cantidad: number;
      condicion: Condicion;
      observaciones?: string;
    }[];
  }): Promise<Movimiento> {
    return this.exigir(
      await this.post<Movimiento>("/inventario/devoluciones", input),
      201,
      "devolver"
    );
  }

  async cancelarPrestamo(id: string): Promise<Prestamo> {
    return this.exigir(
      await this.post<Prestamo>(`/inventario/prestamos/${id}/cancelar`),
      200,
      "cancelarPrestamo"
    );
  }

  async actualizarPrestamo(
    id: string,
    input: {
      responsableId?: string;
      departamentoId?: string;
      subareaId?: string;
      observaciones?: string;
      dispositivoId?: string;
      cantidad?: number;
    }
  ): Promise<Prestamo> {
    return this.exigir(
      await this.put<Prestamo>(`/inventario/prestamos/${id}`, input),
      200,
      "actualizarPrestamo"
    );
  }

  // --- Atajos de negocio -----------------------------------------------------
  darDeBaja(dispositivoId: string, cantidad: number, motivo: string, unidadId?: string) {
    return this.movimiento({
      tipo: "BAJA",
      motivo,
      detalles: [{ dispositivoId, cantidad, ...(unidadId ? { unidadId } : {}) }],
    });
  }

  enviarAMantenimiento(dispositivoId: string, cantidad: number, motivo?: string, unidadId?: string) {
    return this.movimiento({
      tipo: "MANTENIMIENTO_ENTRADA",
      motivo,
      detalles: [{ dispositivoId, cantidad, ...(unidadId ? { unidadId } : {}) }],
    });
  }

  sacarDeMantenimiento(dispositivoId: string, cantidad: number, condicion: Condicion, unidadId?: string) {
    return this.movimiento({
      tipo: "MANTENIMIENTO_SALIDA",
      detalles: [{ dispositivoId, cantidad, condicion, ...(unidadId ? { unidadId } : {}) }],
    });
  }
}
