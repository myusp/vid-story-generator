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

  constructor(private configService: ConfigService) {
    // Set FFmpeg and FFprobe paths for Docker environment
    // In Debian-based image, binaries are in /usr/bin
    // const ffmpegPath = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
    // const ffprobePath = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
    // ffmpeg.setFfmpegPath(ffmpegPath);
    // ffmpeg.setFfprobePath(ffprobePath);
    // this.logger.log(`FFmpeg path set to: ${ffmpegPath}`);
    // this.logger.log(`FFprobe path set to: ${ffprobePath}`);
  }

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
    const transitionDuration = 0.4; // Reduced from 0.5 to 0.4 for snappier transitions

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
    // 1. Scale to EXACT 1080x1920 first using high-quality lanczos algorithm
    // 2. Apply format=yuv420p for consistent subsampling
    // 3. Use exact fps to prevent frame timing issues
    // 4. Apply zoompan on already-downscaled image to prevent pixel rounding jitter
    // Using lanczos for best quality and smoothest scaling
    let filterChain = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,format=yuv420p,fps=${fps}`;

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
        // Standard linear fade
        filterChain += `,fade=t=in:st=0:d=${transitionDuration}`;
      } else if (animations.animationIn === 'zoom-in') {
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
        // Standard linear fade
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
   *
   * SMOOTH TRANSITION FIX:
   * - Reduced zoom ranges to minimize shaking (smaller movements = smoother)
   * - Using consistent pan increment calculations
   * - Fixed zoom values to prevent floating-point precision issues
   */
  private getKenBurnsFilter(
    animation: string,
    duration: number,
  ): string | null {
    const fps = this.VIDEO_FPS;
    const frames = Math.floor(duration * fps);

    // Use smaller zoom ranges for smoother, less shaky animations
    // Reduced from 0.04-0.1 to 0.02-0.05 for subtler, smoother movements
    const zoomSlowIncrement = 0.02 / frames; // 1.0 → 1.02 (was 1.04)
    const zoomInIncrement = 0.04 / frames; // 1.0 → 1.04 (was 1.08)
    const zoomOutDecrement = 0.05 / frames; // 1.05 → 1.0 (was 1.1 → 1.0)

    // Pan increment per frame - use consistent small zoom for panning
    // Smaller zoom (1.03) reduces shaking while still allowing pan movement
    const panIncrement = 1.0 / frames;

    switch (animation) {
      case 'pan-left': {
        // Pan from right to left with constant 1.03x zoom (reduced from 1.05)
        // x starts at max (right), decrements to 0 (left)
        return `zoompan=z=1.03:x='(iw-iw/zoom)*(1-${panIncrement}*on)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'pan-right': {
        // Pan from left to right
        // x starts at 0 (left), increments to max (right)
        return `zoompan=z=1.03:x='(iw-iw/zoom)*(${panIncrement}*on)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'pan-up': {
        // Pan from bottom to top, centered horizontally
        return `zoompan=z=1.03:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${panIncrement}*on)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'pan-down': {
        // Pan from top to bottom
        return `zoompan=z=1.03:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(${panIncrement}*on)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'zoom-slow': {
        // Smooth zoom 1.0 → 1.02 using min() to clamp at final zoom
        return `zoompan=z='min(zoom+${zoomSlowIncrement},1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'zoom-in': {
        // Smooth zoom 1.0 → 1.04 using min() to clamp
        return `zoompan=z='min(zoom+${zoomInIncrement},1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'zoom-out': {
        // Smooth zoom out 1.05 → 1.0 using max() to clamp at 1.0
        return `zoompan=z='max(1.05-${zoomOutDecrement}*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
      }

      case 'static':
      default: {
        // Static frame, centered
        return `zoompan=z=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`;
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
