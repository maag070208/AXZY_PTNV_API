const personaRef = {
  id: true,
  name: true,
  puesto: true,
  numeroEmpleado: true,
  department: { select: { id: true, name: true } },
} as const;

const usuarioRef = {
  id: true,
  username: true,
  name: true,
} as const;

// Include completo de carta usado en ~8 puntos (create/update/return/etc).
export const includeCartaFull = {
  items: { include: { device: { include: { type: true } } } },
  creadoPor: { select: usuarioRef },
  responsable: { select: personaRef },
  encargado: { select: personaRef },
  ubicacion: true,
} as const;

// Include ligero para validaciones de acceso (update/return/undoReturn).
export const includeCartaLight = {
  items: true,
  responsable: { select: { department: { select: { id: true } } } },
} as const;