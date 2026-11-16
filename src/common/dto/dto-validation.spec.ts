import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateBorrowRequestDto } from '../../borrowings/dto/create-borrow-request.dto';
import { CreateHandoverDto } from '../../handovers/dto/create-handover.dto';
import { CreateConsumableStockDto } from '../../inventory/dto/consumable-stock.dto';
import { CreateReturnDto } from '../../returns/dto/create-return.dto';
import { CreateInventoryUnitDto } from '../../inventory/dto/inventory-unit.dto';
import { CreateItemTypeDto } from '../../master-data/dto/item-type.dto';
import { RepairActionDto } from '../../repairs/dto/repair-action.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';
async function errorsOf<T extends object>(cls: new () => T, plain: object) {
  const errs = await validate(plainToInstance(cls, plain));
  return errs.map((e) => e.property);
}

function allMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...allMessages(e.children ?? []),
  ]);
}

describe('DTO validation', () => {
  it('CreateUserDto: role ADMIN ditolak (dibuat lewat seed), email invalid, password pendek', async () => {
    const bad = await errorsOf(CreateUserDto, {
      role: 'ADMIN',
      name: 'x',
      email: 'bukan-email',
      password: '123',
    });
    expect(bad).toEqual(expect.arrayContaining(['role', 'email', 'password']));
    expect(
      await errorsOf(CreateUserDto, {
        role: 'SISWA',
        name: ' Budi ',
        password: 'Rahasia123',
      }),
    ).toEqual([]);
  });
  it('CreateItemTypeDto: UUID & enum', async () => {
    const bad = await errorsOf(CreateItemTypeDto, {
      categoryId: 'abc',
      name: '',
      itemClass: 'LAIN',
      unitName: 'pcs',
    });
    expect(bad).toEqual(
      expect.arrayContaining(['categoryId', 'name', 'itemClass']),
    );
  });
  it('CreateInventoryUnitDto: BOOKED/BORROWED manual ditolak, format tanggal', async () => {
    const base = {
      itemTypeId: UUID,
      locationId: UUID,
      inventoryCode: 'A',
      barcode: 'B',
    };
    expect(
      await errorsOf(CreateInventoryUnitDto, {
        ...base,
        availabilityStatus: 'BORROWED',
      }),
    ).toContain('availabilityStatus');
    expect(
      await errorsOf(CreateInventoryUnitDto, {
        ...base,
        purchaseDate: '31-12-2025',
      }),
    ).toContain('purchaseDate');
    expect(
      await errorsOf(CreateInventoryUnitDto, {
        ...base,
        purchaseDate: '2025-12-31',
      }),
    ).toEqual([]);
  });
  it('CreateConsumableStockDto: stok negatif / pecahan ditolak', async () => {
    expect(
      await errorsOf(CreateConsumableStockDto, {
        itemTypeId: UUID,
        currentStock: -1,
        minimumStock: 0,
      }),
    ).toContain('currentStock');
    expect(
      await errorsOf(CreateConsumableStockDto, {
        itemTypeId: UUID,
        currentStock: 1.5,
        minimumStock: 0,
      }),
    ).toContain('currentStock');
    expect(
      await errorsOf(CreateConsumableStockDto, {
        itemTypeId: UUID,
        currentStock: 0,
        minimumStock: 0,
      }),
    ).toEqual([]);
  });

  it('CreateHandoverDto: requestId wajib UUID', async () => {
    expect(await errorsOf(CreateHandoverDto, {})).toContain('requestId');
    expect(
      await errorsOf(CreateHandoverDto, { requestId: 'bukan-uuid' }),
    ).toContain('requestId');
    expect(
      await errorsOf(CreateHandoverDto, { requestId: UUID, notes: 'ok' }),
    ).toEqual([]);
  });

  it('CreateReturnDto: requestId, handoverItemId, dan kondisi wajib valid', async () => {
    const bad = await errorsOf(CreateReturnDto, {
      requestId: 'x',
      items: [{ handoverItemId: 'y', returnCondition: 'RUSAK' }],
    });
    expect(bad).toEqual(
      expect.arrayContaining(['requestId', 'items']),
    );
    expect(
      await errorsOf(CreateReturnDto, {
        requestId: UUID,
        items: [
          {
            handoverItemId: UUID,
            returnCondition: 'PERLU_DIPERBAIKI',
            notes: 'Layar retak',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('RepairActionDto: hanya repairNotes; tipe dan panjang divalidasi', async () => {
    expect(await errorsOf(RepairActionDto, {})).toEqual([]);
    expect(
      await errorsOf(RepairActionDto, { repairNotes: 123 }),
    ).toContain('repairNotes');
    expect(
      await errorsOf(RepairActionDto, { repairNotes: 'x'.repeat(1001) }),
    ).toContain('repairNotes');
    expect(
      await errorsOf(RepairActionDto, { repairNotes: 'Layar diganti' }),
    ).toEqual([]);
  });

  it('pesan validasi memakai Bahasa Indonesia yang spesifik (bukan default English)', async () => {
    const cases: Array<[new () => object, object]> = [
      [
        CreateUserDto,
        { role: 'ADMIN', name: '', email: 'bukan-email', password: '123' },
      ],
      [
        CreateInventoryUnitDto,
        {
          itemTypeId: 'x',
          locationId: 'y',
          inventoryCode: '',
          barcode: '',
          availabilityStatus: 'BORROWED',
          purchaseDate: '31-12-2025',
        },
      ],
      [
        CreateBorrowRequestDto,
        {
          items: [{ itemTypeId: 'x', quantity: 0 }],
          startAt: 'besok',
          endAt: 'lusa',
          purpose: '',
          faceImage: '',
        },
      ],
    ];

    for (const [cls, plain] of cases) {
      const messages = allMessages(await validate(plainToInstance(cls, plain)));
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message).not.toMatch(
          /\b(must|should|is not|not be|expected)\b/i,
        );
      }
    }

    const userMessages = allMessages(
      await validate(
        plainToInstance(CreateUserDto, {
          role: 'ADMIN',
          name: '',
          email: 'bukan-email',
          password: '123',
        }),
      ),
    );
    expect(userMessages).toEqual(
      expect.arrayContaining([
        'Role harus salah satu dari: SISWA, GURU, SAPRAS',
        'Nama lengkap tidak boleh kosong',
        'Email harus berupa alamat email yang valid',
        'Password minimal 8 karakter',
      ]),
    );
  });
});
