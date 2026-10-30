-- Ajustes a la matriz de transiciones de habitación (decisiones P1 y M1).
-- P1: el check-out sin kit ya no bloquea; la tarea nace con alerta (M5).
UPDATE "hotel_room_status_transitions"
SET "requiresActiveKit" = false
WHERE "from" = 'OCUPADA' AND "to" = 'LIMPIEZA';

-- M1: MANTENIMIENTO y FUERA_SERVICIO solo salen a LIMPIEZA (única salida).
UPDATE "hotel_room_status_transitions"
SET "active" = false
WHERE ("from" = 'MANTENIMIENTO' AND "to" = 'FUERA_SERVICIO')
   OR ("from" = 'FUERA_SERVICIO' AND "to" = 'MANTENIMIENTO');
