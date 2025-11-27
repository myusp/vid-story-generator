import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export interface SceneFragment {
  imagePath: string;
  audioPath: string;
  durationMs: number;
  animationIn?: string;
  animationShow?: string;
  animationOut?: string;
}

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly VIDEO_FPS = 30; // Default frame rate for video rendering

  constructor(private configService: ConfigService) {}

  /**
   * Create scene video with Ken Burns effects and transitions
   */
  async createSceneVideo(
    imagePath: string,
    audioPath: string,
    outputPath: string,
    animations?: {
      animationIn?: string;
      animationShow?: string;
      animationOut?: string;
    },
  ): Promise<{ path: string; durationMs: number }> {
    return new Promise((resolve, reject) => {
      // Get audio duration first to calculate video length
      ffmpeg.ffprobe(audioPath, (err, audioMetadata) => {
        if (err) {
          reject(err);
          return;
        }

        const audioDuration = audioMetadata.format.duration || 3;

        // Build complex filter for animations
        const filters = this.buildAnimationFilters(animations, audioDuration);

        this.logger.log(`Creating scene video with filters: ${filters}`);

        const command = ffmpeg()
          .input(imagePath)
          .loop(Math.ceil(audioDuration) + 1) // Loop image for the duration (ensure integer)
          .input(audioPath)
          .complexFilter(filters)
          .outputOptions([
            '-map',
            '[v]', // Use filtered video
            '-map',
            '1:a', // Use audio from second input
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-pix_fmt',
            'yuv420p',
            '-shortest',
          ])
          .output(outputPath);

        command
          .on('end', () => {
            // Get final duration
            ffmpeg.ffprobe(outputPath, (err, metadata) => {
              if (err) {
                reject(err);
              } else {
                const durationMs = (metadata.format.duration || 0) * 1000;
                this.logger.log(
                  `Scene video created: ${outputPath} (${durationMs}ms)`,
                );
                resolve({ path: outputPath, durationMs });
              }
            });
          })
          .on('error', (err) => {
            this.logger.error(`FFmpeg error: ${err.message}`);
            reject(err);
          })
          .run();
      });
    });
  }

  /**
   * Build FFmpeg complex filter for animations
   * Supports:
   * - animationIn: fade, slide-left, slide-right, slide-up, slide-down, zoom-in, zoom-out, none
   * - animationShow: pan-left, pan-right, pan-up, pan-down, zoom-slow, zoom-in, zoom-out, static
   * - animationOut: fade, slide-left, slide-right, slide-up, slide-down, zoom-in, zoom-out, none
   */
  private buildAnimationFilters(
    animations:
      | {
          animationIn?: string;
          animationShow?: string;
          animationOut?: string;
        }
      | undefined,
    duration: number,
  ): string {
    const filters: string[] = [];
    const fps = this.VIDEO_FPS;
    const totalFrames = Math.floor(duration * fps);
    const transitionFrames = Math.floor(0.5 * fps); // 0.5 seconds for transitions

    // Scale and pad image to proper size (1080x1920 for portrait), ensure we have enough frames
    filters.push(
      `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=${fps}[scaled]`,
    );

    if (
      !animations ||
      (!animations.animationIn &&
        !animations.animationShow &&
        !animations.animationOut)
    ) {
      // No animations - just return scaled video with proper timing
      filters.push('[scaled]setpts=PTS-STARTPTS[v]');
      return filters.join(';');
    }

    let currentFilter = 'scaled';
    let filterIndex = 0;

    // Apply Ken Burns / pan/zoom animation during main show
    if (
      animations.animationShow &&
      animations.animationShow !== 'none' &&
      animations.animationShow !== 'static'
    ) {
      const kenBurnsFilter = this.getKenBurnsFilter(
        animations.animationShow,
        duration,
      );
      if (kenBurnsFilter) {
        filterIndex++;
        filters.push(`[${currentFilter}]${kenBurnsFilter}[kb${filterIndex}]`);
        currentFilter = `kb${filterIndex}`;
      }
    }

    // Apply entrance animation
    if (animations.animationIn && animations.animationIn !== 'none') {
      filterIndex++;
      const filterName = `in${filterIndex}`;

      if (animations.animationIn === 'fade') {
        // Fade in
        filters.push(`[${currentFilter}]fade=t=in:st=0:d=0.5[${filterName}]`);
        currentFilter = filterName;
      } else if (animations.animationIn.startsWith('slide-')) {
        // Slide entrance using crop/overlay technique
        const slideFilter = this.getSlideEntranceFilter(
          animations.animationIn,
          transitionFrames,
        );
        if (slideFilter) {
          filters.push(`[${currentFilter}]${slideFilter}[${filterName}]`);
          currentFilter = filterName;
        }
      } else if (animations.animationIn === 'zoom-in') {
        // Zoom in entrance (start small, end normal)
        filters.push(
          `[${currentFilter}]scale=iw*if(lt(n,${transitionFrames}),0.7+0.3*n/${transitionFrames},1):ih*if(lt(n,${transitionFrames}),0.7+0.3*n/${transitionFrames},1),pad=1080:1920:(ow-iw)/2:(oh-ih)/2[${filterName}]`,
        );
        currentFilter = filterName;
      } else if (animations.animationIn === 'zoom-out') {
        // Zoom out entrance (start large, end normal)
        filters.push(
          `[${currentFilter}]scale=iw*if(lt(n,${transitionFrames}),1.3-0.3*n/${transitionFrames},1):ih*if(lt(n,${transitionFrames}),1.3-0.3*n/${transitionFrames},1),pad=1080:1920:(ow-iw)/2:(oh-ih)/2[${filterName}]`,
        );
        currentFilter = filterName;
      }
    }

    // Apply exit animation
    if (animations.animationOut && animations.animationOut !== 'none') {
      filterIndex++;
      const filterName = `out${filterIndex}`;
      const exitStart = Math.max(0, duration - 0.5);

      if (animations.animationOut === 'fade') {
        // Fade out
        filters.push(
          `[${currentFilter}]fade=t=out:st=${exitStart}:d=0.5[${filterName}]`,
        );
        currentFilter = filterName;
      } else if (animations.animationOut.startsWith('slide-')) {
        // Slide exit
        const slideFilter = this.getSlideExitFilter(
          animations.animationOut,
          totalFrames,
          transitionFrames,
        );
        if (slideFilter) {
          filters.push(`[${currentFilter}]${slideFilter}[${filterName}]`);
          currentFilter = filterName;
        }
      } else if (animations.animationOut === 'zoom-in') {
        // Zoom in exit (normal to large, often with fade)
        filters.push(
          `[${currentFilter}]fade=t=out:st=${exitStart}:d=0.5[${filterName}]`,
        );
        currentFilter = filterName;
      } else if (animations.animationOut === 'zoom-out') {
        // Zoom out exit (normal to small, often with fade)
        filters.push(
          `[${currentFilter}]fade=t=out:st=${exitStart}:d=0.5[${filterName}]`,
        );
        currentFilter = filterName;
      }
    }

    // Final setpts to reset timestamps
    filters.push(`[${currentFilter}]setpts=PTS-STARTPTS[v]`);

    return filters.join(';');
  }

  /**
   * Get slide entrance filter for entrance animations
   * Uses fade effect for reliability as slide animations can be complex with ffmpeg
   */
  private getSlideEntranceFilter(
    animation: string,
    transitionFrames: number,
  ): string | null {
    // For slide animations, we use fade-in for reliability
    // Complex slide transitions can cause rendering issues
    const fadeInDuration = transitionFrames / this.VIDEO_FPS;

    switch (animation) {
      case 'slide-left':
      case 'slide-right':
      case 'slide-up':
      case 'slide-down':
        // Use fade-in for reliable entrance
        return `fade=t=in:st=0:d=${fadeInDuration}`;
      default:
        return null;
    }
  }

  /**
   * Get slide exit filter
   * Note: Slide exit animations are complex with ffmpeg and may cause rendering issues.
   * For reliability, we use fade transitions for exit animations.
   */
  private getSlideExitFilter(
    _animation: string,
    totalFrames: number,
    transitionFrames: number,
  ): string | null {
    // For all exit animations, we use fade for reliability
    // Full slide exits are complex and may not work smoothly with all content
    return `fade=t=out:st=${(totalFrames - transitionFrames) / this.VIDEO_FPS}:d=${transitionFrames / this.VIDEO_FPS}`;
  }

  /**
   * Get Ken Burns effect filter
   * Supports: pan-left, pan-right, pan-up, pan-down, zoom-slow, zoom-in, zoom-out, static
   * Also supports slide transitions: slide-left, slide-right, slide-up, slide-down
   */
  private getKenBurnsFilter(
    animation: string,
    duration: number,
  ): string | null {
    const fps = this.VIDEO_FPS;
    const frames = Math.floor(duration * fps);

    switch (animation) {
      case 'pan-left':
        // Pan from right to left - start at right edge, end at left edge
        return `zoompan=z='1.2':x='iw-(iw/zoom-iw)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-right':
        // Pan from left to right - start at left edge, end at right edge
        return `zoompan=z='1.2':x='(iw/zoom-iw)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-up':
        // Pan from bottom to top
        return `zoompan=z='1.2':x='(iw-iw/zoom)/2':y='ih-(ih/zoom-ih)*on/${frames}':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-down':
        // Pan from top to bottom
        return `zoompan=z='1.2':x='(iw-iw/zoom)/2':y='(ih/zoom-ih)*on/${frames}':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-slow':
        // Slow zoom in (1.0 -> 1.15)
        return `zoompan=z='min(1.0+0.15*on/${frames},1.15)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-in':
        // Faster zoom in (1.0 -> 1.3)
        return `zoompan=z='min(1.0+0.3*on/${frames},1.3)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-out':
        // Zoom out (1.3 -> 1.0)
        return `zoompan=z='max(1.3-0.3*on/${frames},1.0)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'static':
      default:
        // No movement - just display image at center
        return null;
    }
  }

  async concatenateVideos(
    videoPaths: string[],
    outputPath: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const listFilePath = path.join(path.dirname(outputPath), 'filelist.txt');

      // Create file list for ffmpeg concat
      const fileList = videoPaths
        .map((p) => `file '${path.resolve(p)}'`)
        .join('\n');
      fs.writeFileSync(listFilePath, fileList);

      ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(outputPath)
        .on('end', () => {
          fs.unlinkSync(listFilePath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          if (fs.existsSync(listFilePath)) {
            fs.unlinkSync(listFilePath);
          }
          reject(err);
        })
        .run();
    });
  }

  async getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve((metadata.format.duration || 0) * 1000);
        }
      });
    });
  }
}
