import { Module } from '@nestjs/common';
import { StoreInfoService } from './store-info.service.js';

@Module({
  providers: [StoreInfoService],
  exports: [StoreInfoService],
})
export class StoreInfoModule {}
