import { Module, Global } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsQueueService } from './tts-queue.service';
import { GeminiTtsService } from './gemini-tts.service';
import { TtsCoordinatorService } from './tts-coordinator.service';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    TtsService,
    TtsQueueService,
    GeminiTtsService,
    TtsCoordinatorService,
  ],
  exports: [
    TtsService,
    TtsQueueService,
    GeminiTtsService,
    TtsCoordinatorService,
  ],
})
export class TtsModule {}
