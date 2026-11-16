import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { StockMovementType } from '../../common/enums';
import { ConsumableStock } from '../../inventory/entities/consumable-stock.entity';
import { User } from '../../users/entities/user.entity';

@Entity('stock_movements')
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'consumable_stock_id', type: 'uuid' })
  consumableStockId: string;

  @ManyToOne(() => ConsumableStock, (stock) => stock.movements, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'consumable_stock_id' })
  consumableStock: Relation<ConsumableStock>;

  @Column({ type: 'enum', enum: StockMovementType })
  type: StockMovementType;

  @Column({ type: 'integer' })
  quantity: number;

  /** Logical reference (mis. handover_id). SENGAJA tanpa FK database. */
  @Index()
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Index()
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, (user) => user.stockMovements, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'created_by' })
  createdByUser: Relation<User>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
