import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Satu tabel untuk siswa & guru.
 * SISWA -> nis + class_name, GURU -> nik + subject (ditentukan oleh role user).
 */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // UNIQUE pada user_id dibuat otomatis oleh relasi OneToOne.
  @OneToOne(() => User, (user) => user.profile, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  nis: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  nik: string | null;

  @Column({ name: 'class_name', type: 'varchar', length: 50, nullable: true })
  className: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subject: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
