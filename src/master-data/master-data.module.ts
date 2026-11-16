import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsumableStock } from '../inventory/entities/consumable-stock.entity';
import { InventoryUnit } from '../inventory/entities/inventory-unit.entity';
import { ItemCategory } from './entities/item-category.entity';
import { ItemType } from './entities/item-type.entity';
import { Location } from './entities/location.entity';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemTypesController } from './item-types.controller';
import { LocationsController } from './locations.controller';
import { ItemTypesService } from './item-types.service';
import { LocationsService } from './locations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ItemCategory, ItemType, Location, InventoryUnit, ConsumableStock]),
  ],
  controllers: [ItemCategoriesController, ItemTypesController, LocationsController],
  providers: [ItemCategoriesService, ItemTypesService, LocationsService],
  exports: [ItemCategoriesService, ItemTypesService, LocationsService],
})
export class MasterDataModule {}
