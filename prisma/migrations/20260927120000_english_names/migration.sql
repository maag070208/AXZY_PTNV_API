-- Migración english_names: nombres de tablas, columnas y enums a inglés.
-- Generado por english-migration/tools/gen-migration.js desde db-rename-spec.json.
-- Solo RENAME y UPDATE de códigos: ninguna fila se borra ni se reescribe fuera de esos códigos.

-- Enums: tipo y valores (en sitio, sin reescribir filas)
ALTER TYPE "Role" RENAME VALUE 'GERENTE' TO 'MANAGER';
ALTER TYPE "Role" RENAME VALUE 'JEFE_DE_AREA' TO 'AREA_HEAD';
ALTER TYPE "Role" RENAME VALUE 'EMPLEADO' TO 'EMPLOYEE';
ALTER TYPE "Role" RENAME VALUE 'RECURSOS_HUMANOS' TO 'HUMAN_RESOURCES';
ALTER TYPE "TipoDescuento" RENAME TO "DiscountType";
ALTER TYPE "DiscountType" RENAME VALUE 'DEUDOR_ALIMENTICIO' TO 'CHILD_SUPPORT';
ALTER TYPE "MotivoActaAdministrativa" RENAME TO "DisciplinaryReason";
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'INASISTENCIA' TO 'ABSENCE';
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'RETARDO' TO 'TARDINESS';
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'EBRIEDAD' TO 'INTOXICATION';
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'CONDUCTA' TO 'MISCONDUCT';
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'INCUMPLIMIENTO' TO 'NONCOMPLIANCE';
ALTER TYPE "DisciplinaryReason" RENAME VALUE 'OTRO' TO 'OTHER';
ALTER TYPE "MaterialOutputMotivo" RENAME TO "MaterialOutputReason";
ALTER TYPE "MaterialOutputReason" RENAME VALUE 'DANADO' TO 'DAMAGED';
ALTER TYPE "MaterialOutputReason" RENAME VALUE 'OBSOLETO' TO 'OBSOLETE';
ALTER TYPE "MaterialOutputReason" RENAME VALUE 'EXTRAVIO' TO 'LOST';
ALTER TYPE "MaterialOutputReason" RENAME VALUE 'OTRO' TO 'OTHER';
ALTER TYPE "EstadoInventario" RENAME TO "DeviceUnitStatus";
ALTER TYPE "DeviceUnitStatus" RENAME VALUE 'DISPONIBLE' TO 'AVAILABLE';
ALTER TYPE "DeviceUnitStatus" RENAME VALUE 'PRESTADO' TO 'ON_LOAN';
ALTER TYPE "DeviceUnitStatus" RENAME VALUE 'DANADO' TO 'DAMAGED';
ALTER TYPE "DeviceUnitStatus" RENAME VALUE 'MANTENIMIENTO' TO 'IN_MAINTENANCE';
ALTER TYPE "DeviceUnitStatus" RENAME VALUE 'BAJA' TO 'RETIRED';
ALTER TYPE "TipoMovimiento" RENAME TO "MovementType";
ALTER TYPE "MovementType" RENAME VALUE 'ENTRADA' TO 'STOCK_IN';
ALTER TYPE "MovementType" RENAME VALUE 'PRESTAMO' TO 'LOAN';
ALTER TYPE "MovementType" RENAME VALUE 'DEVOLUCION' TO 'RETURN';
ALTER TYPE "MovementType" RENAME VALUE 'BAJA' TO 'RETIREMENT';
ALTER TYPE "MovementType" RENAME VALUE 'TRASPASO' TO 'TRANSFER';
ALTER TYPE "MovementType" RENAME VALUE 'AJUSTE_ENTRADA' TO 'ADJUSTMENT_IN';
ALTER TYPE "MovementType" RENAME VALUE 'AJUSTE_SALIDA' TO 'ADJUSTMENT_OUT';
ALTER TYPE "MovementType" RENAME VALUE 'MANTENIMIENTO_ENTRADA' TO 'MAINTENANCE_IN';
ALTER TYPE "MovementType" RENAME VALUE 'MANTENIMIENTO_SALIDA' TO 'MAINTENANCE_OUT';
ALTER TYPE "MovementType" RENAME VALUE 'REVERSION' TO 'REVERSAL';
ALTER TYPE "EstadoMovimiento" RENAME TO "MovementStatus";
ALTER TYPE "MovementStatus" RENAME VALUE 'ACTIVO' TO 'ACTIVE';
ALTER TYPE "MovementStatus" RENAME VALUE 'CANCELADO' TO 'CANCELLED';
ALTER TYPE "EstadoPrestamo" RENAME TO "LoanStatus";
ALTER TYPE "LoanStatus" RENAME VALUE 'ACTIVO' TO 'ACTIVE';
ALTER TYPE "LoanStatus" RENAME VALUE 'PARCIAL' TO 'PARTIAL';
ALTER TYPE "LoanStatus" RENAME VALUE 'DEVUELTO' TO 'RETURNED';
ALTER TYPE "LoanStatus" RENAME VALUE 'CANCELADO' TO 'CANCELLED';
ALTER TYPE "CondicionEnum" RENAME TO "ItemCondition";
ALTER TYPE "ItemCondition" RENAME VALUE 'BUENO' TO 'GOOD';
ALTER TYPE "ItemCondition" RENAME VALUE 'ACEPTABLE' TO 'FAIR';
ALTER TYPE "ItemCondition" RENAME VALUE 'MALO' TO 'POOR';
ALTER TYPE "ItemCondition" RENAME VALUE 'ROTO' TO 'BROKEN';
ALTER TYPE "TicketStatus" RENAME VALUE 'ABIERTO' TO 'OPEN';
ALTER TYPE "TicketStatus" RENAME VALUE 'EN_SEGUIMIENTO' TO 'IN_PROGRESS';
ALTER TYPE "TicketStatus" RENAME VALUE 'CERRADO' TO 'CLOSED';
ALTER TYPE "TicketPriority" RENAME VALUE 'BAJA' TO 'LOW';
ALTER TYPE "TicketPriority" RENAME VALUE 'MEDIA' TO 'MEDIUM';
ALTER TYPE "TicketPriority" RENAME VALUE 'ALTA' TO 'HIGH';
ALTER TYPE "TicketPriority" RENAME VALUE 'URGENTE' TO 'URGENT';
ALTER TYPE "AssignmentStatus" RENAME VALUE 'PENDIENTE' TO 'PENDING';
ALTER TYPE "AssignmentStatus" RENAME VALUE 'EN_PROGRESO' TO 'IN_PROGRESS';
ALTER TYPE "AssignmentStatus" RENAME VALUE 'EN_REVISION' TO 'IN_REVIEW';
ALTER TYPE "AssignmentStatus" RENAME VALUE 'COMPLETADA' TO 'COMPLETED';
ALTER TYPE "MetodoChecada" RENAME TO "PunchMethod";
ALTER TYPE "PunchMethod" RENAME VALUE 'ROSTRO' TO 'FACE';
ALTER TYPE "PunchMethod" RENAME VALUE 'HUELLA' TO 'FINGERPRINT';
ALTER TYPE "PunchMethod" RENAME VALUE 'TARJETA' TO 'CARD';
ALTER TYPE "PunchMethod" RENAME VALUE 'OTRO' TO 'OTHER';
ALTER TYPE "OvertimeApprovalStatus" RENAME VALUE 'APROBADO' TO 'APPROVED';
ALTER TYPE "OvertimeApprovalStatus" RENAME VALUE 'RECHAZADO' TO 'REJECTED';
ALTER TYPE "Alcance" RENAME TO "PermissionScope";
ALTER TYPE "PermissionScope" RENAME VALUE 'NINGUNO' TO 'NONE';
ALTER TYPE "PermissionScope" RENAME VALUE 'PROPIO' TO 'OWN';
ALTER TYPE "PermissionScope" RENAME VALUE 'TODO' TO 'ALL';

