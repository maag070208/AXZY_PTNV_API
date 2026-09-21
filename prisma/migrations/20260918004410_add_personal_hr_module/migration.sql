-- CreateEnum
CREATE TYPE "TipoDescuento" AS ENUM ('INFONAVIT', 'IMSS', 'DEUDOR_ALIMENTICIO');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RECURSOS_HUMANOS';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "alergias" TEXT,
ADD COLUMN     "apellidoMaterno" TEXT,
ADD COLUMN     "apellidoPaterno" TEXT,
ADD COLUMN     "calleNumero" TEXT,
ADD COLUMN     "celularEmpresa" TEXT,
ADD COLUMN     "celularPersonal" TEXT,
ADD COLUMN     "ciudad" TEXT,
ADD COLUMN     "codigoPostal" TEXT,
ADD COLUMN     "colonia" TEXT,
ADD COLUMN     "contactoEmergenciaNombre" TEXT,
ADD COLUMN     "contactoEmergenciaParentesco" TEXT,
ADD COLUMN     "contactoEmergenciaTelefono" TEXT,
ADD COLUMN     "curp" TEXT,
ADD COLUMN     "estadoDireccion" TEXT,
ADD COLUMN     "fechaIngreso" DATE,
ADD COLUMN     "fechaNacimiento" DATE,
ADD COLUMN     "fotoKey" TEXT,
ADD COLUMN     "generoId" TEXT,
ADD COLUMN     "nss" TEXT,
ADD COLUMN     "padecimiento" TEXT,
ADD COLUMN     "pais" TEXT DEFAULT 'México',
ADD COLUMN     "rfc" TEXT,
ADD COLUMN     "segundoNombre" TEXT,
ADD COLUMN     "tipoSangreId" TEXT;

-- CreateTable
CREATE TABLE "generos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_sangre" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_sangre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_documento" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_discounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoDescuento" NOT NULL,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipoDocumentoId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generos_nombre_key" ON "generos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_sangre_nombre_key" ON "tipos_sangre"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_documento_nombre_key" ON "tipos_documento"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "employee_discounts_userId_tipo_key" ON "employee_discounts"("userId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storageKey_key" ON "employee_documents"("storageKey");

-- CreateIndex
CREATE INDEX "employee_documents_userId_idx" ON "employee_documents"("userId");

-- CreateIndex
CREATE INDEX "employee_documents_tipoDocumentoId_idx" ON "employee_documents"("tipoDocumentoId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_generoId_fkey" FOREIGN KEY ("generoId") REFERENCES "generos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tipoSangreId_fkey" FOREIGN KEY ("tipoSangreId") REFERENCES "tipos_sangre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_discounts" ADD CONSTRAINT "employee_discounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "tipos_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

