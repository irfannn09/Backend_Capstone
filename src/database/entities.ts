import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { FaceProfile } from '../face/entities/face-profile.entity';
import { FaceVerification } from '../face/entities/face-verification.entity';
import { ItemCategory } from '../master-data/entities/item-category.entity';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { RepairRecord } from '../repairs/entities/repair-record.entity';
import { BorrowRequest } from '../borrowings/entities/borrow-request.entity';
import { BorrowRequestItem } from '../borrowings/entities/borrow-request-item.entity';
import { ItemBooking } from '../borrowings/entities/item-booking.entity';
import { HandoverRecord } from '../handovers/entities/handover-record.entity';
import { HandoverItem } from '../handovers/entities/handover-item.entity';
import { ReturnRecord } from '../returns/entities/return-record.entity';
import { ReturnItem } from '../returns/entities/return-item.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { Notification } from '../notifications/entities/notification.entity';

/** Daftar final 20 entity (urutan mengikuti ERD final). */
export const ENTITIES = [
  Role,
  User,
  Profile,
  FaceProfile,
  FaceVerification,
  ItemCategory,
  ItemType,
  Location,
  InventoryUnit,
  ConsumableStock,
  RepairRecord,
  BorrowRequest,
  BorrowRequestItem,
  ItemBooking,
  HandoverRecord,
  HandoverItem,
  ReturnRecord,
  ReturnItem,
  StockMovement,
  Notification,
];
