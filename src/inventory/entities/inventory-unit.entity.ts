import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { AvailabilityStatus, ItemCondition } from '../../common/enums';
import { ItemType } from '../../master-data/entities/item-type.entity';
import { Location } from '../../master-data/entities/location.entity';
import { RepairRecord } from '../../repairs/entities/repair-record.entity';
import { ItemBooking } from '../../borrowings/entities/item-booking.entity';
import { HandoverItem } from '../../handovers/entities/handover-item.entity';

/**
 * Unit fisik untuk barang PER_UNIT.
 * current_condition (kondisi fisik) dan availability_status (ketersediaan)
 * sengaja dipisah.
 */
@Entity('inventory_units')
export class InventoryUnit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'item_type_id', type: 'uuid' })
  itemTypeId: string;

  @ManyToOne(() => ItemType, (itemType) => itemType.inventoryUnits, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'item_type_id' })
  itemType: Relation<ItemType>;

  @Index()
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @ManyToOne(() => Location, (location) => location.inventoryUnits, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'location_id' })
  location: Relation<Location>;

  @Column({ name: 'inventory_code', type: 'varchar', length: 100, unique: true })
  inventoryCode: string;

  @Column({ name: 'serial_number', type: 'varchar', length: 150, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'varchar', length: 150, unique: true })
  barcode: string;

  @Column({
    name: 'current_condition',
    type: 'enum',
    enum: ItemCondition,
    default: ItemCondition.LAYAK_PAKAI,
  })
  currentCondition: ItemCondition;

  @Index()
  @Column({
    name: 'availability_status',
    type: 'enum',
    enum: AvailabilityStatus,
    default: AvailabilityStatus.AVAILABLE,
  })
  availabilityStatus: AvailabilityStatus;

  @Column({ name: 'purchase_date', type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => RepairRecord, (rr) => rr.inventoryUnit)
  repairRecords: Relation<RepairRecord[]>;

  @OneToMany(() => ItemBooking, (booking) => booking.inventoryUnit)
  bookings: Relation<ItemBooking[]>;

  @OneToMany(() => HandoverItem, (hi) => hi.inventoryUnit)
  handoverItems: Relation<HandoverItem[]>;
}
