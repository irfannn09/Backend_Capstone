import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaceVerification } from '../face/entities/face-verification.entity';
import { FaceModule } from '../face/face.module';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { BorrowApprovalService } from './borrow-approval.service';
import { BorrowExpiryService } from './borrow-expiry.service';
import { BorrowRequestsController } from './borrow-requests.controller';
import { BorrowRequestsService } from './borrow-requests.service';
import { BorrowRequestItem } from './entities/borrow-request-item.entity';
import { BorrowRequest } from './entities/borrow-request.entity';
import { ItemBooking } from './entities/item-booking.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BorrowRequest, BorrowRequestItem, ItemBooking, FaceVerification,
      ItemType, InventoryUnit, ConsumableStock,
    ]),
    FaceModule,
  ],
  controllers: [BorrowRequestsController, AvailabilityController],
  providers: [AvailabilityService, BorrowExpiryService, BorrowRequestsService, BorrowApprovalService],
  exports: [AvailabilityService, BorrowExpiryService],
})
export class BorrowingsModule {}
