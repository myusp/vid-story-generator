import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export interface SceneFragment {
  imagePath: string;
  audioPath: string;
  durationMs: number;
}

@Injectable()
export class FfmpegService {
  constructor(private configService: ConfigService) {}

  async createSceneVideo(
    imagePath: string,
    audioPath: string,
    outputPath: string,
  ): Promise<{ path: string; durationMs: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .loop(10) // Loop the image
        .input(audioPath)
        .outputOptions([
          '-c:v libx264',
          '-tune stillimage',
          '-c:a aac',
          '-b:a 192k',
          '-pix_fmt yuv420p',
          '-shortest',
        ])
        .output(outputPath)
        .on('end', () => {
          // Get duration
          ffmpeg.ffprobe(outputPath, (err, metadata) => {
            if (err) {
              reject(err);
            } else {
              const durationMs = (metadata.format.duration || 0) * 1000;
              resolve({ path: outputPath, durationMs });
            }
          });
        })
        .on('error', (err) => {
          reject(err);
        })
        .run();
    });
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