-- Tablas
ALTER TABLE "generos" RENAME TO "genders";
ALTER TABLE "tipos_sangre" RENAME TO "blood_types";
ALTER TABLE "tipos_documento" RENAME TO "document_types";
ALTER TABLE "tipos_dispositivo" RENAME TO "device_types";
ALTER TABLE "dispositivos" RENAME TO "devices";
ALTER TABLE "unidades_fisicas" RENAME TO "device_units";
ALTER TABLE "movimientos" RENAME TO "movements";
ALTER TABLE "movimiento_detalles" RENAME TO "movement_items";
ALTER TABLE "movimiento_detalle_unidades" RENAME TO "movement_item_units";
ALTER TABLE "prestamos" RENAME TO "loans";
ALTER TABLE "prestamo_detalles" RENAME TO "loan_items";
ALTER TABLE "prestamo_detalle_unidades" RENAME TO "loan_item_units";
ALTER TABLE "devoluciones" RENAME TO "loan_returns";
ALTER TABLE "devolucion_detalles" RENAME TO "loan_return_items";
ALTER TABLE "devolucion_detalle_unidades" RENAME TO "loan_return_item_units";
ALTER TABLE "consecutivos" RENAME TO "legacy_sequences";
ALTER TABLE "cartas_administrativas" RENAME TO "disciplinary_reports";
ALTER TABLE "horarios" RENAME TO "schedules";
ALTER TABLE "horario_dias" RENAME TO "schedule_days";
ALTER TABLE "horario_asignaciones" RENAME TO "schedule_assignments";
ALTER TABLE "checadas" RENAME TO "time_clock_punches";
ALTER TABLE "checador_sync" RENAME TO "time_clocks";
ALTER TABLE "checador_empleados" RENAME TO "time_clock_employees";
ALTER TABLE "permisos" RENAME TO "permissions";
ALTER TABLE "rol_permisos" RENAME TO "role_permissions";

