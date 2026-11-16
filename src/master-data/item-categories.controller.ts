import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { CreateItemCategoryDto, UpdateItemCategoryDto } from './dto/item-category.dto';
import { ItemCategoriesService } from './item-categories.service';
import { MASTER_DATA_WRITE_ROLES } from './master-data.access';

@Controller('item-categories')
export class ItemCategoriesController {
  constructor(private readonly service: ItemCategoriesService) {}

  @Post()
  @Roles(...MASTER_DATA_WRITE_ROLES)
  create(@Body() dto: CreateItemCategoryDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query() query: SearchQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(...MASTER_DATA_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemCategoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...MASTER_DATA_WRITE_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
