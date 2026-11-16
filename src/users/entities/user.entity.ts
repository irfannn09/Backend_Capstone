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
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './role.entity';
import { Profile } from '../../profiles/entities/profile.entity';
import { FaceProfile } from '../../face/entities/face-profile.entity';
import { FaceVerification } from '../../face/entities/face-verification.entity';
import { BorrowRequest } from '../../borrowings/entities/borrow-request.entity';
import { RepairRecord } from '../../repairs/entities/repair-record.entity';
import { HandoverRecord } from '../../handovers/entities/handover-record.entity';
import { ReturnRecord } from '../../returns/entities/return-record.entity';
import { StockMovement } from '../../stock/entities/stock-movement.entity';
import { Notification } from '../../notifications/entities/notification.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, (role) => role.users, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'role_id' })
  role: Relation<Role>;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** Disimpan lowercase. UNIQUE; NULL boleh berulang (siswa/guru tanpa email). */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  email: string | null;

  // select:false -> tidak ikut ter-query kecuali diminta eksplisit (anti kebocoran).
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => Profile, (profile) => profile.user)
  profile: Relation<Profile> | null;

  @OneToOne(() => FaceProfile, (faceProfile) => faceProfile.user)
  faceProfile: Relation<FaceProfile> | null;

  @OneToMany(() => FaceVerification, (fv) => fv.user)
  faceVerifications: Relation<FaceVerification[]>;

  @OneToMany(() => BorrowRequest, (br) => br.user)
  borrowRequests: Relation<BorrowRequest[]>;

  @OneToMany(() => RepairRecord, (rr) => rr.handler)
  handledRepairs: Relation<RepairRecord[]>;

  @OneToMany(() => HandoverRecord, (hr) => hr.handedOverByUser)
  handovers: Relation<HandoverRecord[]>;

  @OneToMany(() => ReturnRecord, (rr) => rr.returnedByUser)
  returnsReceived: Relation<ReturnRecord[]>;

  @OneToMany(() => StockMovement, (sm) => sm.createdByUser)
  stockMovements: Relation<StockMovement[]>;

  @OneToMany(() => Notification, (n) => n.user)
  notifications: Relation<Notification[]>;
}
