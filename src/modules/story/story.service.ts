import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../../common/ai/ai.service';
import { EdgeTtsService } from '../../common/tts/edge-tts.service';
import { ImageService } from '../../common/image/image.service';
import { FfmpegService } from '../../common/ffmpeg/ffmpeg.service';
import { SrtGenerator } from '../../common/utils/srt-generator';
import { StartStoryDto } from '../../common/dto/start-story.dto';
import { StoryStatus } from '../../common/enums/story-status.enum';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class StoryService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private aiService: AiService,
    private ttsService: EdgeTtsService,
    private imageService: ImageService,
    private ffmpegService: FfmpegService,
  ) {
    this.ensureDirectories();
  }

  private ensureDirectories() {
    const dirs = [
      this.configService.get<string>('VIDEO_TMP_DIR', './storage/tmp'),
      this.configService.get<string>('VIDEO_OUTPUT_DIR', './storage/videos'),
      this.configService.get<string>('SRT_OUTPUT_DIR', './storage/subtitles'),
      this.configService.get<string>('IMAGE_OUTPUT_DIR', './storage/images'),
      this.configService.get<string>('AUDIO_OUTPUT_DIR', './storage/audio'),
    ];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async startProject(dto: StartStoryDto) {
    const project = await this.prisma.storyProject.create({
      data: {
        topic: dto.topic,
        genre: dto.genre,
        language: dto.language,
        speakerCode: dto.speaker,
        orientation: dto.orientation,
        totalImages: dto.totalImages,
        modelProvider: dto.modelProvider,
        imageStyle: dto.imageStyle,
        narrativeTone: dto.narrativeTone,
        status: StoryStatus.PENDING,
      },
    });

    await this.logMessage(
      project.id,
      'INFO',
      'PROJECT_STARTED',
      'Project created successfully',
    );

    return project;
  }

  async generateFullStory(projectId: string) {
    try {
      const project = await this.prisma.storyProject.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const provider = (project.modelProvider as 'gemini' | 'openai') || 'gemini';

      // Step 1: Generate metadata
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_METADATA',
        'Generating story metadata...',
      );
      const metadata = await this.aiService.generateStoryMetadata(
        project.topic,
        project.genre,
        project.language,
        provider,
      );

      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: {
          titleGenerated: metadata.title,
          descriptionGenerated: metadata.description,
          hashtagsGenerated: metadata.hashtags,
          status: StoryStatus.STORY_PROMPT_READY,
        },
      });

      // Step 2: Generate narrations only (NEW MULTI-STEP FLOW)
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_NARRATIONS',
        'Generating scene narrations...',
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.GENERATING_SCENES },
      });

      const narrations = await this.aiService.generateNarrations(
        project.topic,
        project.genre,
        project.language,
        project.totalImages,
        project.narrativeTone || '',
        provider,
      );

      // Create initial scenes with narrations only
      for (const narration of narrations) {
        await this.prisma.storyScene.create({
          data: {
            projectId,
            order: narration.order,
            narration: narration.narration,
          },
        });
      }

      // Step 3: Generate image prompts for each narration
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_IMAGE_PROMPTS',
        'Generating image prompts...',
      );

      const dbScenes = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      for (const scene of dbScenes) {
        const imagePrompt = await this.aiService.generateImagePrompt(
          scene.narration,
          project.imageStyle || '',
          provider,
        );

        await this.prisma.storyScene.update({
          where: { id: scene.id },
          data: { imagePrompt: imagePrompt.trim() },
        });
      }

      // Step 4: Generate SSML and animations for each scene
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_SSML_ANIMATIONS',
        'Generating SSML and animations...',
      );

      const scenesWithPrompts = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      for (const scene of scenesWithPrompts) {
        // Generate SSML
        const ssml = this.ttsService.convertToSsml(
          scene.narration,
          project.speakerCode,
        );

        // Generate animations
        const animations = await this.aiService.generateAnimations(
          scene.narration,
          provider,
        );

        await this.prisma.storyScene.update({
          where: { id: scene.id },
          data: {
            ssml,
            animationIn: animations.animationIn,
            animationShow: animations.animationShow,
            animationOut: animations.animationOut,
          },
        });
      }

      // Step 5: Generate images
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_IMAGES',
        'Generating images...',
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.GENERATING_IMAGES },
      });

      const scenesWithSsml = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      const imageDir = this.configService.get<string>(
        'IMAGE_OUTPUT_DIR',
        './storage/images',
      );
      const width = project.orientation === 'PORTRAIT' ? 720 : 1280;
      const height = project.orientation === 'PORTRAIT' ? 1280 : 720;

      for (const scene of scenesWithSsml) {
        const imagePath = path.join(
          imageDir,
          `${projectId}_scene_${scene.order}.jpg`,
        );
        await this.imageService.generateImage(
          scene.imagePrompt,
          imagePath,
          width,
          height,
        );
        await this.prisma.storyScene.update({
          where: { id: scene.id },
          data: { imagePath },
        });
      }

      // Step 6: Generate TTS using SSML
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_TTS',
        'Generating audio with SSML...',
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.GENERATING_TTS },
      });

      const audioDir = this.configService.get<string>(
        'AUDIO_OUTPUT_DIR',
        './storage/audio',
      );
      let currentTime = 0;

      const scenesWithImages = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      for (const scene of scenesWithImages) {
        const audioPath = path.join(
          audioDir,
          `${projectId}_scene_${scene.order}.wav`,
        );
        
        // Use SSML for speech generation
        const result = await this.ttsService.generateSpeech(
          scene.ssml || scene.narration,
          project.speakerCode,
          audioPath,
          !!scene.ssml, // useSsml = true if ssml exists
        );

        await this.prisma.storyScene.update({
          where: { id: scene.id },
          data: {
            audioPath,
            startTimeMs: currentTime,
            endTimeMs: currentTime + result.durationMs,
          },
        });

        currentTime += result.durationMs;
      }

      // Step 7: Render video with animations
      await this.logMessage(
        projectId,
        'INFO',
        'RENDERING_VIDEO',
        'Rendering video with animations...',
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.RENDERING_VIDEO },
      });

      const tmpDir = this.configService.get<string>(
        'VIDEO_TMP_DIR',
        './storage/tmp',
      );
      const videoOutputDir = this.configService.get<string>(
        'VIDEO_OUTPUT_DIR',
        './storage/videos',
      );
      const sceneVideos = [];

      const updatedScenes = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      for (const scene of updatedScenes) {
        const sceneVideoPath = path.join(
          tmpDir,
          `${projectId}_scene_${scene.order}.mp4`,
        );
        await this.ffmpegService.createSceneVideo(
          scene.imagePath,
          scene.audioPath,
          sceneVideoPath,
        );
        sceneVideos.push(sceneVideoPath);
      }

      const finalVideoPath = path.join(videoOutputDir, `${projectId}.mp4`);
      await this.ffmpegService.concatenateVideos(sceneVideos, finalVideoPath);

      // Cleanup temp files
      for (const videoPath of sceneVideos) {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      }

      // Step 8: Generate SRT
      const srtOutputDir = this.configService.get<string>(
        'SRT_OUTPUT_DIR',
        './storage/subtitles',
      );
      const srtPath = path.join(srtOutputDir, `${projectId}.srt`);

      const subtitles = updatedScenes.map((scene, index) => ({
        index: index + 1,
        startTime: SrtGenerator.msToSrtTime(scene.startTimeMs),
        endTime: SrtGenerator.msToSrtTime(scene.endTimeMs),
        text: scene.narration,
      }));

      const srtContent = SrtGenerator.generateSrt(subtitles);
      fs.writeFileSync(srtPath, srtContent);

      // Update project
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: {
          videoPath: finalVideoPath,
          srtPath,
          status: StoryStatus.COMPLETED,
        },
      });

      await this.logMessage(
        projectId,
        'INFO',
        'COMPLETED',
        'Video generation completed!',
      );

      return await this.prisma.storyProject.findUnique({
        where: { id: projectId },
        include: { scenes: true, logs: true },
      });
    } catch (error) {
      await this.logMessage(
        projectId,
        'ERROR',
        'GENERATION_FAILED',
        error.message,
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.FAILED },
      });
      throw error;
    }
  }
  async getProject(id: string) {
    return this.prisma.storyProject.findUnique({
      where: { id },
      include: { scenes: true, logs: true },
    });
  }

  async listProjects() {
    return this.prisma.storyProject.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  private async logMessage(
    projectId: string,
    level: string,
    code: string,
    message: string,
    meta?: any,
  ) {
    return this.prisma.storyLog.create({
      data: {
        projectId,
        level,
        code,
        message,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });
  }
}
