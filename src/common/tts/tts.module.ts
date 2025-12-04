import { Module, Global } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsQueueService } from './tts-queue.service';

@Global()
@Module({
  providers: [TtsService, TtsQueueService],
  exports: [TtsService, TtsQueueService],
})
export class TtsModule {}
