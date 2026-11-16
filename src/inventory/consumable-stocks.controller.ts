import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConsumableStocksService } from './consumable-stocks.service';
import {
  CreateConsumableStockDto, ListConsumableStocksQueryDto, UpdateConsumableStockDto,
} from './dto/consumable-stock.dto';
import { INVENTORY_READ_ROLES, INVENTORY_WRITE_ROLES } from './inventory.access';

@Controller('consumable-stocks')
@Roles(...INVENTORY_READ_ROLES)
export class ConsumableStocksController {
  constructor(private readonly service: ConsumableStocksService) {}

  /** Stok awal dicatat sebagai STOCK_IN oleh service, memakai user JWT sebagai createdBy. */
  @Post()
  @Roles(...INVENTORY_WRITE_ROLES)
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateConsumableStockDto) {
    return this.service.create(userId, dto);
  }

  @Get()
  findAll(@Query() query: ListConsumableStocksQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** Hanya minimum_stock. Perubahan stok aktual lewat stock movement (Sprint 9). */
  @Patch(':id')
  @Roles(...INVENTORY_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConsumableStockDto) {
    return this.service.update(id, dto);
  }
}
