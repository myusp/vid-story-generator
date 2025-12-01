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
import { TtsQueueService } from '../../common/tts/tts-queue.service';
import type { SubtitleWordBoundary } from '../../common/tts/tts.service';
import { textToProsodySegments } from '../../common/utils/punctuation-splitter';
import pMap from 'p-map';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private aiService: AiService,
    private ttsService: TtsService,
    private ttsQueueService: TtsQueueService,
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
        contentType: dto.contentType || 'story',
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

      // Step 2.5: Generate character descriptions if not already done (skip for educational content)
      // Use updated project data for topic if it was changed
      const contentType = project.contentType || 'story';
      let characterDescriptions = updatedProject?.characterDescriptions;
      const topicForCharacters = updatedProject?.topic || project.topic;

      // Only generate character descriptions for story content, not educational
      if (!characterDescriptions && contentType === 'story') {
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
          characterDescriptions, // Pass character descriptions for consistency (null for educational)
          contentType, // Pass content type for appropriate image prompt generation
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

        // Update scenes with prosody data (punctuation-based) and generate animations
        for (const scene of scenesWithoutProsody) {
          // Use punctuation-based splitting instead of AI for prosody segments
          const prosodyData = textToProsodySegments(scene.narration);

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

      // Step 5 & 6: Generate images and audio concurrently
      // Both can run in parallel, but audio must be queued globally
      await this.logMessage(
        projectId,
        'INFO',
        'GENERATING_MEDIA',
        'Generating images and audio concurrently...',
      );
      await this.prisma.storyProject.update({
        where: { id: projectId },
        data: { status: StoryStatus.GENERATING_IMAGES },
      });

      const scenesForMedia = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      // Create project-specific directories (folder-based naming)
      const baseImageDir = this.configService.get<string>(
        'IMAGE_OUTPUT_DIR',
        './storage/images',
      );
      const baseAudioDir = this.configService.get<string>(
        'AUDIO_OUTPUT_DIR',
        './storage/audio',
      );
      const projectImageDir = path.join(baseImageDir, filePrefix);
      const projectAudioDir = path.join(baseAudioDir, filePrefix);

      // Ensure project directories exist
      if (!fs.existsSync(projectImageDir)) {
        fs.mkdirSync(projectImageDir, { recursive: true });
      }
      if (!fs.existsSync(projectAudioDir)) {
        fs.mkdirSync(projectAudioDir, { recursive: true });
      }

      const width = project.orientation === 'PORTRAIT' ? 2160 : 3840;
      const height = project.orientation === 'PORTRAIT' ? 3840 : 2160;

      // Get concurrency from env, default to 4
      const concurrencyValue = parseInt(
        this.configService.get<string>('IMAGE_DOWNLOAD_CONCURRENCY', '4'),
        10,
      );
      const imageConcurrency =
        !isNaN(concurrencyValue) && concurrencyValue > 0 ? concurrencyValue : 4;

      // Prepare word boundaries storage for SRT
      let hasCompleteWordBoundaries = true;
      const globalWordBoundaries: SubtitleWordBoundary[] = [];
      const HNS_PER_MS = 10000;

      // Filter scenes that need image or audio generation
      const scenesNeedingImages = scenesForMedia.filter(
        (scene) => !scene.imagePath || !fs.existsSync(scene.imagePath),
      );
      const scenesNeedingAudio = scenesForMedia.filter(
        (scene) => !scene.audioPath || !fs.existsSync(scene.audioPath),
      );

      // Run image and audio generation concurrently
      const [, audioResults] = await Promise.all([
        // Image generation (concurrent with p-map)
        (async () => {
          if (scenesNeedingImages.length === 0) return [];

          await this.logMessage(
            projectId,
            'INFO',
            'GENERATING_IMAGES',
            `Generating ${scenesNeedingImages.length} images...`,
          );

          return pMap(
            scenesNeedingImages,
            async (scene) => {
              const imagePath = path.join(
                projectImageDir,
                `scene_${scene.order}.jpg`,
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
              return { sceneId: scene.id, imagePath };
            },
            { concurrency: imageConcurrency },
          );
        })(),

        // Audio generation (queued globally to prevent conflicts)
        (async () => {
          if (scenesNeedingAudio.length === 0) return [];

          await this.prisma.storyProject.update({
            where: { id: projectId },
            data: { status: StoryStatus.GENERATING_TTS },
          });

          await this.logMessage(
            projectId,
            'INFO',
            'GENERATING_TTS',
            `Generating audio for ${scenesNeedingAudio.length} scenes (queued)...`,
          );

          // Use the TTS queue to process audio sequentially across all projects
          return this.ttsQueueService.enqueue(
            `project-${projectId}-audio`,
            async () => {
              const results: Array<{
                sceneId: string;
                audioPath: string;
                durationMs: number;
                wordBoundaries: SubtitleWordBoundary[];
              }> = [];

              for (const scene of scenesNeedingAudio) {
                const audioPath = path.join(
                  projectAudioDir,
                  `scene_${scene.order}.mp3`,
                );

                let result;
                let lastError;
                const maxRetries = 3;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  try {
                    await this.logMessage(
                      projectId,
                      'INFO',
                      'GENERATING_TTS',
                      `Generating audio for scene ${scene.order}/${scenesNeedingAudio.length} (attempt ${attempt}/${maxRetries})...`,
                    );

                    if (scene.prosodyData) {
                      try {
                        const prosodySegments = JSON.parse(
                          scene.prosodyData as string,
                        );
                        result =
                          await this.ttsService.generateSpeechWithProsody(
                            prosodySegments,
                            project.speakerCode,
                            audioPath,
                          );
                      } catch (parseError) {
                        this.logger.warn(
                          `Prosody parsing failed for scene ${scene.order}: ${parseError.message}`,
                        );
                        result = await this.ttsService.generateSpeech(
                          scene.narration,
                          project.speakerCode,
                          audioPath,
                          false,
                        );
                      }
                    } else {
                      result = await this.ttsService.generateSpeech(
                        scene.narration,
                        project.speakerCode,
                        audioPath,
                        false,
                      );
                    }
                    break;
                  } catch (error) {
                    lastError = error;
                    this.logger.error(
                      `TTS generation failed for scene ${scene.order} (attempt ${attempt}/${maxRetries}): ${error.message}`,
                    );
                    if (attempt < maxRetries) {
                      await new Promise((resolve) =>
                        setTimeout(resolve, 2000 * attempt),
                      );
                    }
                  }
                }

                if (!result) {
                  throw new Error(
                    `TTS generation failed for scene ${scene.order}: ${lastError?.message}`,
                  );
                }

                results.push({
                  sceneId: scene.id,
                  audioPath,
                  durationMs: result.durationMs,
                  wordBoundaries: result.wordBoundaries || [],
                });
              }
              return results;
            },
          );
        })(),
      ]);

      // Update scene timing data from audio results
      let currentTime = 0;
      const orderedScenes = scenesForMedia.sort((a, b) => a.order - b.order);

      for (const scene of orderedScenes) {
        // Check if scene already has timing from previous run
        if (scene.startTimeMs !== null && scene.endTimeMs !== null) {
          currentTime = scene.endTimeMs;
          hasCompleteWordBoundaries = false;
          continue;
        }

        // Find audio result for this scene
        const audioResult = audioResults.find((r) => r.sceneId === scene.id);
        if (audioResult) {
          const sceneStartMs = currentTime;
          await this.prisma.storyScene.update({
            where: { id: scene.id },
            data: {
              audioPath: audioResult.audioPath,
              startTimeMs: sceneStartMs,
              endTimeMs: sceneStartMs + audioResult.durationMs,
            },
          });

          currentTime += audioResult.durationMs;

          if (audioResult.wordBoundaries.length > 0) {
            const sceneStartHns = Math.round(sceneStartMs * HNS_PER_MS);
            audioResult.wordBoundaries.forEach((boundary) => {
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

      const baseTmpDir = this.configService.get<string>(
        'VIDEO_TMP_DIR',
        './storage/tmp',
      );
      const baseVideoOutputDir = this.configService.get<string>(
        'VIDEO_OUTPUT_DIR',
        './storage/videos',
      );

      // Create project-specific temp directory
      const projectTmpDir = path.join(baseTmpDir, filePrefix);
      if (!fs.existsSync(projectTmpDir)) {
        fs.mkdirSync(projectTmpDir, { recursive: true });
      }

      const sceneVideos = [];

      const updatedScenes = await this.prisma.storyScene.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      });

      for (const scene of updatedScenes) {
        const sceneVideoPath = path.join(
          projectTmpDir,
          `scene_${scene.order}.mp4`,
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

      // Create project-specific video output directory
      const projectVideoOutputDir = path.join(baseVideoOutputDir, filePrefix);
      if (!fs.existsSync(projectVideoOutputDir)) {
        fs.mkdirSync(projectVideoOutputDir, { recursive: true });
      }
      const finalVideoPath = path.join(projectVideoOutputDir, `video.mp4`);
      await this.ffmpegService.concatenateVideos(sceneVideos, finalVideoPath);

      // Cleanup temp files and directory
      for (const videoPath of sceneVideos) {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      }
      // Try to remove temp directory if empty
      try {
        fs.rmdirSync(projectTmpDir);
      } catch {
        // Ignore if not empty or other errors
      }

      // Step 8: Generate SRT
      const baseSrtOutputDir = this.configService.get<string>(
        'SRT_OUTPUT_DIR',
        './storage/subtitles',
      );
      const projectSrtDir = path.join(baseSrtOutputDir, filePrefix);
      if (!fs.existsSync(projectSrtDir)) {
        fs.mkdirSync(projectSrtDir, { recursive: true });
      }
      const srtPath = path.join(projectSrtDir, `subtitle.srt`);

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
