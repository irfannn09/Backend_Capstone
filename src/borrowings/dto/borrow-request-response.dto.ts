import { BorrowRequest } from '../entities/borrow-request.entity';
import { approvalDeadline } from '../borrowings.constants';

/** Response request. Tidak memuat face_template maupun data sensitif user. */
export class BorrowRequestResponseDto {
  id: string;
  requestCode: string;
  status: string;
  startAt: Date;
  endAt: Date;
  purpose: string;
  /** created_at + 2 jam. */
  approvalDeadline: Date;
  createdAt: Date;
  updatedAt: Date;
  requester: {
    id: string;
    name: string;
    nis: string | null;
    nik: string | null;
    className: string | null;
    subject: string | null;
  } | null;
  items: Array<{
    id: string;
    quantityRequested: number;
    quantityHandedOver: number | null;
    notes: string | null;
    itemType: { id: string; name: string; itemClass: string; unitName: string } | null;
  }>;
  /** Unit fisik yang di-booking Sapras saat approval (kosong sebelum approved). */
  bookings: Array<{
    id: string;
    status: string;
    startAt: Date;
    endAt: Date;
    inventoryUnit: { id: string; inventoryCode: string; barcode: string; serialNumber: string | null; itemTypeId: string } | null;
  }>;
  faceVerification: { status: string; verifiedAt: Date | null } | null;

  static from(r: BorrowRequest): BorrowRequestResponseDto {
    const latestFace = [...(r.faceVerifications ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    return {
      id: r.id,
      requestCode: r.requestCode,
      status: r.status,
      startAt: r.startAt,
      endAt: r.endAt,
      purpose: r.purpose,
      approvalDeadline: approvalDeadline(r.createdAt),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      requester: r.user
        ? {
            id: r.user.id,
            name: r.user.name,
            nis: r.user.profile?.nis ?? null,
            nik: r.user.profile?.nik ?? null,
            className: r.user.profile?.className ?? null,
            subject: r.user.profile?.subject ?? null,
          }
        : null,
      items: (r.items ?? []).map((i) => ({
        id: i.id,
        quantityRequested: i.quantityRequested,
        quantityHandedOver: i.quantityHandedOver,
        notes: i.notes,
        itemType: i.itemType
          ? { id: i.itemType.id, name: i.itemType.name, itemClass: i.itemType.itemClass, unitName: i.itemType.unitName }
          : null,
      })),
      bookings: (r.bookings ?? []).map((b) => ({
        id: b.id,
        status: b.status,
        startAt: b.startAt,
        endAt: b.endAt,
        inventoryUnit: b.inventoryUnit
          ? {
              id: b.inventoryUnit.id,
              inventoryCode: b.inventoryUnit.inventoryCode,
              barcode: b.inventoryUnit.barcode,
              serialNumber: b.inventoryUnit.serialNumber,
              itemTypeId: b.inventoryUnit.itemTypeId,
            }
          : null,
      })),
      faceVerification: latestFace
        ? { status: latestFace.status, verifiedAt: latestFace.verifiedAt }
        : null,
    };
  }
}