-- Columnas
ALTER TABLE "users" RENAME COLUMN "puesto" TO "jobTitle";
ALTER TABLE "users" RENAME COLUMN "numeroEmpleado" TO "employeeNumber";
ALTER TABLE "users" RENAME COLUMN "empresa" TO "company";
ALTER TABLE "users" RENAME COLUMN "segundoNombre" TO "middleName";
ALTER TABLE "users" RENAME COLUMN "apellidoPaterno" TO "paternalSurname";
ALTER TABLE "users" RENAME COLUMN "apellidoMaterno" TO "maternalSurname";
ALTER TABLE "users" RENAME COLUMN "fotoKey" TO "photoKey";
ALTER TABLE "users" RENAME COLUMN "generoId" TO "genderId";
ALTER TABLE "users" RENAME COLUMN "tipoSangreId" TO "bloodTypeId";
ALTER TABLE "users" RENAME COLUMN "padecimiento" TO "medicalConditions";
ALTER TABLE "users" RENAME COLUMN "alergias" TO "allergies";
ALTER TABLE "users" RENAME COLUMN "fechaNacimiento" TO "birthDate";
ALTER TABLE "users" RENAME COLUMN "fechaIngreso" TO "hireDate";
ALTER TABLE "users" RENAME COLUMN "calleNumero" TO "streetAddress";
ALTER TABLE "users" RENAME COLUMN "colonia" TO "neighborhood";
ALTER TABLE "users" RENAME COLUMN "codigoPostal" TO "postalCode";
ALTER TABLE "users" RENAME COLUMN "ciudad" TO "city";
ALTER TABLE "users" RENAME COLUMN "estadoDireccion" TO "addressState";
ALTER TABLE "users" RENAME COLUMN "pais" TO "country";
ALTER TABLE "users" RENAME COLUMN "celularPersonal" TO "personalPhone";
ALTER TABLE "users" RENAME COLUMN "celularEmpresa" TO "workPhone";
ALTER TABLE "users" RENAME COLUMN "contactoEmergenciaNombre" TO "emergencyContactName";
ALTER TABLE "users" RENAME COLUMN "contactoEmergenciaTelefono" TO "emergencyContactPhone";
ALTER TABLE "users" RENAME COLUMN "contactoEmergenciaParentesco" TO "emergencyContactRelationship";
ALTER TABLE "genders" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "genders" RENAME COLUMN "activo" TO "active";
ALTER TABLE "blood_types" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "blood_types" RENAME COLUMN "activo" TO "active";
ALTER TABLE "document_types" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "document_types" RENAME COLUMN "activo" TO "active";
ALTER TABLE "document_types" RENAME COLUMN "orden" TO "sortOrder";
ALTER TABLE "employee_discounts" RENAME COLUMN "tipo" TO "type";
ALTER TABLE "employee_discounts" RENAME COLUMN "nota" TO "note";
ALTER TABLE "employee_documents" RENAME COLUMN "tipoDocumentoId" TO "documentTypeId";
ALTER TABLE "device_types" RENAME COLUMN "folioPrefix" TO "assetTagPrefix";
ALTER TABLE "device_types" RENAME COLUMN "contador" TO "counter";
ALTER TABLE "device_types" RENAME COLUMN "useSerie" TO "useSerialNumber";
ALTER TABLE "device_types" RENAME COLUMN "useEquipo" TO "useHostname";
ALTER TABLE "devices" RENAME COLUMN "tipoId" TO "typeId";
ALTER TABLE "devices" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "devices" RENAME COLUMN "marca" TO "brand";
ALTER TABLE "devices" RENAME COLUMN "modelo" TO "model";
ALTER TABLE "devices" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "devices" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "device_units" RENAME COLUMN "dispositivoId" TO "deviceId";
ALTER TABLE "device_units" RENAME COLUMN "activoFijo" TO "assetTag";
ALTER TABLE "device_units" RENAME COLUMN "numeroSerie" TO "serialNumber";
ALTER TABLE "device_units" RENAME COLUMN "nombreEquipo" TO "hostname";
ALTER TABLE "device_units" RENAME COLUMN "estado" TO "status";
ALTER TABLE "device_units" RENAME COLUMN "departamentoId" TO "departmentId";
ALTER TABLE "movements" RENAME COLUMN "tipo" TO "type";
ALTER TABLE "movements" RENAME COLUMN "fecha" TO "date";
ALTER TABLE "movements" RENAME COLUMN "usuarioId" TO "createdById";
ALTER TABLE "movements" RENAME COLUMN "responsableId" TO "custodianId";
ALTER TABLE "movements" RENAME COLUMN "departamentoId" TO "departmentId";
ALTER TABLE "movements" RENAME COLUMN "motivo" TO "reason";
ALTER TABLE "movements" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "movements" RENAME COLUMN "reversaDeId" TO "reversalOfId";
ALTER TABLE "movement_items" RENAME COLUMN "movimientoId" TO "movementId";
ALTER TABLE "movement_items" RENAME COLUMN "dispositivoId" TO "deviceId";
ALTER TABLE "movement_items" RENAME COLUMN "cantidad" TO "quantity";
ALTER TABLE "movement_items" RENAME COLUMN "condicion" TO "condition";
ALTER TABLE "movement_items" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "movement_item_units" RENAME COLUMN "movimientoDetalleId" TO "movementItemId";
ALTER TABLE "movement_item_units" RENAME COLUMN "unidadFisicaId" TO "deviceUnitId";
ALTER TABLE "loans" RENAME COLUMN "responsableId" TO "custodianId";
ALTER TABLE "loans" RENAME COLUMN "departamentoId" TO "departmentId";
ALTER TABLE "loans" RENAME COLUMN "fecha" TO "date";
ALTER TABLE "loans" RENAME COLUMN "movimientoId" TO "movementId";
ALTER TABLE "loans" RENAME COLUMN "consecutivo" TO "number";
ALTER TABLE "loans" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "loan_items" RENAME COLUMN "prestamoId" TO "loanId";
ALTER TABLE "loan_items" RENAME COLUMN "dispositivoId" TO "deviceId";
ALTER TABLE "loan_items" RENAME COLUMN "cantidad" TO "quantity";
ALTER TABLE "loan_items" RENAME COLUMN "devuelto" TO "returnedQuantity";
ALTER TABLE "loan_items" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "loan_item_units" RENAME COLUMN "prestamoDetalleId" TO "loanItemId";
ALTER TABLE "loan_item_units" RENAME COLUMN "unidadFisicaId" TO "deviceUnitId";
ALTER TABLE "loan_item_units" RENAME COLUMN "devuelto" TO "returned";
ALTER TABLE "loan_returns" RENAME COLUMN "prestamoId" TO "loanId";
ALTER TABLE "loan_returns" RENAME COLUMN "movimientoId" TO "movementId";
ALTER TABLE "loan_returns" RENAME COLUMN "fecha" TO "date";
ALTER TABLE "loan_returns" RENAME COLUMN "responsableId" TO "custodianId";
ALTER TABLE "loan_returns" RENAME COLUMN "consecutivo" TO "number";
ALTER TABLE "loan_returns" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "loan_return_items" RENAME COLUMN "devolucionId" TO "loanReturnId";
ALTER TABLE "loan_return_items" RENAME COLUMN "prestamoDetalleId" TO "loanItemId";
ALTER TABLE "loan_return_items" RENAME COLUMN "dispositivoId" TO "deviceId";
ALTER TABLE "loan_return_items" RENAME COLUMN "cantidad" TO "quantity";
ALTER TABLE "loan_return_items" RENAME COLUMN "condicion" TO "condition";
ALTER TABLE "loan_return_items" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "loan_return_item_units" RENAME COLUMN "devolucionDetalleId" TO "loanReturnItemId";
ALTER TABLE "loan_return_item_units" RENAME COLUMN "unidadFisicaId" TO "deviceUnitId";
ALTER TABLE "material_outputs" RENAME COLUMN "fecha" TO "date";
ALTER TABLE "material_outputs" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "material_outputs" RENAME COLUMN "modelo" TO "model";
ALTER TABLE "material_outputs" RENAME COLUMN "marca" TO "brand";
ALTER TABLE "material_outputs" RENAME COLUMN "proyecto" TO "project";
ALTER TABLE "material_outputs" RENAME COLUMN "cantidad" TO "quantity";
ALTER TABLE "material_outputs" RENAME COLUMN "departamento" TO "departmentName";
ALTER TABLE "material_outputs" RENAME COLUMN "usuario" TO "userName";
ALTER TABLE "material_outputs" RENAME COLUMN "observaciones" TO "notes";
ALTER TABLE "material_outputs" RENAME COLUMN "motivo" TO "reason";
ALTER TABLE "material_outputs" RENAME COLUMN "unidadFisicaId" TO "deviceUnitId";
ALTER TABLE "material_outputs" RENAME COLUMN "registradoPorId" TO "registeredById";
ALTER TABLE "tickets" RENAME COLUMN "titulo" TO "title";
ALTER TABLE "tickets" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "tickets" RENAME COLUMN "creadoPorId" TO "createdById";
ALTER TABLE "tickets" RENAME COLUMN "asignadoAId" TO "assignedToId";
ALTER TABLE "tickets" RENAME COLUMN "creadoEn" TO "createdAt";
ALTER TABLE "tickets" RENAME COLUMN "actualizadoEn" TO "updatedAt";
ALTER TABLE "ticket_categories" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "ticket_categories" RENAME COLUMN "activo" TO "active";
ALTER TABLE "ticket_assignment_comments" RENAME COLUMN "autorId" TO "authorId";
ALTER TABLE "ticket_assignment_comments" RENAME COLUMN "texto" TO "text";
ALTER TABLE "ticket_comments" RENAME COLUMN "autorId" TO "authorId";
ALTER TABLE "ticket_comments" RENAME COLUMN "texto" TO "text";
ALTER TABLE "ticket_comments" RENAME COLUMN "creadoEn" TO "createdAt";
ALTER TABLE "ticket_history" RENAME COLUMN "autorId" TO "authorId";
ALTER TABLE "legacy_sequences" RENAME COLUMN "prefijo" TO "prefix";
ALTER TABLE "legacy_sequences" RENAME COLUMN "contador" TO "counter";
ALTER TABLE "legacy_sequences" RENAME COLUMN "actualizadoEn" TO "updatedAt";
ALTER TABLE "disciplinary_reports" RENAME COLUMN "motivo" TO "reason";
ALTER TABLE "disciplinary_reports" RENAME COLUMN "fechaIncidente" TO "incidentDate";
ALTER TABLE "disciplinary_reports" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "disciplinary_reports" RENAME COLUMN "sancion" TO "sanction";
ALTER TABLE "sys_config" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "schedules" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "schedules" RENAME COLUMN "activo" TO "active";
ALTER TABLE "schedules" RENAME COLUMN "toleranciaEntradaMin" TO "entryToleranceMin";
ALTER TABLE "schedules" RENAME COLUMN "toleranciaSalidaMin" TO "exitToleranceMin";
ALTER TABLE "schedules" RENAME COLUMN "comidaMin" TO "mealBreakMin";
ALTER TABLE "schedules" RENAME COLUMN "minimoExtraMin" TO "minOvertimeMin";
ALTER TABLE "schedules" RENAME COLUMN "cruzaMedianoche" TO "crossesMidnight";
ALTER TABLE "schedule_days" RENAME COLUMN "horarioId" TO "scheduleId";
ALTER TABLE "schedule_days" RENAME COLUMN "diaSemana" TO "weekday";
ALTER TABLE "schedule_days" RENAME COLUMN "entrada" TO "startTime";
ALTER TABLE "schedule_days" RENAME COLUMN "salida" TO "endTime";
ALTER TABLE "schedule_days" RENAME COLUMN "entrada2" TO "splitStartTime";
ALTER TABLE "schedule_days" RENAME COLUMN "salida2" TO "splitEndTime";
ALTER TABLE "schedule_days" RENAME COLUMN "descanso" TO "restDay";
ALTER TABLE "schedule_assignments" RENAME COLUMN "horarioId" TO "scheduleId";
ALTER TABLE "schedule_assignments" RENAME COLUMN "desde" TO "validFrom";
ALTER TABLE "schedule_assignments" RENAME COLUMN "hasta" TO "validTo";
ALTER TABLE "schedule_assignments" RENAME COLUMN "creadoPorId" TO "createdById";
ALTER TABLE "time_clock_punches" RENAME COLUMN "dispositivoSerie" TO "clockSerial";
ALTER TABLE "time_clock_punches" RENAME COLUMN "numeroEmpleado" TO "employeeNumber";
ALTER TABLE "time_clock_punches" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "time_clock_punches" RENAME COLUMN "metodo" TO "method";
ALTER TABLE "time_clocks" RENAME COLUMN "dispositivoSerie" TO "serialNumber";
ALTER TABLE "time_clocks" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "time_clocks" RENAME COLUMN "asistencia" TO "countsAttendance";
ALTER TABLE "time_clocks" RENAME COLUMN "modelo" TO "model";
ALTER TABLE "time_clocks" RENAME COLUMN "ultimoSerialNo" TO "lastSerialNo";
ALTER TABLE "time_clocks" RENAME COLUMN "sincronizadoEn" TO "syncedAt";
ALTER TABLE "time_clock_employees" RENAME COLUMN "numeroEmpleado" TO "employeeNumber";
ALTER TABLE "time_clock_employees" RENAME COLUMN "vinculadoPorId" TO "linkedById";
ALTER TABLE "overtime_approvals" RENAME COLUMN "horarioNombre" TO "scheduleName";
ALTER TABLE "overtime_approvals" RENAME COLUMN "programadasMin" TO "scheduledMin";
ALTER TABLE "permissions" RENAME COLUMN "clave" TO "key";
ALTER TABLE "permissions" RENAME COLUMN "modulo" TO "module";
ALTER TABLE "permissions" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "permissions" RENAME COLUMN "descripcion" TO "description";
ALTER TABLE "permissions" RENAME COLUMN "alcances" TO "scopes";
ALTER TABLE "permissions" RENAME COLUMN "sensible" TO "sensitive";
ALTER TABLE "permissions" RENAME COLUMN "activo" TO "active";
ALTER TABLE "permissions" RENAME COLUMN "orden" TO "sortOrder";
ALTER TABLE "role_permissions" RENAME COLUMN "rol" TO "role";
ALTER TABLE "role_permissions" RENAME COLUMN "permiso" TO "permission";
ALTER TABLE "role_permissions" RENAME COLUMN "alcance" TO "scope";

