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
import { ReturnItem } from './return-item.entity';

@Entity('return_records')
export class ReturnRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  // UNIQUE pada request_id dibuat otomatis oleh relasi OneToOne.
  @OneToOne(() => BorrowRequest, (request) => request.returnRecord, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_id' })
  request: Relation<BorrowRequest>;

  @Index()
  @Column({ name: 'returned_by', type: 'uuid' })
  returnedBy: string;

  @ManyToOne(() => User, (user) => user.returnsReceived, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'returned_by' })
  returnedByUser: Relation<User>;

  @Column({ name: 'returned_at', type: 'timestamptz', default: () => 'now()' })
  returnedAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => ReturnItem, (item) => item.return)
  items: Relation<ReturnItem[]>;
}
