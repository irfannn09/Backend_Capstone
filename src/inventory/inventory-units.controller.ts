import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateInventoryUnitDto, ListInventoryUnitsQueryDto, UpdateInventoryUnitDto,
} from './dto/inventory-unit.dto';
import { INVENTORY_READ_ROLES, INVENTORY_WRITE_ROLES } from './inventory.access';
import { InventoryUnitsService } from './inventory-units.service';

@Controller('inventory-units')
@Roles(...INVENTORY_READ_ROLES)
export class InventoryUnitsController {
  constructor(private readonly service: InventoryUnitsService) {}

  @Post()
  @Roles(...INVENTORY_WRITE_ROLES)
  create(@Body() dto: CreateInventoryUnitDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query() query: ListInventoryUnitsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(...INVENTORY_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryUnitDto) {
    return this.service.update(id, dto);
  }
}
