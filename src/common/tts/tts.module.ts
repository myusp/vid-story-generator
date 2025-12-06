import { Module, Global } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsQueueService } from './tts-queue.service';
import { GeminiTtsService } from './gemini-tts.service';
import { PollinationsTtsService } from './pollinations-tts.service';
import { TtsCoordinatorService } from './tts-coordinator.service';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    TtsService,
    TtsQueueService,
    GeminiTtsService,
    PollinationsTtsService,
    TtsCoordinatorService,
  ],
  exports: [
    TtsService,
    TtsQueueService,
    GeminiTtsService,
    PollinationsTtsService,
    TtsCoordinatorService,
  ],
})
export class TtsModule {}
