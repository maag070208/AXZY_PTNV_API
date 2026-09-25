-- CreateTable
CREATE TABLE "permisos" (
    "clave" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "alcances" "Alcance"[],
    "sensible" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "permisos_modulo_orden_idx" ON "permisos"("modulo", "orden");

-- Seed del catálogo (idempotente). Replica `prisma/seed-data/permisos.json`.
INSERT INTO "permisos" ("clave","modulo","nombre","descripcion","alcances","sensible","activo","orden","updatedAt")
VALUES
  ('tickets.ver','Tickets','Ver tickets','Ver tickets, comentar y adjuntar archivos',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,1,NOW()),
  ('tickets.crear','Tickets','Crear tickets','Levantar tickets',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('tickets.editar','Tickets','Editar tickets','Título, descripción, prioridad, categoría, responsable y estado (menos cerrar). Con TODO también cambia el departamento',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,3,NOW()),
  ('tickets.cerrar','Tickets','Cerrar tickets','Cerrar tickets',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,4,NOW()),
  ('tickets.eliminar','Tickets','Eliminar tickets','Borrar tickets',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,5,NOW()),
  ('tareas.ver','Tareas','Ver tareas','Ver tareas en el tablero y en "Administrar tareas" (esta última con AREA o TODO)',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,1,NOW()),
  ('tareas.asignar','Tareas','Asignar tareas','Crear, editar y retirar tareas; moverlas entre estados sin completarlas',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,2,NOW()),
  ('tareas.completar','Tareas','Completar tareas','Completar tareas o moverlas a cualquier estado',ARRAY['PROPIO','AREA','TODO']::"Alcance"[],false,true,3,NOW()),
  ('dispositivos.ver','Inventario','Ver dispositivos','Ver dispositivos, tipos, unidades, existencias, kardex, movimientos y panel de inventario',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('dispositivos.crear','Inventario','Crear dispositivos','Alta de dispositivos (lotes) y unidades físicas',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('dispositivos.editar','Inventario','Editar dispositivos','Editar dispositivos/unidades y registrar movimientos (mantenimiento, baja, reversión)',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,3,NOW()),
  ('dispositivos.eliminar','Inventario','Eliminar dispositivos','Eliminar dispositivos',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,4,NOW()),
  ('prestamos.ver','Préstamos','Ver préstamos','Ver préstamos (cartas responsivas) y devoluciones',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('prestamos.crear','Préstamos','Crear préstamos','Crear préstamos (cartas responsivas)',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('prestamos.editar','Préstamos','Editar préstamos','Editar préstamos y registrar devoluciones',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,3,NOW()),
  ('prestamos.eliminar','Préstamos','Eliminar préstamos','Cancelar/eliminar préstamos',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,4,NOW()),
  ('salidas.registrar','Salidas','Registrar salidas','Registrar, editar y borrar salidas de material',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('reportes.ver','Reportes','Ver reportes','Ver reportes: entregas (cartas/items), dispositivos asignados, inventario completo y bitácora de salidas',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('reportes.exportar','Reportes','Exportar reportes','Exportar reportes: CSV server-side y PDF client-side de la página de reportes',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('personal.expediente','Personal','Ver expediente del personal','Ver y editar el expediente completo: datos, documentos, foto, descuentos',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('personal.actas','Personal','Actas administrativas','Levantar y consultar actas administrativas',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('usuarios.ver','Usuarios','Ver usuarios','Ver cuentas de usuario',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('usuarios.crear','Usuarios','Crear usuarios','Alta de cuentas e importación desde Excel',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('usuarios.editar','Usuarios','Editar usuarios','Editar cuentas, cambiar contraseñas, dar de baja y reactivar',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,3,NOW()),
  ('usuarios.eliminar','Usuarios','Eliminar usuarios','Eliminar cuentas',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,4,NOW()),
  ('usuarios.permisos','Usuarios','Cambiar permisos','Otorgar y quitar excepciones de permisos; cambiar el rol (solo con alcance TODO)',ARRAY['AREA','TODO']::"Alcance"[],true,true,5,NOW()),
  ('departamentos.administrar','Catálogos','Administrar departamentos','Crear y editar departamentos y subáreas',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('catalogos.administrar','Catálogos','Administrar catálogos','Categorías de ticket, tipos de dispositivo, géneros, tipos de sangre y de documento',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('acceso.escanear','Control de acceso','Escanear credenciales','Escanear credenciales, registrar entradas/salidas y ver sus registros del día',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('acceso.bitacora','Control de acceso','Ver bitácora de acceso','Bitácora, reporte de entradas/salidas y estadísticas',ARRAY['AREA','TODO']::"Alcance"[],false,true,2,NOW()),
  ('acceso.anular','Control de acceso','Anular registros de acceso','Anular registros de la bitácora',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,3,NOW()),
  ('acceso.sitios','Control de acceso','Administrar sitios','Administrar sitios (porterías)',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,4,NOW()),
  ('checador.ver','Checador','Ver checadas','Checadas y reporte de entradas/salidas del reloj',ARRAY['AREA','TODO']::"Alcance"[],false,true,1,NOW()),
  ('checador.sincronizar','Checador','Sincronizar checador','Importar por fechas y forzar la sincronización',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('checador.vincular','Checador','Vincular números del reloj','Vincular números del reloj con empleados',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,3,NOW()),
  ('relojes.administrar','Checador','Administrar relojes','Alta, baja y configuración de relojes (con los relojes solo se lee)',ARRAY['NINGUNO','TODO']::"Alcance"[],true,true,4,NOW()),
  ('horarios.ver','Horarios','Ver horarios','Consultar horarios y a quién están asignados',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('horarios.administrar','Horarios','Administrar horarios','Crear horarios y asignarlos en bloque',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,2,NOW()),
  ('horas_extra.ver','Horas extra','Ver horas extra','Consultar y exportar horas extra',ARRAY['AREA','TODO']::"Alcance"[],false,true,1,NOW()),
  ('horas_extra.aprobar','Horas extra','Aprobar horas extra','Aprobar horas extra',ARRAY['AREA','TODO']::"Alcance"[],false,true,2,NOW()),
  ('panel.ver','Sistema','Ver panel','Panel de indicadores en el inicio',ARRAY['NINGUNO','TODO']::"Alcance"[],false,true,1,NOW()),
  ('auditoria.ver','Sistema','Ver auditoría','Auditoría del sistema',ARRAY['NINGUNO','TODO']::"Alcance"[],true,true,2,NOW()),
  ('sistema.configurar','Sistema','Configurar el sistema','Configuración general y correos',ARRAY['NINGUNO','TODO']::"Alcance"[],true,true,3,NOW()),
  ('roles.administrar','Sistema','Administrar roles y permisos','Editar la matriz de roles y el catálogo de permisos',ARRAY['NINGUNO','TODO']::"Alcance"[],true,true,4,NOW())
ON CONFLICT ("clave") DO NOTHING;

-- Limpieza de huérfanos antes de la FK (claves que no existen en el catálogo).
DELETE FROM "rol_permisos" rp WHERE NOT EXISTS (SELECT 1 FROM "permisos" p WHERE p."clave" = rp."permiso");

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_fkey" FOREIGN KEY ("permiso") REFERENCES "permisos"("clave") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant de roles.administrar a ADMIN (idempotente).
INSERT INTO "rol_permisos" ("id","rol","permiso","alcance","updatedAt")
VALUES ('rolperm_roles_administrar','ADMIN','roles.administrar','TODO',NOW())
ON CONFLICT ("rol","permiso") DO NOTHING;
