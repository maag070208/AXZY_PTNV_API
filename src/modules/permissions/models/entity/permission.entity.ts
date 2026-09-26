import type { Role } from "@prisma/client";
import type { Alcance } from "@core/permisos";

/** Permiso del catálogo tal como lo lee la administración (incluye inactivos). */
export interface PermisoCatalogo {
  clave: string;
  modulo: string;
  nombre: string;
  descripcion: string | null;
  alcances: Alcance[];
  sensible: boolean;
  activo: boolean;
  orden: number;
}

/** Celda vigente de la matriz rol → permiso → alcance. */
export interface MatrizCelda {
  rol: Role;
  permiso: string;
  alcance: Alcance;
}

/** Payload de la pantalla de administración de roles y permisos. */
export interface RolesAdminData {
  roles: Role[];
  catalogo: PermisoCatalogo[];
  matriz: MatrizCelda[];
}
