import { Module } from '@nestjs/common';
import { BorrowingsModule } from '../borrowings/borrowings.module';
import { HandoversController } from './handovers.controller';
import { HandoversService } from './handovers.service';

@Module({
  imports: [BorrowingsModule],
  controllers: [HandoversController],
  providers: [HandoversService],
  exports: [HandoversService],
})
export class HandoversModule {}
