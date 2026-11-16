import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { RepairStatus } from '../../common/enums';
import { InventoryUnit } from '../../inventory/entities/inventory-unit.entity';
import { User } from '../../users/entities/user.entity';

@Entity('repair_records')
export class RepairRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'inventory_unit_id', type: 'uuid' })
  inventoryUnitId: string;

  @ManyToOne(() => InventoryUnit, (unit) => unit.repairRecords, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'inventory_unit_id' })
  inventoryUnit: Relation<InventoryUnit>;

  @Column({ name: 'problem_description', type: 'text' })
  problemDescription: string;

  @Column({
    name: 'repair_status',
    type: 'enum',
    enum: RepairStatus,
    default: RepairStatus.MENUNGGU_PERBAIKAN,
  })
  repairStatus: RepairStatus;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'repair_notes', type: 'text', nullable: true })
  repairNotes: string | null;

  @Index()
  @Column({ name: 'handled_by', type: 'uuid' })
  handledBy: string;

  @ManyToOne(() => User, (user) => user.handledRepairs, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'handled_by' })
  handler: Relation<User>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