-- Índices y constraints (nombres derivados por Prisma de tabla/columna)
ALTER TABLE "blood_types" RENAME CONSTRAINT "tipos_sangre_pkey" TO "blood_types_pkey";
ALTER TABLE "device_types" RENAME CONSTRAINT "tipos_dispositivo_pkey" TO "device_types_pkey";
ALTER TABLE "device_units" RENAME CONSTRAINT "unidades_fisicas_pkey" TO "device_units_pkey";
ALTER TABLE "devices" RENAME CONSTRAINT "dispositivos_pkey" TO "devices_pkey";
ALTER TABLE "disciplinary_reports" RENAME CONSTRAINT "cartas_administrativas_pkey" TO "disciplinary_reports_pkey";
ALTER TABLE "document_types" RENAME CONSTRAINT "tipos_documento_pkey" TO "document_types_pkey";
ALTER TABLE "genders" RENAME CONSTRAINT "generos_pkey" TO "genders_pkey";
ALTER TABLE "legacy_sequences" RENAME CONSTRAINT "consecutivos_pkey" TO "legacy_sequences_pkey";
ALTER TABLE "loan_item_units" RENAME CONSTRAINT "prestamo_detalle_unidades_pkey" TO "loan_item_units_pkey";
ALTER TABLE "loan_items" RENAME CONSTRAINT "prestamo_detalles_pkey" TO "loan_items_pkey";
ALTER TABLE "loan_return_item_units" RENAME CONSTRAINT "devolucion_detalle_unidades_pkey" TO "loan_return_item_units_pkey";
ALTER TABLE "loan_return_items" RENAME CONSTRAINT "devolucion_detalles_pkey" TO "loan_return_items_pkey";
ALTER TABLE "loan_returns" RENAME CONSTRAINT "devoluciones_pkey" TO "loan_returns_pkey";
ALTER TABLE "loans" RENAME CONSTRAINT "prestamos_pkey" TO "loans_pkey";
ALTER TABLE "movement_item_units" RENAME CONSTRAINT "movimiento_detalle_unidades_pkey" TO "movement_item_units_pkey";
ALTER TABLE "movement_items" RENAME CONSTRAINT "movimiento_detalles_pkey" TO "movement_items_pkey";
ALTER TABLE "movements" RENAME CONSTRAINT "movimientos_pkey" TO "movements_pkey";
ALTER TABLE "permissions" RENAME CONSTRAINT "permisos_pkey" TO "permissions_pkey";
ALTER TABLE "role_permissions" RENAME CONSTRAINT "rol_permisos_pkey" TO "role_permissions_pkey";
ALTER TABLE "schedule_assignments" RENAME CONSTRAINT "horario_asignaciones_pkey" TO "schedule_assignments_pkey";
ALTER TABLE "schedule_days" RENAME CONSTRAINT "horario_dias_pkey" TO "schedule_days_pkey";
ALTER TABLE "schedules" RENAME CONSTRAINT "horarios_pkey" TO "schedules_pkey";
ALTER TABLE "time_clock_employees" RENAME CONSTRAINT "checador_empleados_pkey" TO "time_clock_employees_pkey";
ALTER TABLE "time_clock_punches" RENAME CONSTRAINT "checadas_pkey" TO "time_clock_punches_pkey";
ALTER TABLE "time_clocks" RENAME CONSTRAINT "checador_sync_pkey" TO "time_clocks_pkey";
ALTER TABLE "device_units" RENAME CONSTRAINT "unidades_fisicas_departamentoId_fkey" TO "device_units_departmentId_fkey";
ALTER TABLE "device_units" RENAME CONSTRAINT "unidades_fisicas_dispositivoId_fkey" TO "device_units_deviceId_fkey";
ALTER TABLE "devices" RENAME CONSTRAINT "dispositivos_tipoId_fkey" TO "devices_typeId_fkey";
ALTER TABLE "disciplinary_reports" RENAME CONSTRAINT "cartas_administrativas_createdById_fkey" TO "disciplinary_reports_createdById_fkey";
ALTER TABLE "disciplinary_reports" RENAME CONSTRAINT "cartas_administrativas_userId_fkey" TO "disciplinary_reports_userId_fkey";
ALTER TABLE "employee_documents" RENAME CONSTRAINT "employee_documents_tipoDocumentoId_fkey" TO "employee_documents_documentTypeId_fkey";
ALTER TABLE "loan_item_units" RENAME CONSTRAINT "prestamo_detalle_unidades_prestamoDetalleId_fkey" TO "loan_item_units_loanItemId_fkey";
ALTER TABLE "loan_item_units" RENAME CONSTRAINT "prestamo_detalle_unidades_unidadFisicaId_fkey" TO "loan_item_units_deviceUnitId_fkey";
ALTER TABLE "loan_items" RENAME CONSTRAINT "prestamo_detalles_dispositivoId_fkey" TO "loan_items_deviceId_fkey";
ALTER TABLE "loan_items" RENAME CONSTRAINT "prestamo_detalles_prestamoId_fkey" TO "loan_items_loanId_fkey";
ALTER TABLE "loan_return_item_units" RENAME CONSTRAINT "devolucion_detalle_unidades_devolucionDetalleId_fkey" TO "loan_return_item_units_loanReturnItemId_fkey";
ALTER TABLE "loan_return_item_units" RENAME CONSTRAINT "devolucion_detalle_unidades_unidadFisicaId_fkey" TO "loan_return_item_units_deviceUnitId_fkey";
ALTER TABLE "loan_return_items" RENAME CONSTRAINT "devolucion_detalles_devolucionId_fkey" TO "loan_return_items_loanReturnId_fkey";
ALTER TABLE "loan_return_items" RENAME CONSTRAINT "devolucion_detalles_dispositivoId_fkey" TO "loan_return_items_deviceId_fkey";
ALTER TABLE "loan_return_items" RENAME CONSTRAINT "devolucion_detalles_prestamoDetalleId_fkey" TO "loan_return_items_loanItemId_fkey";
ALTER TABLE "loan_returns" RENAME CONSTRAINT "devoluciones_movimientoId_fkey" TO "loan_returns_movementId_fkey";
ALTER TABLE "loan_returns" RENAME CONSTRAINT "devoluciones_prestamoId_fkey" TO "loan_returns_loanId_fkey";
ALTER TABLE "loan_returns" RENAME CONSTRAINT "devoluciones_responsableId_fkey" TO "loan_returns_custodianId_fkey";
ALTER TABLE "loans" RENAME CONSTRAINT "prestamos_departamentoId_fkey" TO "loans_departmentId_fkey";
ALTER TABLE "loans" RENAME CONSTRAINT "prestamos_movimientoId_fkey" TO "loans_movementId_fkey";
ALTER TABLE "loans" RENAME CONSTRAINT "prestamos_responsableId_fkey" TO "loans_custodianId_fkey";
ALTER TABLE "loans" RENAME CONSTRAINT "prestamos_subareaId_fkey" TO "loans_subareaId_fkey";
ALTER TABLE "material_outputs" RENAME CONSTRAINT "material_outputs_registradoPorId_fkey" TO "material_outputs_registeredById_fkey";
ALTER TABLE "material_outputs" RENAME CONSTRAINT "material_outputs_unidadFisicaId_fkey" TO "material_outputs_deviceUnitId_fkey";
ALTER TABLE "movement_item_units" RENAME CONSTRAINT "movimiento_detalle_unidades_movimientoDetalleId_fkey" TO "movement_item_units_movementItemId_fkey";
ALTER TABLE "movement_item_units" RENAME CONSTRAINT "movimiento_detalle_unidades_unidadFisicaId_fkey" TO "movement_item_units_deviceUnitId_fkey";
ALTER TABLE "movement_items" RENAME CONSTRAINT "movimiento_detalles_dispositivoId_fkey" TO "movement_items_deviceId_fkey";
ALTER TABLE "movement_items" RENAME CONSTRAINT "movimiento_detalles_movimientoId_fkey" TO "movement_items_movementId_fkey";
ALTER TABLE "movements" RENAME CONSTRAINT "movimientos_departamentoId_fkey" TO "movements_departmentId_fkey";
ALTER TABLE "movements" RENAME CONSTRAINT "movimientos_responsableId_fkey" TO "movements_custodianId_fkey";
ALTER TABLE "movements" RENAME CONSTRAINT "movimientos_reversaDeId_fkey" TO "movements_reversalOfId_fkey";
ALTER TABLE "movements" RENAME CONSTRAINT "movimientos_usuarioId_fkey" TO "movements_createdById_fkey";
ALTER TABLE "role_permissions" RENAME CONSTRAINT "rol_permisos_permiso_fkey" TO "role_permissions_permission_fkey";
ALTER TABLE "schedule_assignments" RENAME CONSTRAINT "horario_asignaciones_creadoPorId_fkey" TO "schedule_assignments_createdById_fkey";
ALTER TABLE "schedule_assignments" RENAME CONSTRAINT "horario_asignaciones_horarioId_fkey" TO "schedule_assignments_scheduleId_fkey";
ALTER TABLE "schedule_assignments" RENAME CONSTRAINT "horario_asignaciones_userId_fkey" TO "schedule_assignments_userId_fkey";
ALTER TABLE "schedule_days" RENAME CONSTRAINT "horario_dias_horarioId_fkey" TO "schedule_days_scheduleId_fkey";
ALTER TABLE "ticket_assignment_comments" RENAME CONSTRAINT "ticket_assignment_comments_autorId_fkey" TO "ticket_assignment_comments_authorId_fkey";
ALTER TABLE "ticket_comments" RENAME CONSTRAINT "ticket_comments_autorId_fkey" TO "ticket_comments_authorId_fkey";
ALTER TABLE "ticket_history" RENAME CONSTRAINT "ticket_history_autorId_fkey" TO "ticket_history_authorId_fkey";
ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_asignadoAId_fkey" TO "tickets_assignedToId_fkey";
ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_creadoPorId_fkey" TO "tickets_createdById_fkey";
ALTER TABLE "time_clock_employees" RENAME CONSTRAINT "checador_empleados_userId_fkey" TO "time_clock_employees_userId_fkey";
ALTER TABLE "time_clock_employees" RENAME CONSTRAINT "checador_empleados_vinculadoPorId_fkey" TO "time_clock_employees_linkedById_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_generoId_fkey" TO "users_genderId_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_tipoSangreId_fkey" TO "users_bloodTypeId_fkey";
ALTER INDEX "tipos_sangre_nombre_key" RENAME TO "blood_types_name_key";
ALTER INDEX "tipos_dispositivo_code_key" RENAME TO "device_types_code_key";
ALTER INDEX "tipos_dispositivo_folioPrefix_key" RENAME TO "device_types_assetTagPrefix_key";
ALTER INDEX "unidades_fisicas_activoFijo_key" RENAME TO "device_units_assetTag_key";
ALTER INDEX "unidades_fisicas_departamentoId_idx" RENAME TO "device_units_departmentId_idx";
ALTER INDEX "unidades_fisicas_dispositivoId_idx" RENAME TO "device_units_deviceId_idx";
ALTER INDEX "unidades_fisicas_estado_idx" RENAME TO "device_units_status_idx";
ALTER INDEX "unidades_fisicas_macAddress_key" RENAME TO "device_units_macAddress_key";
ALTER INDEX "dispositivos_tipoId_idx" RENAME TO "devices_typeId_idx";
ALTER INDEX "dispositivos_tipoId_nombre_marca_modelo_key" RENAME TO "devices_typeId_name_brand_model_key";
ALTER INDEX "cartas_administrativas_createdAt_idx" RENAME TO "disciplinary_reports_createdAt_idx";
ALTER INDEX "cartas_administrativas_userId_idx" RENAME TO "disciplinary_reports_userId_idx";
ALTER INDEX "tipos_documento_nombre_key" RENAME TO "document_types_name_key";
ALTER INDEX "employee_discounts_userId_tipo_key" RENAME TO "employee_discounts_userId_type_key";
ALTER INDEX "employee_documents_tipoDocumentoId_idx" RENAME TO "employee_documents_documentTypeId_idx";
ALTER INDEX "generos_nombre_key" RENAME TO "genders_name_key";
ALTER INDEX "prestamo_detalle_unidades_prestamoDetalleId_unidadFisicaId_key" RENAME TO "loan_item_units_loanItemId_deviceUnitId_key";
ALTER INDEX "prestamo_detalle_unidades_unidadFisicaId_idx" RENAME TO "loan_item_units_deviceUnitId_idx";
ALTER INDEX "prestamo_detalles_dispositivoId_idx" RENAME TO "loan_items_deviceId_idx";
ALTER INDEX "prestamo_detalles_prestamoId_idx" RENAME TO "loan_items_loanId_idx";
ALTER INDEX "devolucion_detalle_unidades_devolucionDetalleId_unidadFisic_key" RENAME TO "loan_return_item_units_loanReturnItemId_deviceUnitId_key";
ALTER INDEX "devolucion_detalle_unidades_unidadFisicaId_idx" RENAME TO "loan_return_item_units_deviceUnitId_idx";
ALTER INDEX "devolucion_detalles_devolucionId_idx" RENAME TO "loan_return_items_loanReturnId_idx";
ALTER INDEX "devolucion_detalles_prestamoDetalleId_idx" RENAME TO "loan_return_items_loanItemId_idx";
ALTER INDEX "devoluciones_consecutivo_key" RENAME TO "loan_returns_number_key";
ALTER INDEX "devoluciones_movimientoId_key" RENAME TO "loan_returns_movementId_key";
ALTER INDEX "devoluciones_prestamoId_idx" RENAME TO "loan_returns_loanId_idx";
ALTER INDEX "prestamos_consecutivo_key" RENAME TO "loans_number_key";
ALTER INDEX "prestamos_movimientoId_key" RENAME TO "loans_movementId_key";
ALTER INDEX "prestamos_responsableId_idx" RENAME TO "loans_custodianId_idx";
ALTER INDEX "prestamos_status_idx" RENAME TO "loans_status_idx";
ALTER INDEX "material_outputs_departamento_idx" RENAME TO "material_outputs_departmentName_idx";
ALTER INDEX "material_outputs_fecha_idx" RENAME TO "material_outputs_date_idx";
ALTER INDEX "material_outputs_unidadFisicaId_idx" RENAME TO "material_outputs_deviceUnitId_idx";
ALTER INDEX "movimiento_detalle_unidades_movimientoDetalleId_unidadFisic_key" RENAME TO "movement_item_units_movementItemId_deviceUnitId_key";
ALTER INDEX "movimiento_detalle_unidades_unidadFisicaId_idx" RENAME TO "movement_item_units_deviceUnitId_idx";
ALTER INDEX "movimiento_detalles_dispositivoId_idx" RENAME TO "movement_items_deviceId_idx";
ALTER INDEX "movimiento_detalles_movimientoId_idx" RENAME TO "movement_items_movementId_idx";
ALTER INDEX "movimientos_fecha_idx" RENAME TO "movements_date_idx";
ALTER INDEX "movimientos_reversaDeId_key" RENAME TO "movements_reversalOfId_key";
ALTER INDEX "movimientos_status_idx" RENAME TO "movements_status_idx";
ALTER INDEX "movimientos_tipo_idx" RENAME TO "movements_type_idx";
ALTER INDEX "permisos_modulo_orden_idx" RENAME TO "permissions_module_sortOrder_idx";
ALTER INDEX "rol_permisos_rol_permiso_key" RENAME TO "role_permissions_role_permission_key";
ALTER INDEX "horario_asignaciones_horarioId_idx" RENAME TO "schedule_assignments_scheduleId_idx";
ALTER INDEX "horario_asignaciones_userId_desde_hasta_idx" RENAME TO "schedule_assignments_userId_validFrom_validTo_idx";
ALTER INDEX "horario_dias_horarioId_diaSemana_key" RENAME TO "schedule_days_scheduleId_weekday_key";
ALTER INDEX "horarios_nombre_key" RENAME TO "schedules_name_key";
ALTER INDEX "ticket_categories_nombre_key" RENAME TO "ticket_categories_name_key";
ALTER INDEX "tickets_asignadoAId_idx" RENAME TO "tickets_assignedToId_idx";
ALTER INDEX "tickets_creadoPorId_idx" RENAME TO "tickets_createdById_idx";
ALTER INDEX "checador_empleados_userId_idx" RENAME TO "time_clock_employees_userId_idx";
ALTER INDEX "checadas_dispositivoSerie_serialNo_key" RENAME TO "time_clock_punches_clockSerial_serialNo_key";
ALTER INDEX "checadas_numeroEmpleado_occurredAt_idx" RENAME TO "time_clock_punches_employeeNumber_occurredAt_idx";
ALTER INDEX "checadas_occurredAt_idx" RENAME TO "time_clock_punches_occurredAt_idx";
ALTER INDEX "checador_sync_url_key" RENAME TO "time_clocks_url_key";
ALTER INDEX "users_numeroEmpleado_key" RENAME TO "users_employeeNumber_key";


