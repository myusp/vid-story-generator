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
          .loop(audioDuration + 1) // Loop image for the duration
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

    // Scale and pad image to proper size (1080x1920 for portrait)
    filters.push(
      '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[scaled]',
    );

    if (
      !animations ||
      (!animations.animationIn &&
        !animations.animationShow &&
        !animations.animationOut)
    ) {
      // No animations - just return scaled video
      filters.push('[scaled]setpts=PTS-STARTPTS[v]');
      return filters.join(';');
    }

    // Calculate transition timings
    const fadeInDuration = 0.5; // 0.5 seconds for fade in
    const fadeOutDuration = 0.5; // 0.5 seconds for fade out

    let currentFilter = 'scaled';

    // Apply Ken Burns / pan/zoom animation during main show
    if (animations.animationShow) {
      const kenBurnsFilter = this.getKenBurnsFilter(
        animations.animationShow,
        duration,
      );
      if (kenBurnsFilter) {
        filters.push(`[${currentFilter}]${kenBurnsFilter}[kenburns]`);
        currentFilter = 'kenburns';
      }
    }

    // Apply entrance animation (fade)
    if (animations.animationIn === 'fade') {
      filters.push(
        `[${currentFilter}]fade=t=in:st=0:d=${fadeInDuration}[fadein]`,
      );
      currentFilter = 'fadein';
    }

    // Apply exit animation (fade)
    if (animations.animationOut === 'fade') {
      const fadeOutStart = duration - fadeOutDuration;
      filters.push(
        `[${currentFilter}]fade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[fadeout]`,
      );
      currentFilter = 'fadeout';
    }

    // Final setpts
    filters.push(`[${currentFilter}]setpts=PTS-STARTPTS[v]`);

    return filters.join(';');
  }

  /**
   * Get Ken Burns effect filter
   */
  private getKenBurnsFilter(
    animation: string,
    duration: number,
  ): string | null {
    const fps = 30;
    const frames = Math.floor(duration * fps);

    switch (animation) {
      case 'pan-left':
        // Pan from right to left
        return `zoompan=z='1.0':x='iw/zoom/2-(iw/zoom/2-iw/2)*on/${frames}':y='ih/zoom/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-right':
        // Pan from left to right
        return `zoompan=z='1.0':x='iw/zoom/2+(iw/zoom/2-iw/2)*on/${frames}':y='ih/zoom/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-up':
        // Pan from bottom to top
        return `zoompan=z='1.0':x='iw/zoom/2':y='ih/zoom/2-(ih/zoom/2-ih/2)*on/${frames}':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'pan-down':
        // Pan from top to bottom
        return `zoompan=z='1.0':x='iw/zoom/2':y='ih/zoom/2+(ih/zoom/2-ih/2)*on/${frames}':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-slow':
        // Slow zoom in
        return `zoompan=z='1.0+0.2*on/${frames}':x='iw/zoom/2':y='ih/zoom/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-in':
        // Zoom in effect
        return `zoompan=z='1.0+0.5*on/${frames}':x='iw/zoom/2':y='ih/zoom/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'zoom-out':
        // Zoom out effect
        return `zoompan=z='1.5-0.5*on/${frames}':x='iw/zoom/2':y='ih/zoom/2':d=${frames}:s=1080x1920:fps=${fps}`;

      case 'static':
      default:
        // No movement
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
