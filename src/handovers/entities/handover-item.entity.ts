import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { HandoverRecord } from './handover-record.entity';
import { BorrowRequestItem } from '../../borrowings/entities/borrow-request-item.entity';
import { InventoryUnit } from '../../inventory/entities/inventory-unit.entity';
import { ReturnItem } from '../../returns/entities/return-item.entity';

@Entity('handover_items')
@Check('CHK_handover_items_quantity', '"quantity_handed_over" > 0')
export class HandoverItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'handover_id', type: 'uuid' })
  handoverId: string;

  @ManyToOne(() => HandoverRecord, (record) => record.items, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'handover_id' })
  handover: Relation<HandoverRecord>;

  @Index()
  @Column({ name: 'request_item_id', type: 'uuid' })
  requestItemId: string;

  @ManyToOne(() => BorrowRequestItem, (item) => item.handoverItems, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_item_id' })
  requestItem: Relation<BorrowRequestItem>;

  /** NULL untuk barang CONSUMABLE. */
  @Index()
  @Column({ name: 'inventory_unit_id', type: 'uuid', nullable: true })
  inventoryUnitId: string | null;

  @ManyToOne(() => InventoryUnit, (unit) => unit.handoverItems, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'inventory_unit_id' })
  inventoryUnit: Relation<InventoryUnit> | null;

  @Column({ name: 'quantity_handed_over', type: 'integer' })
  quantityHandedOver: number;

  @OneToMany(() => ReturnItem, (item) => item.handoverItem)
  returnItems: Relation<ReturnItem[]>;
}
