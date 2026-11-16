import { HandoverItem } from '../entities/handover-item.entity';
import { HandoverRecord } from '../entities/handover-record.entity';

/** Representasi handover + item yang diserahkan. */
export class HandoverResponseDto {
  id: string;
  requestId: string;
  handedOverBy: string;
  handedOverAt: Date;
  notes: string | null;
  items: Array<{
    id: string;
    requestItemId: string;
    inventoryUnitId: string | null;
    quantityHandedOver: number;
    itemType: {
      id: string;
      name: string;
      itemClass: string;
      unitName: string;
    } | null;
    inventoryUnit: {
      id: string;
      inventoryCode: string;
      barcode: string;
    } | null;
  }>;

  static from(record: HandoverRecord): HandoverResponseDto {
    return {
      id: record.id,
      requestId: record.requestId,
      handedOverBy: record.handedOverBy,
      handedOverAt: record.handedOverAt,
      notes: record.notes,
      items: (record.items ?? []).map((item: HandoverItem) => ({
        id: item.id,
        requestItemId: item.requestItemId,
        inventoryUnitId: item.inventoryUnitId,
        quantityHandedOver: item.quantityHandedOver,
        itemType: item.requestItem?.itemType
          ? {
              id: item.requestItem.itemType.id,
              name: item.requestItem.itemType.name,
              itemClass: item.requestItem.itemType.itemClass,
              unitName: item.requestItem.itemType.unitName,
            }
          : null,
        inventoryUnit: item.inventoryUnit
          ? {
              id: item.inventoryUnit.id,
              inventoryCode: item.inventoryUnit.inventoryCode,
              barcode: item.inventoryUnit.barcode,
            }
          : null,
      })),
    };
  }
}
