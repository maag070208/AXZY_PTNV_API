-- CreateTable
CREATE TABLE "payroll_week_closures" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "snapshot" JSONB,

    CONSTRAINT "payroll_week_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_department_reviews" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "departmentId" TEXT,
    "bulk" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_department_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_week_closures_weekStart_key" ON "payroll_week_closures"("weekStart");

-- CreateIndex
CREATE INDEX "payroll_department_reviews_weekStart_idx" ON "payroll_department_reviews"("weekStart");

-- Una revisión por departamento y semana. El grupo sin departamento
-- (departmentId NULL) usa la clave '' vía COALESCE: un UNIQUE normal
-- trataría los NULL como distintos entre sí y permitiría duplicados.
CREATE UNIQUE INDEX "payroll_department_reviews_week_dept_key" ON "payroll_department_reviews"("weekStart", COALESCE("departmentId", ''));

-- AddForeignKey
ALTER TABLE "payroll_week_closures" ADD CONSTRAINT "payroll_week_closures_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_week_closures" ADD CONSTRAINT "payroll_week_closures_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_department_reviews" ADD CONSTRAINT "payroll_department_reviews_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_department_reviews" ADD CONSTRAINT "payroll_department_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
