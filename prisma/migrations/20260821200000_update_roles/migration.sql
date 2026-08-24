-- Add new role values (must be committed separately from UPDATE)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GERENTE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'JEFE_DE_AREA';
