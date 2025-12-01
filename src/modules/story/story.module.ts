import { Module, forwardRef } from '@nestjs/common';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { AiModule } from '../../common/ai/ai.module';
import { TtsModule } from '../../common/tts/tts.module';
import { ImageModule } from '../../common/image/image.module';
import { FfmpegModule } from '../../common/ffmpeg/ffmpeg.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [
    AiModule,
    TtsModule,
    ImageModule,
    FfmpegModule,
    forwardRef(() => LogsModule),
  ],
  controllers: [StoryController],
  providers: [StoryService],
  exports: [StoryService],
})
export class StoryModule {}
