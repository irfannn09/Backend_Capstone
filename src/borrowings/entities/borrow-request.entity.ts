import {
  Check,
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
  UpdateDateColumn,
} from 'typeorm';
import { BorrowRequestStatus } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import { BorrowRequestItem } from './borrow-request-item.entity';
import { ItemBooking } from './item-booking.entity';
import { FaceVerification } from '../../face/entities/face-verification.entity';
import { HandoverRecord } from '../../handovers/entities/handover-record.entity';
import { ReturnRecord } from '../../returns/entities/return-record.entity';

/**
 * start_at / end_at = waktu pemakaian barang.
 * (Deadline approval 2 jam ada di item_bookings.expires_at.)
 */
@Entity('borrow_requests')
@Index('IDX_borrow_requests_period', ['startAt', 'endAt'])
@Check('CHK_borrow_requests_period', '"end_at" > "start_at"')
export class BorrowRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.borrowRequests, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ name: 'request_code', type: 'varchar', length: 50, unique: true })
  requestCode: string;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'text' })
  purpose: string;

  @Index()
  @Column({
    type: 'enum',
    enum: BorrowRequestStatus,
    default: BorrowRequestStatus.PENDING_FACE,
  })
  status: BorrowRequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => BorrowRequestItem, (item) => item.request)
  items: Relation<BorrowRequestItem[]>;

  @OneToMany(() => ItemBooking, (booking) => booking.request)
  bookings: Relation<ItemBooking[]>;

  @OneToMany(() => FaceVerification, (fv) => fv.request)
  faceVerifications: Relation<FaceVerification[]>;

  @OneToOne(() => HandoverRecord, (hr) => hr.request)
  handoverRecord: Relation<HandoverRecord> | null;

  @OneToOne(() => ReturnRecord, (rr) => rr.request)
  returnRecord: Relation<ReturnRecord> | null;
}
