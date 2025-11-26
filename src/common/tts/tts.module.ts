import { Module } from '@nestjs/common';
import { EdgeTtsService } from './edge-tts.service';

@Module({
  providers: [EdgeTtsService],
  exports: [EdgeTtsService],
})
export class TtsModule {}
