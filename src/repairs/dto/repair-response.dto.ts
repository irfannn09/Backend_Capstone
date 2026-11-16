import { RepairRecord } from '../entities/repair-record.entity';

/** Representasi repair record beserta kondisi unit fisik saat ini. */
export class RepairResponseDto {
  id: string;
  inventoryUnitId: string;
  problemDescription: string;
  repairStatus: string;
  startedAt: Date;
  completedAt: Date | null;
  repairNotes: string | null;
  handledBy: string;
  createdAt: Date;
  updatedAt: Date;
  inventoryUnit: {
    id: string;
    inventoryCode: string;
    barcode: string;
    currentCondition: string;
    availabilityStatus: string;
  } | null;

  static from(record: RepairRecord): RepairResponseDto {
    return {
      id: record.id,
      inventoryUnitId: record.inventoryUnitId,
      problemDescription: record.problemDescription,
      repairStatus: record.repairStatus,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      repairNotes: record.repairNotes,
      handledBy: record.handledBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      inventoryUnit: record.inventoryUnit
        ? {
            id: record.inventoryUnit.id,
            inventoryCode: record.inventoryUnit.inventoryCode,
            barcode: record.inventoryUnit.barcode,
            currentCondition: record.inventoryUnit.currentCondition,
            availabilityStatus: record.inventoryUnit.availabilityStatus,
          }
        : null,
    };
  }
}
