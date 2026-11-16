import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { ItemType } from '../../master-data/entities/item-type.entity';
import { StockMovement } from '../../stock/entities/stock-movement.entity';

@Entity('consumable_stocks')
@Check('CHK_consumable_stocks_current_stock', '"current_stock" >= 0')
@Check('CHK_consumable_stocks_minimum_stock', '"minimum_stock" >= 0')
export class ConsumableStock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_type_id', type: 'uuid' })
  itemTypeId: string;

  // UNIQUE pada item_type_id dibuat otomatis oleh relasi OneToOne.
  @OneToOne(() => ItemType, (itemType) => itemType.consumableStock, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'item_type_id' })
  itemType: Relation<ItemType>;

  @Column({ name: 'current_stock', type: 'integer', default: 0 })
  currentStock: number;

  @Column({ name: 'minimum_stock', type: 'integer', default: 0 })
  minimumStock: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => StockMovement, (sm) => sm.consumableStock)
  movements: Relation<StockMovement[]>;
}
