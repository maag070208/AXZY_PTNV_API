-- Contraseña provisional: al entrar, la web obliga a cambiarla antes de usar el sistema.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
