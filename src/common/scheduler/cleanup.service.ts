import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly storageBasePath: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    // Get the base storage path for security validation
    this.storageBasePath = path.resolve('./storage');
  }

  onModuleInit() {
    const ttlHours = this.configService.get<number>('ASSET_TTL_HOURS', 0);

    if (ttlHours > 0) {
      this.logger.log(`Asset cleanup enabled with TTL of ${ttlHours} hours`);
      // Run cleanup every hour
      this.cleanupInterval = setInterval(
        () => this.cleanupOldAssets(),
        60 * 60 * 1000,
      );
      // Also run on startup after a short delay
      setTimeout(() => this.cleanupOldAssets(), 10000);
    } else {
      this.logger.log('Asset cleanup disabled (ASSET_TTL_HOURS=0)');
    }

    // Always run stuck process recovery every 5 minutes
    setInterval(() => this.recoverStuckProcesses(), 5 * 60 * 1000);
    // Run once on startup after 30 seconds
    setTimeout(() => this.recoverStuckProcesses(), 30000);
  }

  /**
   * Validate that a file path is within the expected storage directory
   * Prevents path traversal attacks
   */
  private isPathSafe(filePath: string | null | undefined): boolean {
    if (!filePath) return false;
    const resolvedPath = path.resolve(filePath);
    return resolvedPath.startsWith(this.storageBasePath);
  }

  /**
   * Safely delete a file if it exists and is within the storage directory
   */
  private safeDeleteFile(filePath: string | null | undefined): boolean {
    if (!filePath || !this.isPathSafe(filePath)) {
      return false;
    }

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        this.logger.warn(`Failed to delete file: ${filePath}`);
      }
    }
    return false;
  }

  async cleanupOldAssets() {
    const ttlHours = this.configService.get<number>('ASSET_TTL_HOURS', 0);
    if (ttlHours <= 0) return;

    const cutoffDate = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
    this.logger.log(
      `Running cleanup for assets older than ${cutoffDate.toISOString()}`,
    );

    try {
      // Find completed projects older than TTL
      const oldProjects = await this.prisma.storyProject.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: {
            lt: cutoffDate,
          },
        },
        include: {
          scenes: true,
        },
      });

      let deletedCount = 0;

      for (const project of oldProjects) {
        // Delete video file (with path validation)
        if (this.safeDeleteFile(project.videoPath)) {
          deletedCount++;
        }

        // Delete SRT file (with path validation)
        if (this.safeDeleteFile(project.srtPath)) {
          deletedCount++;
        }

        // Delete scene assets (with path validation)
        for (const scene of project.scenes) {
          if (this.safeDeleteFile(scene.imagePath)) {
            deletedCount++;
          }

          if (this.safeDeleteFile(scene.audioPath)) {
            deletedCount++;
          }
        }

        // Clear file paths in database
        await this.prisma.storyProject.update({
          where: { id: project.id },
          data: {
            videoPath: null,
            srtPath: null,
          },
        });

        // Clear scene file paths
        await this.prisma.storyScene.updateMany({
          where: { projectId: project.id },
          data: {
            imagePath: null,
            audioPath: null,
          },
        });
      }

      if (deletedCount > 0) {
        this.logger.log(
          `Cleanup complete: Deleted ${deletedCount} files from ${oldProjects.length} projects`,
        );
      }

      // Also cleanup orphaned tmp files
      await this.cleanupTmpFiles(cutoffDate);
    } catch (error) {
      this.logger.error('Cleanup failed:', error);
    }
  }

  private async cleanupTmpFiles(cutoffDate: Date) {
    const tmpDir = this.configService.get<string>(
      'VIDEO_TMP_DIR',
      './storage/tmp',
    );
    const resolvedTmpDir = path.resolve(tmpDir);

    // Security: Ensure tmp directory is within storage
    if (!resolvedTmpDir.startsWith(this.storageBasePath)) {
      this.logger.warn(
        `Tmp directory ${tmpDir} is outside storage path, skipping cleanup`,
      );
      return;
    }

    if (!fs.existsSync(resolvedTmpDir)) return;

    try {
      const files = fs.readdirSync(resolvedTmpDir);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(resolvedTmpDir, file);

        // Security: Validate file path is within tmp directory
        const resolvedFilePath = path.resolve(filePath);
        if (!resolvedFilePath.startsWith(resolvedTmpDir)) {
          continue;
        }

        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        this.logger.log(`Cleaned up ${deletedCount} temporary files`);
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup tmp files:', error);
    }
  }

  /**
   * Recover stuck processes that have been in progress for too long
   * A process is considered stuck if it's been in a non-terminal status for more than 30 minutes
   */
  async recoverStuckProcesses() {
    try {
      const stuckTimeoutMinutes = 30;
      const cutoffDate = new Date(Date.now() - stuckTimeoutMinutes * 60 * 1000);

      const stuckProjects = await this.prisma.storyProject.findMany({
        where: {
          status: {
            in: [
              'GENERATING_SCENES',
              'GENERATING_IMAGES',
              'GENERATING_TTS',
              'RENDERING_VIDEO',
            ],
          },
          updatedAt: {
            lt: cutoffDate,
          },
        },
      });

      if (stuckProjects.length === 0) {
        return;
      }

      this.logger.warn(
        `Found ${stuckProjects.length} stuck projects, marking as FAILED`,
      );

      for (const project of stuckProjects) {
        this.logger.warn(
          `Recovering stuck project ${project.id} (${project.projectSlug}) - stuck in ${project.status} for ${Math.round((Date.now() - project.updatedAt.getTime()) / 60000)} minutes`,
        );

        await this.prisma.storyProject.update({
          where: { id: project.id },
          data: { status: 'FAILED' },
        });

        // Log the recovery
        await this.prisma.storyLog.create({
          data: {
            projectId: project.id,
            level: 'ERROR',
            code: 'PROCESS_TIMEOUT',
            message: `Process stuck in ${project.status} for more than ${stuckTimeoutMinutes} minutes. Marked as FAILED. You can retry the generation.`,
          },
        });
      }

      this.logger.log(
        `Successfully recovered ${stuckProjects.length} stuck projects`,
      );
    } catch (error) {
      this.logger.error('Failed to recover stuck processes:', error);
    }
  }
}
