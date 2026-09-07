-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'EN_REVISION';

-- DropIndex
DROP INDEX "ticket_assignment_comments_autorId_idx";

-- AlterTable
ALTER TABLE "ticket_assignments" ALTER COLUMN "title" DROP DEFAULT;
