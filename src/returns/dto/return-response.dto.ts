import { ReturnItem } from '../entities/return-item.entity';
import { ReturnRecord } from '../entities/return-record.entity';

/** Representasi return + hasil inspeksi per barang. */
export class ReturnResponseDto {
  id: string;
  requestId: string;
  returnedBy: string;
  returnedAt: Date;
  notes: string | null;
  items: Array<{
    id: string;
    handoverItemId: string;
    returnCondition: string;
    notes: string | null;
    itemType: {
      id: string;
      name: string;
      unitName: string;
    } | null;
    inventoryUnit: {
      id: string;
      inventoryCode: string;
      barcode: string;
    } | null;
  }>;

  static from(record: ReturnRecord): ReturnResponseDto {
    return {
      id: record.id,
      requestId: record.requestId,
      returnedBy: record.returnedBy,
      returnedAt: record.returnedAt,
      notes: record.notes,
      items: (record.items ?? []).map((item: ReturnItem) => ({
        id: item.id,
        handoverItemId: item.handoverItemId,
        returnCondition: item.returnCondition,
        notes: item.notes,
        itemType: item.handoverItem?.requestItem?.itemType
          ? {
              id: item.handoverItem.requestItem.itemType.id,
              name: item.handoverItem.requestItem.itemType.name,
              unitName: item.handoverItem.requestItem.itemType.unitName,
            }
          : null,
        inventoryUnit: item.handoverItem?.inventoryUnit
          ? {
              id: item.handoverItem.inventoryUnit.id,
              inventoryCode: item.handoverItem.inventoryUnit.inventoryCode,
              barcode: item.handoverItem.inventoryUnit.barcode,
            }
          : null,
      })),
    };
  }
}
