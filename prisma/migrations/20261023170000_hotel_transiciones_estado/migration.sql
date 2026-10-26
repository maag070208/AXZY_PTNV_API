-- Matriz de transiciones de estado como catálogo editable (no en el código).
CREATE TABLE "hotel_room_status_transitions" (
    "id" TEXT NOT NULL,
    "from" "HotelRoomStatus" NOT NULL,
    "to" "HotelRoomStatus" NOT NULL,
    "requiresReason" BOOLEAN NOT NULL DEFAULT false,
    "requiresActiveKit" BOOLEAN NOT NULL DEFAULT false,
    "permission" TEXT NOT NULL DEFAULT 'hotel_rooms.status',
    "systemOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "hotel_room_status_transitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hotel_room_status_transitions_from_to_key" ON "hotel_room_status_transitions"("from", "to");

INSERT INTO "hotel_room_status_transitions" ("id", "from", "to", "requiresReason", "requiresActiveKit", "permission", "systemOnly") VALUES
(gen_random_uuid()::text, 'DISPONIBLE', 'OCUPADA', false, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'DISPONIBLE', 'LIMPIEZA', false, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'OCUPADA', 'LIMPIEZA', false, true, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'INSPECCION', 'DISPONIBLE', false, false, 'housekeeping.inspect', false),
(gen_random_uuid()::text, 'INSPECCION', 'LIMPIEZA', false, false, 'housekeeping.inspect', false),
(gen_random_uuid()::text, 'LIMPIEZA', 'INSPECCION', false, false, 'hotel_rooms.status', true),
(gen_random_uuid()::text, 'LIMPIEZA', 'DISPONIBLE', false, false, 'hotel_rooms.status', true),
(gen_random_uuid()::text, 'DISPONIBLE', 'MANTENIMIENTO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'OCUPADA', 'MANTENIMIENTO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'LIMPIEZA', 'MANTENIMIENTO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'INSPECCION', 'MANTENIMIENTO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'DISPONIBLE', 'FUERA_SERVICIO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'OCUPADA', 'FUERA_SERVICIO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'LIMPIEZA', 'FUERA_SERVICIO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'INSPECCION', 'FUERA_SERVICIO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'MANTENIMIENTO', 'LIMPIEZA', false, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'FUERA_SERVICIO', 'LIMPIEZA', false, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'MANTENIMIENTO', 'FUERA_SERVICIO', true, false, 'hotel_rooms.status', false),
(gen_random_uuid()::text, 'FUERA_SERVICIO', 'MANTENIMIENTO', true, false, 'hotel_rooms.status', false)
ON CONFLICT ("from", "to") DO NOTHING;

-- Motivos iniciales para los cambios de estado (catálogo hotel_reasons).
INSERT INTO "hotel_reasons" ("id", "kind", "name", "requiresNotes", "active") VALUES
(gen_random_uuid()::text, 'ESTADO_HABITACION', 'Fuga', false, true),
(gen_random_uuid()::text, 'ESTADO_HABITACION', 'Avería', false, true),
(gen_random_uuid()::text, 'ESTADO_HABITACION', 'Limpieza profunda', false, true),
(gen_random_uuid()::text, 'ESTADO_HABITACION', 'Otro', true, true)
ON CONFLICT ("kind", "name") DO NOTHING;