-- Códigos persistidos que el código compara
-- role_permissions.permission se actualiza por la FK ON UPDATE CASCADE
UPDATE "permissions" SET "key" = CASE "key"
  WHEN 'tickets.ver' THEN 'tickets.view'
  WHEN 'tickets.crear' THEN 'tickets.create'
  WHEN 'tickets.editar' THEN 'tickets.edit'
  WHEN 'tickets.cerrar' THEN 'tickets.close'
  WHEN 'tickets.eliminar' THEN 'tickets.delete'
  WHEN 'tareas.ver' THEN 'tasks.view'
  WHEN 'tareas.asignar' THEN 'tasks.assign'
  WHEN 'tareas.completar' THEN 'tasks.complete'
  WHEN 'dispositivos.ver' THEN 'devices.view'
  WHEN 'dispositivos.crear' THEN 'devices.create'
  WHEN 'dispositivos.editar' THEN 'devices.edit'
  WHEN 'dispositivos.eliminar' THEN 'devices.delete'
  WHEN 'prestamos.ver' THEN 'loans.view'
  WHEN 'prestamos.crear' THEN 'loans.create'
  WHEN 'prestamos.editar' THEN 'loans.edit'
  WHEN 'prestamos.eliminar' THEN 'loans.delete'
  WHEN 'salidas.registrar' THEN 'material_outputs.register'
  WHEN 'reportes.ver' THEN 'reports.view'
  WHEN 'reportes.exportar' THEN 'reports.export'
  WHEN 'personal.expediente' THEN 'hr.records'
  WHEN 'personal.actas' THEN 'hr.disciplinary_reports'
  WHEN 'usuarios.ver' THEN 'users.view'
  WHEN 'usuarios.crear' THEN 'users.create'
  WHEN 'usuarios.editar' THEN 'users.edit'
  WHEN 'usuarios.eliminar' THEN 'users.delete'
  WHEN 'usuarios.permisos' THEN 'users.permissions'
  WHEN 'departamentos.administrar' THEN 'departments.manage'
  WHEN 'catalogos.administrar' THEN 'catalogs.manage'
  WHEN 'acceso.escanear' THEN 'access.scan'
  WHEN 'acceso.bitacora' THEN 'access.log'
  WHEN 'acceso.anular' THEN 'access.void'
  WHEN 'acceso.sitios' THEN 'access.sites'
  WHEN 'checador.ver' THEN 'time_clock.view'
  WHEN 'checador.sincronizar' THEN 'time_clock.sync'
  WHEN 'checador.vincular' THEN 'time_clock.link'
  WHEN 'relojes.administrar' THEN 'time_clocks.manage'
  WHEN 'horarios.ver' THEN 'schedules.view'
  WHEN 'horarios.administrar' THEN 'schedules.manage'
  WHEN 'horas_extra.ver' THEN 'overtime.view'
  WHEN 'horas_extra.aprobar' THEN 'overtime.approve'
  WHEN 'panel.ver' THEN 'dashboard.view'
  WHEN 'auditoria.ver' THEN 'audit.view'
  WHEN 'sistema.configurar' THEN 'system.configure'
  WHEN 'roles.administrar' THEN 'roles.manage'
  ELSE "key" END
