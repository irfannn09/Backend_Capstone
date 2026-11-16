import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateItemTypeDto, ListItemTypesQueryDto, UpdateItemTypeDto,
} from './dto/item-type.dto';
import { ItemTypesService } from './item-types.service';
import { MASTER_DATA_WRITE_ROLES } from './master-data.access';

@Controller('item-types')
export class ItemTypesController {
  constructor(private readonly service: ItemTypesService) {}

  @Post()
  @Roles(...MASTER_DATA_WRITE_ROLES)
  create(@Body() dto: CreateItemTypeDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query() query: ListItemTypesQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(...MASTER_DATA_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...MASTER_DATA_WRITE_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
