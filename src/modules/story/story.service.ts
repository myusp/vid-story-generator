import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSRT } from 'edge-tts-universal';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../../common/ai/ai.service';
import { FfmpegService } from '../../common/ffmpeg/ffmpeg.service';
import { ImageService } from '../../common/image/image.service';
import { generateSafeSlug } from '../../common/utils/file-naming';
import { StartStoryDto } from '../../common/dto/start-story.dto';
import { StoryStatus } from '../../common/enums/story-status.enum';
import { LogsService } from '../logs/logs.service';
import * as path from 'path';
import * as fs from 'fs';
import { SrtGenerator } from '../../common/utils/srt-generator';
import { TtsService } from '../../common/tts/tts.service';
import type { SubtitleWordBoundary } from '../../common/tts/tts.service';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private aiService: AiService,
    private ttsService: TtsService,
    private imageService: ImageService,
    private ffmpegService: FfmpegService,
    private logsService: LogsService,
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

  /**
   * Generate a unique project slug based on topic
   */
  private async generateUniqueSlug(topic: string): Promise<string> {
    const baseSlug = generateSafeSlug(topic);
    let slug = baseSlug;
    let counter = 1;

    // Check if slug exists
    while (true) {
      const existing = await this.prisma.storyProject.findFirst({
        where: { projectSlug: slug },
      });

      if (!existing) {
        break;
      }

      // Add date and/or counter
      const date = new Date();
      const dateStr =
        date.getFullYear().toString() +
        (date.getMonth() + 1).toString().padStart(2, '0') +
        date.getDate().toString().padStart(2, '0');

      if (counter === 1) {
        slug = `${baseSlug}_${dateStr}`;
      } else {
        slug = `${baseSlug}_${dateStr}_${counter}`;
      }
      counter++;

      // Safety limit
      if (counter > 100) {
        slug = `${baseSlug}_${Date.now()}`;
        break;
      }
    }

    return slug;
  }

  async startProject(dto: StartStoryDto) {
    // Determine topic from story mode
    const storyMode = dto.storyMode || 'topic';
    let topic = dto.topic || '';
    let totalImages = dto.totalImages || 8;

    // Handle different story modes
    if (storyMode === 'narrations' && dto.existingNarrations?.length) {
      totalImages = dto.existingNarrations.length;
      topic =
        dto.storyPrompt ||
        dto.existingNarrations[0].substring(0, 50) ||
        'Custom Story';
    } else if (storyMode === 'prompt' && dto.storyPrompt) {
      topic = dto.storyPrompt.substring(0, 50);
    }

    if (!topic) {
      topic = 'Untitled Story';
    }

    // Generate unique project slug from topic
    const projectSlug = await this.generateUniqueSlug(topic);

    const project = await this.prisma.storyProject.create({
      data: {
        topic,
        genre: dto.genre,
        language: dto.language,
        speakerCode: dto.speaker,
        orientation: dto.orientation,
        totalImages,
        modelProvider: dto.modelProvider,
        imageStyle: dto.imageStyle,
        narrativeTone: dto.narrativeTone,
        projectSlug,
        storyMode,
        storyPrompt: dto.storyPrompt,
        allowedAnimations: dto.allowedAnimations?.length
          ? JSON.stringify(dto.allowedAnimations)
          : null,
        status: StoryStatus.PENDING,
      },
    });

    // If using existing narrations, create scenes immediately
    if (storyMode === 'narrations' && dto.existingNarrations?.length) {
      for (let i = 0; i < dto.existingNarrations.length; i++) {
        await this.prisma.storyScene.create({
          data: {
            projectId: project.id,
            order: i + 1,
            narration: dto.existingNarrations[i],
          },
        });
      }
    }

    await this.logMessage(
      project.id,
      'INFO',
      'PROJECT_STARTED',
      `Project created with slug: ${projectSlug}, mode: ${storyMode}`,
    );

    return project;
  }

  async generateFullStory(projectId: string) {
    try {
      const project = await this.prisma.storyProject.findUnique({
        where: { id: projectId },
        include: { scenes: true },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const provider =
        (project.modelProvider as 'gemini' | 'openai') || 'gemini';
      const storyMode = project.storyMode || 'topic';

      // Parse allowed animations if set
      let allowedAnimations: string[] | undefined;
      if (project.allowedAnimations) {
        try {
          allowedAnimations = JSON.parse(project.allowedAnimations);
        } catch {
          allowedAnimations = undefined;
        }
      }

      // Step 1: Generate metadata based on story mode (skip if already done)
      if (project.status === StoryStatus.PENDING || !project.titleGenerated) {
        await this.logMessage(
          projectId,
          'INFO',
          'GENERATING_METADATA',
          `Generating story metadata (mode: ${storyMode})...`,
        );

        let metadata: { title: string; description: string; hashtags: string };
        let suggestedTopic: string | undefined;

        if (storyMode === 'prompt' && project.storyPrompt) {
          // For prompt mode: generate all metadata from the prompt
          const promptMetadata =
            await this.aiService.generateMetadataFromPrompt(
              project.storyPrompt,
              project.genre,
              project.language,
              provider,
            );
          metadata = promptMetadata;
          suggestedTopic = promptMetadata.suggestedTopic;
        } else if (storyMode === 'narrations') {
          // For narrations mode: generate metadata from the existing narrations
          const existingScenes = await this.prisma.storyScene.findMany({
            where: { projectId },
            orderBy: { order: 'asc' },
          });
          const narrationsForMeta = existingScenes
            .filter((s) => s.narration)
            .map((s) => s.narration as string);

          if (narrationsForMeta.length > 0) {
            const narrationMetadata =
              await this.aiService.generateMetadataFromNarrations(
                narrationsForMeta,
                project.genre,
                project.language,
                provider,
              );
            metadata = narrationMetadata;
            suggestedTopic = narrationMetadata.suggestedTopic;
          } else {
            // Fallback to topic-based generation
            metadata = await this.aiService.generateStoryMetadata(
              project.topic,
              project.genre,
              project.language,
              provider,
            );
          }
        } else {
          // Default: topic mode
          metadata = await this.aiService.generateStoryMetadata(
            project.topic,
            project.genre,
            project.language,
            provider,
          );
        }

        // Update project with metadata (and topic if it was a placeholder)
        const updateData: Prisma.StoryProjectUpdateInput = {
          titleGenerated: metadata.title,
          descriptionGenerated: metadata.description,
          hashtagsGenerated: metadata.hashtags,
          status: StoryStatus.STORY_PROMPT_READY,
        };

        // Update topic if a better one was suggested
        if (
          suggestedTopic &&
          (!project.topic || project.topic === 'Untitled Story')
        ) {
          updateData.topic = suggestedTopic;
        }

        await this.prisma.storyProject.update({
          where: { id: projectId },
          data: updateData,
        });
      }

      // Step 2: Generate/process narrations based on mode
      const existingScenes = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      // Use projectSlug for file naming if available, fallback to projectId
      // Refresh project data to get updated topic if changed
      const updatedProject = await this.prisma.storyProject.findUnique({
        where: { id: projectId },
      });
      const filePrefix = updatedProject?.projectSlug || projectId;

      // Process based on story mode
      if (existingScenes.length === 0 || !existingScenes[0].narration) {
        await this.logMessage(
          projectId,
          'INFO',
          'GENERATING_NARRATIONS',
          `Generating scene narrations (mode: ${storyMode})...`,
        );
        await this.prisma.storyProject.update({
          where: { id: projectId },
          data: { status: StoryStatus.GENERATING_SCENES },
        });

        // Generate narrations based on mode
        let narrations: { order: number; narration: string }[];

        if (storyMode === 'prompt' && project.storyPrompt) {
          // Use story prompt to generate narrations
          narrations = await this.aiService.generateNarrationsFromPrompt(
            project.storyPrompt,
            project.genre,
            project.language,
            project.totalImages,
            project.narrativeTone || '',
            provider,
          );
        } else {
          // Default: generate from topic
          narrations = await this.aiService.generateNarrations(
            project.topic,
            project.genre,
            project.language,
            project.totalImages,
            project.narrativeTone || '',
            provider,
          );
        }

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
      }

      // Step 2.5: Generate character descriptions if not already done
      // Use updated project data for topic if it was changed
      let characterDescriptions = updatedProject?.characterDescriptions;
      const topicForCharacters = updatedProject?.topic || project.topic;
      if (!characterDescriptions) {
        await this.logMessage(
          projectId,
          'INFO',
          'GENERATING_CHARACTERS',
          'Generating character descriptions for consistent imagery...',
        );

        const allScenes = await this.prisma.storyScene.findMany({
          where: { projectId },
          orderBy: { order: 'asc' },
        });
        const allNarrations = allScenes.map((s) => s.narration).join('\n');

        characterDescriptions =
          await this.aiService.generateCharacterDescriptions(
            topicForCharacters,
            allNarrations,
            project.imageStyle || '',
            provider,
          );

        await this.prisma.storyProject.update({
          where: { id: projectId },
          data: { characterDescriptions },
        });
      }

      // Step 3: Generate image prompts in batches (skip if already generated)
      const dbScenes = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      const scenesWithoutImagePrompts = dbScenes.filter((s) => !s.imagePrompt);
      if (scenesWithoutImagePrompts.length > 0) {
        await this.logMessage(
          projectId,
          'INFO',
          'GENERATING_IMAGE_PROMPTS',
          `Generating image prompts in batches (${scenesWithoutImagePrompts.length} remaining)...`,
        );

        // Use batch processing for image prompts with character descriptions
        const imagePromptBatch = await this.aiService.generateImagePromptsBatch(
          scenesWithoutImagePrompts.map((s) => ({
            order: s.order,
            narration: s.narration,
          })),
          project.imageStyle || '',
          provider,
          characterDescriptions, // Pass character descriptions for consistency
        );

        // Update scenes with image prompts
        for (const result of imagePromptBatch) {
          const scene = scenesWithoutImagePrompts.find(
            (s) => s.order === result.order,
          );
          if (scene) {
            await this.prisma.storyScene.update({
              where: { id: scene.id },
              data: { imagePrompt: result.imagePrompt.trim() },
            });
          }
        }
      }

      // Step 4: Generate prosody segments and animations (skip if already generated)
      const scenesWithPrompts = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      const scenesWithoutProsody = scenesWithPrompts.filter(
        (s) => !s.prosodyData,
      );
      if (scenesWithoutProsody.length > 0) {
        await this.logMessage(
          projectId,
          'INFO',
          'GENERATING_PROSODY_ANIMATIONS',
          `Generating prosody segments and animations (${scenesWithoutProsody.length} remaining)...`,
        );

        // Use batch processing for prosody segments
        const prosodyBatch = await this.aiService.generateProsodyBatch(
          scenesWithoutProsody.map((s) => ({
            order: s.order,
            narration: s.narration,
          })),
          project.narrativeTone || '',
          provider,
        );

        // Update scenes with prosody data and generate animations
        for (const scene of scenesWithoutProsody) {
          const prosodyResult = prosodyBatch.find(
            (s) => s.order === scene.order,
          );
          const prosodyData = prosodyResult?.segments || [
            {
              text: scene.narration,
              rate: '+0%',
              volume: '+0%',
              pitch: '+0Hz',
            },
          ];

          // Generate animations with allowed animations filter
          const animations = await this.aiService.generateAnimations(
            scene.narration,
            provider,
            allowedAnimations, // Pass allowed animations filter
          );

          await this.prisma.storyScene.update({
            where: { id: scene.id },
            data: {
              prosodyData: JSON.stringify(prosodyData),
              animationIn: animations.animationIn,
              animationShow: animations.animationShow,
              animationOut: animations.animationOut,
            },
          });
        }
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
      const width = project.orientation === 'PORTRAIT' ? 2160 : 3840;
      const height = project.orientation === 'PORTRAIT' ? 3840 : 2160;

      for (const scene of scenesWithSsml) {
        // Skip if image already generated
        if (scene.imagePath && fs.existsSync(scene.imagePath)) {
          continue;
        }
        const imagePath = path.join(
          imageDir,
          `${filePrefix}_scene_${scene.order}.jpg`,
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

      // Step 6: Generate TTS using prosody segments for expressive speech
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_TTS',
        'Generating expressive audio with prosody segments...',
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
      let hasCompleteWordBoundaries = true;
      const globalWordBoundaries: SubtitleWordBoundary[] = [];
      const HNS_PER_MS = 10000;

      const scenesWithImages = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      this.logger.log(
        `Starting TTS generation for ${scenesWithImages.length} scenes`,
      );
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_TTS',
        `Starting TTS generation for ${scenesWithImages.length} scenes...`,
      );

      for (const scene of scenesWithImages) {
        this.logger.log(
          `Processing scene ${scene.order}/${scenesWithImages.length}`,
        );

        // Skip if audio already generated
        if (scene.audioPath && fs.existsSync(scene.audioPath)) {
          this.logger.log(`Scene ${scene.order} already has audio, skipping`);
          currentTime = scene.endTimeMs || currentTime;
          hasCompleteWordBoundaries = false;
          continue;
        }
        const audioPath = path.join(
          audioDir,
          `${filePrefix}_scene_${scene.order}.mp3`,
        );

        let result;
        let lastError;
        const maxRetries = 3;

        // Retry mechanism for TTS generation
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await this.logMessage(
              projectId,
              'INFO',
              'GENERATING_TTS',
              `Generating audio for scene ${scene.order}/${scenesWithImages.length} (attempt ${attempt}/${maxRetries})...`,
            );

            // Check if prosody data exists
            if (scene.prosodyData) {
              try {
                const prosodySegments = JSON.parse(scene.prosodyData as string);
                // Use prosody-based speech generation
                result = await this.ttsService.generateSpeechWithProsody(
                  prosodySegments,
                  project.speakerCode,
                  audioPath,
                );
              } catch (parseError) {
                this.logger.warn(
                  `Prosody parsing failed for scene ${scene.order}: ${parseError.message}`,
                );
                // Fallback to regular speech if prosody parsing fails
                result = await this.ttsService.generateSpeech(
                  scene.narration,
                  project.speakerCode,
                  audioPath,
                  false,
                );
              }
            } else {
              // Fallback to regular speech generation
              result = await this.ttsService.generateSpeech(
                scene.narration,
                project.speakerCode,
                audioPath,
                false,
              );
            }

            // Success - break retry loop
            break;
          } catch (error) {
            lastError = error;
            this.logger.error(
              `TTS generation failed for scene ${scene.order} (attempt ${attempt}/${maxRetries}): ${error.message}`,
            );

            if (attempt < maxRetries) {
              await this.logMessage(
                projectId,
                'WARN',
                'GENERATING_TTS',
                `TTS failed for scene ${scene.order}, retrying (${attempt}/${maxRetries})...`,
              );
              // Wait before retry (exponential backoff)
              await new Promise((resolve) =>
                setTimeout(resolve, 2000 * attempt),
              );
            }
          }
        }

        // If all retries failed, throw error
        if (!result) {
          await this.logMessage(
            projectId,
            'ERROR',
            'GENERATING_TTS',
            `Failed to generate TTS for scene ${scene.order} after ${maxRetries} attempts: ${lastError?.message}`,
          );
          throw new Error(
            `TTS generation failed for scene ${scene.order}: ${lastError?.message}`,
          );
        }

        const sceneStartMs = currentTime;

        await this.prisma.storyScene.update({
          where: { id: scene.id },
          data: {
            audioPath,
            startTimeMs: sceneStartMs,
            endTimeMs: sceneStartMs + result.durationMs,
          },
        });

        currentTime += result.durationMs;

        if (result.wordBoundaries?.length) {
          const sceneStartHns = Math.round(sceneStartMs * HNS_PER_MS);
          result.wordBoundaries.forEach((boundary) => {
            globalWordBoundaries.push({
              text: boundary.text,
              offset: boundary.offset + sceneStartHns,
              duration: boundary.duration,
            });
          });
        } else {
          hasCompleteWordBoundaries = false;
        }
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
          `${filePrefix}_scene_${scene.order}.mp4`,
        );

        // Pass animation data to ffmpeg service
        await this.ffmpegService.createSceneVideo(
          scene.imagePath,
          scene.audioPath,
          sceneVideoPath,
          {
            animationIn: scene.animationIn,
            animationShow: scene.animationShow,
            animationOut: scene.animationOut,
          },
        );
        sceneVideos.push(sceneVideoPath);
      }

      const finalVideoPath = path.join(videoOutputDir, `${filePrefix}.mp4`);
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
      const srtPath = path.join(srtOutputDir, `${filePrefix}.srt`);

      let srtContent: string;
      if (hasCompleteWordBoundaries && globalWordBoundaries.length > 0) {
        globalWordBoundaries.sort((a, b) => a.offset - b.offset);
        srtContent = createSRT(globalWordBoundaries);
      } else {
        const subtitles = updatedScenes.map((scene, index) => ({
          index: index + 1,
          startTime: SrtGenerator.msToSrtTime(scene.startTimeMs),
          endTime: SrtGenerator.msToSrtTime(scene.endTimeMs),
          text: scene.narration,
        }));
        srtContent = SrtGenerator.generateSrt(subtitles);
      }

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
    // Save to database
    const log = await this.prisma.storyLog.create({
      data: {
        projectId,
        level,
        code,
        message,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });

    // Emit SSE event for real-time updates
    this.logsService.emitLog({
      projectId,
      level,
      code,
      message,
      meta,
      timestamp: log.createdAt,
    });

    return log;
  }
}