WHERE "key" IN ('tickets.ver', 'tickets.crear', 'tickets.editar', 'tickets.cerrar', 'tickets.eliminar', 'tareas.ver', 'tareas.asignar', 'tareas.completar', 'dispositivos.ver', 'dispositivos.crear', 'dispositivos.editar', 'dispositivos.eliminar', 'prestamos.ver', 'prestamos.crear', 'prestamos.editar', 'prestamos.eliminar', 'salidas.registrar', 'reportes.ver', 'reportes.exportar', 'personal.expediente', 'personal.actas', 'usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'usuarios.eliminar', 'usuarios.permisos', 'departamentos.administrar', 'catalogos.administrar', 'acceso.escanear', 'acceso.bitacora', 'acceso.anular', 'acceso.sitios', 'checador.ver', 'checador.sincronizar', 'checador.vincular', 'relojes.administrar', 'horarios.ver', 'horarios.administrar', 'horas_extra.ver', 'horas_extra.aprobar', 'panel.ver', 'auditoria.ver', 'sistema.configurar', 'roles.administrar');
UPDATE "audit_logs" SET "action" = CASE "action"
  WHEN 'MOV_ENTRADA' THEN 'MOVEMENT_STOCK_IN'
  WHEN 'MOV_PRESTAMO' THEN 'MOVEMENT_LOAN'
  WHEN 'MOV_DEVOLUCION' THEN 'MOVEMENT_RETURN'
  WHEN 'MOV_BAJA' THEN 'MOVEMENT_RETIREMENT'
  WHEN 'MOV_TRASPASO' THEN 'MOVEMENT_TRANSFER'
  WHEN 'MOV_AJUSTE_ENTRADA' THEN 'MOVEMENT_ADJUSTMENT_IN'
  WHEN 'MOV_AJUSTE_SALIDA' THEN 'MOVEMENT_ADJUSTMENT_OUT'
  WHEN 'MOV_MANT_ENTRADA' THEN 'MOVEMENT_MAINTENANCE_IN'
  WHEN 'MOV_MANT_SALIDA' THEN 'MOVEMENT_MAINTENANCE_OUT'
  WHEN 'MOV_REVERSION' THEN 'MOVEMENT_REVERSAL'
  WHEN 'MOV_MANTENIMIENTO_ENTRADA' THEN 'MOVEMENT_MAINTENANCE_IN'
  WHEN 'MOV_MANTENIMIENTO_SALIDA' THEN 'MOVEMENT_MAINTENANCE_OUT'
  WHEN 'HORARIO_ASIGNACION' THEN 'SCHEDULE_ASSIGNED'
  WHEN 'HORARIO_ASIGNACION_QUITAR' THEN 'SCHEDULE_UNASSIGNED'
  WHEN 'CHECADOR_VINCULAR' THEN 'TIME_CLOCK_LINKED'
  WHEN 'CHECADOR_DESVINCULAR' THEN 'TIME_CLOCK_UNLINKED'
  WHEN 'CHECADOR_RELOJ_ALTA' THEN 'TIME_CLOCK_REGISTERED'
  WHEN 'CHECADOR_RELOJ_BAJA' THEN 'TIME_CLOCK_RETIRED'
  WHEN 'CHECADOR_RELOJ_EDITAR' THEN 'TIME_CLOCK_UPDATED'
  WHEN 'PERMISO_CATALOGO_CREADO' THEN 'PERMISSION_CREATED'
  WHEN 'PERMISO_CATALOGO_ACTUALIZADO' THEN 'PERMISSION_UPDATED'
  WHEN 'PERMISO_MATRIZ_ACTUALIZADA' THEN 'ROLE_PERMISSIONS_UPDATED'
  WHEN 'employee.alta' THEN 'employee.registered'
  WHEN 'DEVICE_LOTE_EXPANDED' THEN 'DEVICE_BATCH_EXPANDED'
  WHEN 'MOVEMENT_SALIDA' THEN 'MOVEMENT_STOCK_OUT'
  ELSE "action" END
WHERE "action" IN ('MOV_ENTRADA', 'MOV_PRESTAMO', 'MOV_DEVOLUCION', 'MOV_BAJA', 'MOV_TRASPASO', 'MOV_AJUSTE_ENTRADA', 'MOV_AJUSTE_SALIDA', 'MOV_MANT_ENTRADA', 'MOV_MANT_SALIDA', 'MOV_REVERSION', 'MOV_MANTENIMIENTO_ENTRADA', 'MOV_MANTENIMIENTO_SALIDA', 'HORARIO_ASIGNACION', 'HORARIO_ASIGNACION_QUITAR', 'CHECADOR_VINCULAR', 'CHECADOR_DESVINCULAR', 'CHECADOR_RELOJ_ALTA', 'CHECADOR_RELOJ_BAJA', 'CHECADOR_RELOJ_EDITAR', 'PERMISO_CATALOGO_CREADO', 'PERMISO_CATALOGO_ACTUALIZADO', 'PERMISO_MATRIZ_ACTUALIZADA', 'employee.alta', 'DEVICE_LOTE_EXPANDED', 'MOVEMENT_SALIDA');
UPDATE "audit_logs" SET "entityType" = CASE "entityType"
  WHEN 'Movimiento' THEN 'Movement'
  WHEN 'UnidadFisica' THEN 'DeviceUnit'
  WHEN 'ChecadorEmpleado' THEN 'TimeClockEmployee'
  WHEN 'ChecadorReloj' THEN 'TimeClock'
  WHEN 'Horario' THEN 'Schedule'
  WHEN 'Permiso' THEN 'Permission'
  WHEN 'RolPermiso' THEN 'RolePermission'
  ELSE "entityType" END
WHERE "entityType" IN ('Movimiento', 'UnidadFisica', 'ChecadorEmpleado', 'ChecadorReloj', 'Horario', 'Permiso', 'RolPermiso');
UPDATE "email_logs" SET "action" = CASE "action"
  WHEN 'employee.alta' THEN 'employee.registered'
  ELSE "action" END
WHERE "action" IN ('employee.alta');
UPDATE "ticket_attachments" SET "kind" = CASE "kind"
  WHEN 'FOTO' THEN 'PHOTO'
  ELSE "kind" END
WHERE "kind" IN ('FOTO');

ALTER TABLE "ticket_attachments" ALTER COLUMN "kind" SET DEFAULT 'PHOTO';

-- Idioma del sistema para mensajes de la API, correos y notificaciones.
INSERT INTO "sys_config" ("id", "key", "value", "description", "updatedAt")
VALUES ('sys_config_language', 'LANGUAGE', 'es', 'System language for API messages, emails and notifications (es | en)', now())
ON CONFLICT ("key") DO NOTHING;
