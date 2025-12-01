import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiKeyRollingService } from './api-key-rolling.service';

@Module({
  providers: [AiService, ApiKeyRollingService],
  exports: [AiService, ApiKeyRollingService],
})
export class AiModule {}
