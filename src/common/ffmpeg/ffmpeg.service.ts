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
  // Use 24fps - cinematic standard, absolutely smooth for zoom/pan
  // Lower fps = smoother zoompan calculations, zero micro-stuttering
  private readonly VIDEO_FPS = 24;

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
            'slower', // Use 'slower' for maximum quality and stability
            '-crf',
            '18', // Very high quality (lower = better)
            '-profile:v',
            'high', // Use high profile for better compression
            '-tune',
            'film', // Optimize for high quality film content
            '-x264-params',
            'keyint=48:min-keyint=24:ref=5', // Keyframe interval for 24fps (2 seconds), more refs
            '-bf',
            '3', // 3 B-frames for smoother playback
            '-movflags',
            '+faststart', // Enable fast start for web playback
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
    const fps = this.VIDEO_FPS;
    const transitionDuration = 0.5; // 0.5 seconds for transitions

    // Calculate actual animation duration (subtract transition times)
    const hasIn = animations?.animationIn && animations.animationIn !== 'none';
    const hasOut =
      animations?.animationOut && animations.animationOut !== 'none';
    const effectiveDuration =
      duration -
      (hasIn ? transitionDuration : 0) -
      (hasOut ? transitionDuration : 0);

    // Start with scaling and padding
    // CRITICAL FIX for 4K→FHD shaking:
    // 1. Scale to EXACT 1080x1920 first (no decrease/padding yet) using best quality algo
    // 2. Apply format=yuv420p for consistent subsampling
    // 3. Then apply zoompan on already-downscaled image to prevent pixel rounding jitter
    // Using bicubic instead of lanczos - faster and actually smoother for video
    let filterChain = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=bicubic,crop=1080:1920,setsar=1,format=yuv420p,fps=${fps}`;

    // If no animations, keep it simple - NO minterpolate to avoid shaking
    if (
      !animations ||
      (!animations.animationIn &&
        !animations.animationShow &&
        !animations.animationOut)
    ) {
      filterChain += ',setpts=PTS-STARTPTS[v]';
      return filterChain;
    }

    // Apply Ken Burns / pan/zoom animation during main show
    // Use effective duration to avoid animation finishing before audio
    if (
      animations.animationShow &&
      animations.animationShow !== 'none' &&
      animations.animationShow !== 'static'
    ) {
      const kenBurnsFilter = this.getKenBurnsFilter(
        animations.animationShow,
        effectiveDuration,
      );
      if (kenBurnsFilter) {
        filterChain += ',' + kenBurnsFilter;
      }
    }

    // Apply entrance animation (fade in)
    if (animations.animationIn && animations.animationIn !== 'none') {
      if (
        animations.animationIn === 'fade' ||
        animations.animationIn.startsWith('slide-')
      ) {
        filterChain += `,fade=t=in:st=0:d=${transitionDuration}`;
      } else if (animations.animationIn === 'zoom-in') {
        // For zoom-in entrance, we'll use scale with conditional
        // This is simpler than complex zoompan
        filterChain += `,fade=t=in:st=0:d=${transitionDuration}`;
      } else if (animations.animationIn === 'zoom-out') {
        filterChain += `,fade=t=in:st=0:d=${transitionDuration}`;
      }
    }

    // Apply exit animation (fade out)
    if (animations.animationOut && animations.animationOut !== 'none') {
      const exitStart = Math.max(0, duration - transitionDuration);
      if (
        animations.animationOut === 'fade' ||
        animations.animationOut.startsWith('slide-')
      ) {
        filterChain += `,fade=t=out:st=${exitStart}:d=${transitionDuration}`;
      } else if (
        animations.animationOut === 'zoom-in' ||
        animations.animationOut === 'zoom-out'
      ) {
        filterChain += `,fade=t=out:st=${exitStart}:d=${transitionDuration}`;
      }
    }

    // Final setpts to reset timestamps
    filterChain += ',setpts=PTS-STARTPTS[v]';

    return filterChain;
  }

  /**
   * Get Ken Burns effect filter
   * Based on Stack Overflow solution: https://stackoverflow.com/questions/36499930/ffmpeg-zoom-not-smooth-centered-but-zigzag
   * Uses min(zoom+increment,max) for smooth frame-by-frame progression instead of time-based easing
   * Key: increment = (final_zoom - initial_zoom) / total_frames
   * This eliminates jitter/zigzag by using linear per-frame increments
   */
  private getKenBurnsFilter(
    animation: string,
    duration: number,
  ): string | null {
    const fps = this.VIDEO_FPS;
    const frames = Math.floor(duration * fps);

    // Calculate zoom increments per frame for smooth progression
    // Formula: (max_zoom - min_zoom) / frames
    const zoomSlowIncrement = 0.04 / frames; // 1.0 → 1.04
    const zoomInIncrement = 0.08 / frames; // 1.0 → 1.08
    const zoomOutDecrement = 0.1 / frames; // 1.1 → 1.0

    // Pan increment per frame (for 5% zoom overpan)
    // x range: 0 to (iw-iw/1.05) = smooth left-to-right motion
    const panIncrement = 1.0 / frames;

    switch (animation) {
      case 'pan-left': {
        // Pan from right to left with constant 1.05x zoom
        // x starts at max (right), decrements to 0 (left)
        return `zoompan=z=1.05:x='(iw-iw/zoom)*(1-${panIncrement}*on)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }

      case 'pan-right': {
        // Pan from left to right
        // x starts at 0 (left), increments to max (right)
        return `zoompan=z=1.05:x='(iw-iw/zoom)*(${panIncrement}*on)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }

      case 'pan-up': {
        // Pan from bottom to top, centered horizontally
        return `zoompan=z=1.05:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${panIncrement}*on)':d=${frames}:s=1080x1920`;
      }

      case 'pan-down': {
        // Pan from top to bottom
        return `zoompan=z=1.05:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(${panIncrement}*on)':d=${frames}:s=1080x1920`;
      }

      case 'zoom-slow': {
        // Smooth zoom 1.0 → 1.04 using min() to clamp at final zoom
        return `zoompan=z='min(zoom+${zoomSlowIncrement},1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }

      case 'zoom-in': {
        // Smooth zoom 1.0 → 1.08 using min() to clamp
        return `zoompan=z='min(zoom+${zoomInIncrement},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }

      case 'zoom-out': {
        // Smooth zoom out 1.1 → 1.0 using max() to clamp at 1.0
        return `zoompan=z='max(zoom-${zoomOutDecrement},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }

      case 'static':
      default: {
        // Static frame, centered
        return `zoompan=z=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920`;
      }
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
