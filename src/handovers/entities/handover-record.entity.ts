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
} from 'typeorm';
import { BorrowRequest } from '../../borrowings/entities/borrow-request.entity';
import { User } from '../../users/entities/user.entity';
import { HandoverItem } from './handover-item.entity';

@Entity('handover_records')
export class HandoverRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  // UNIQUE pada request_id dibuat otomatis oleh relasi OneToOne.
  @OneToOne(() => BorrowRequest, (request) => request.handoverRecord, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_id' })
  request: Relation<BorrowRequest>;

  @Index()
  @Column({ name: 'handed_over_by', type: 'uuid' })
  handedOverBy: string;

  @ManyToOne(() => User, (user) => user.handovers, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'handed_over_by' })
  handedOverByUser: Relation<User>;

  @Column({ name: 'handed_over_at', type: 'timestamptz', default: () => 'now()' })
  handedOverAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => HandoverItem, (item) => item.handover)
  items: Relation<HandoverItem[]>;
}
