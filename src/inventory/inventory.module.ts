import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemType } from '../master-data/entities/item-type.entity';
import { Location } from '../master-data/entities/location.entity';
import { ConsumableStocksController } from './consumable-stocks.controller';
import { ConsumableStocksService } from './consumable-stocks.service';
import { ConsumableStock } from './entities/consumable-stock.entity';
import { InventoryUnit } from './entities/inventory-unit.entity';
import { InventoryUnitsController } from './inventory-units.controller';
import { InventoryUnitsService } from './inventory-units.service';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryUnit, ConsumableStock, ItemType, Location])],
  controllers: [InventoryUnitsController, ConsumableStocksController],
  providers: [InventoryUnitsService, ConsumableStocksService],
  exports: [InventoryUnitsService, ConsumableStocksService],
})
export class InventoryModule {}
