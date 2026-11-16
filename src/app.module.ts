import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BorrowingsModule } from './borrowings/borrowings.module';
import { DatabaseModule } from './database/database.module';
import { FaceModule } from './face/face.module';
import { HandoversModule } from './handovers/handovers.module';
import { InventoryModule } from './inventory/inventory.module';
import { MasterDataModule } from './master-data/master-data.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RepairsModule } from './repairs/repairs.module';
import { ReturnsModule } from './returns/returns.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    FaceModule,
    MasterDataModule,
    InventoryModule,
    BorrowingsModule,
    HandoversModule,
    ReturnsModule,
    RepairsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
