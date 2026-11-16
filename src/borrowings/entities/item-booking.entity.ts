import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { BookingStatus } from '../../common/enums';
import { InventoryUnit } from '../../inventory/entities/inventory-unit.entity';
import { BorrowRequest } from './borrow-request.entity';

/**
 * start_at / end_at = waktu pemakaian unit.
 * inventory_unit_id NULL = reservasi kapasitas PER_UNIT sebelum handover.
 * inventory_unit_id terisi = booking unit fisik setelah handover.
 * expires_at = deadline approval Sapras (2 jam), BUKAN durasi peminjaman.
 */
@Entity('item_bookings')
@Index('IDX_item_bookings_unit_period', ['inventoryUnitId', 'startAt', 'endAt'])
@Index('IDX_item_bookings_status_expires', ['status', 'expiresAt'])
@Check('CHK_item_bookings_period', '"end_at" > "start_at"')
export class ItemBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'inventory_unit_id', type: 'uuid', nullable: true })
  inventoryUnitId: string | null;

  @ManyToOne(() => InventoryUnit, (unit) => unit.bookings, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'inventory_unit_id' })
  inventoryUnit: Relation<InventoryUnit>;

  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => BorrowRequest, (request) => request.bookings, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_id' })
  request: Relation<BorrowRequest>;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.ACTIVE })
  status: BookingStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
