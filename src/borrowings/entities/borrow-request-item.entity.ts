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
import { BorrowRequest } from './borrow-request.entity';
import { ItemType } from '../../master-data/entities/item-type.entity';
import { HandoverItem } from '../../handovers/entities/handover-item.entity';

/**
 * User hanya memilih item type + quantity.
 * SENGAJA tidak ada inventory_unit_id: unit fisik ditentukan Sapras saat handover.
 */
@Entity('borrow_request_items')
@Check('CHK_borrow_request_items_qty_requested', '"quantity_requested" > 0')
@Check(
  'CHK_borrow_request_items_qty_handed_over',
  '"quantity_handed_over" IS NULL OR "quantity_handed_over" >= 0',
)
export class BorrowRequestItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => BorrowRequest, (request) => request.items, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_id' })
  request: Relation<BorrowRequest>;

  @Index()
  @Column({ name: 'item_type_id', type: 'uuid' })
  itemTypeId: string;

  @ManyToOne(() => ItemType, (itemType) => itemType.borrowRequestItems, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'item_type_id' })
  itemType: Relation<ItemType>;

  @Column({ name: 'quantity_requested', type: 'integer' })
  quantityRequested: number;

  @Column({ name: 'quantity_handed_over', type: 'integer', nullable: true })
  quantityHandedOver: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => HandoverItem, (hi) => hi.requestItem)
  handoverItems: Relation<HandoverItem[]>;
}
