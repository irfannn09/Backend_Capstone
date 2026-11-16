import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/borrow-request-query.dto';

/**
 * Melengkapi katalog yang sudah ada (GET /item-types dan GET /item-types/:id dari Sprint 7).
 * Semua user terautentikasi boleh melihat ketersediaan.
 */
@Controller('item-types')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get(':id/availability')
  getAvailability(@Param('id', ParseUUIDPipe) id: string, @Query() query: AvailabilityQueryDto) {
    if (!!query.startAt !== !!query.endAt) {
      throw new BadRequestException('startAt dan endAt harus diisi bersamaan');
    }
    let window = null;
    if (query.startAt && query.endAt) {
      const startAt = new Date(query.startAt);
      const endAt = new Date(query.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw new BadRequestException('Rentang waktu tidak valid: endAt harus setelah startAt');
      }
      window = { startAt, endAt };
    }
    return this.availability.forItemType(id, window);
  }
}
