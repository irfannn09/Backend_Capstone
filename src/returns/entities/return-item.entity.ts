import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
} from 'typeorm';
import { ItemCondition } from '../../common/enums';
import { HandoverItem } from '../../handovers/entities/handover-item.entity';
import { ReturnRecord } from './return-record.entity';

/**
 * Hasil inspeksi per barang yang dikembalikan.
 * SENGAJA tanpa inventory_unit_id: unit fisik diperoleh lewat
 * return_items -> handover_items -> inventory_units (hindari FK redundan).
 * Hanya relevan untuk barang PER_UNIT (consumable tidak dikembalikan).
 */
@Entity('return_items')
@Unique('UQ_return_items_return_handover_item', ['returnId', 'handoverItemId'])
export class ReturnItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Index untuk return_id sudah tercakup oleh unique constraint komposit di atas.
  @Column({ name: 'return_id', type: 'uuid' })
  returnId: string;

  @ManyToOne(() => ReturnRecord, (record) => record.items, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'return_id' })
  return: Relation<ReturnRecord>;

  @Index()
  @Column({ name: 'handover_item_id', type: 'uuid' })
  handoverItemId: string;

  @ManyToOne(() => HandoverItem, (item) => item.returnItems, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'handover_item_id' })
  handoverItem: Relation<HandoverItem>;

  /** Kondisi saat barang diterima kembali (sumber data klasifikasi unit). */
  @Column({ name: 'return_condition', type: 'enum', enum: ItemCondition })
  returnCondition: ItemCondition;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
