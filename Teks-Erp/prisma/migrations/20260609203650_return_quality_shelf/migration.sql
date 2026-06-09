-- AlterTable
ALTER TABLE "quality_grades" ADD COLUMN     "returnTargetStatus" "RollStatus";

-- AlterTable
ALTER TABLE "roll_returns" ADD COLUMN     "appliedStatus" "RollStatus";
