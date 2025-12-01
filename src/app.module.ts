import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { SchedulerModule } from './common/scheduler/scheduler.module';
import { StoryModule } from './modules/story/story.module';
import { ScenesModule } from './modules/scenes/scenes.module';
import { LogsModule } from './modules/logs/logs.module';
import { SpeakersModule } from './modules/speakers/speakers.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    SchedulerModule,
    StoryModule,
    ScenesModule,
    LogsModule,
    SpeakersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
