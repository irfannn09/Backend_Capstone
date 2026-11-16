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
import { FaceVerificationStatus } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import { BorrowRequest } from '../../borrowings/entities/borrow-request.entity';

@Entity('face_verifications')
export class FaceVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.faceVerifications, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => BorrowRequest, (br) => br.faceVerifications, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'request_id' })
  request: Relation<BorrowRequest>;

  @Column({
    type: 'enum',
    enum: FaceVerificationStatus,
    default: FaceVerificationStatus.PENDING,
  })
  status: FaceVerificationStatus;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
