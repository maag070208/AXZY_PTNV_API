-- Complemento de 20260927120000_english_names: el tipo de adjunto de las
-- evidencias de tareas también pasa a inglés (EVIDENCIA → EVIDENCE).
UPDATE "ticket_attachments" SET "kind" = 'EVIDENCE' WHERE "kind" = 'EVIDENCIA';
