import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ItemClass } from '../../common/enums';
import { ItemCategory } from './item-category.entity';
import { InventoryUnit } from '../../inventory/entities/inventory-unit.entity';
import { ConsumableStock } from '../../inventory/entities/consumable-stock.entity';
import { BorrowRequestItem } from '../../borrowings/entities/borrow-request-item.entity';

@Entity('item_types')
@Unique('UQ_item_types_category_name', ['categoryId', 'name'])
export class ItemType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => ItemCategory, (category) => category.itemTypes, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'category_id' })
  category: Relation<ItemCategory>;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'item_class', type: 'enum', enum: ItemClass })
  itemClass: ItemClass;

  @Column({ name: 'unit_name', type: 'varchar', length: 50 })
  unitName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => InventoryUnit, (unit) => unit.itemType)
  inventoryUnits: Relation<InventoryUnit[]>;

  @OneToOne(() => ConsumableStock, (stock) => stock.itemType)
  consumableStock: Relation<ConsumableStock> | null;

  @OneToMany(() => BorrowRequestItem, (item) => item.itemType)
  borrowRequestItems: Relation<BorrowRequestItem[]>;
}
