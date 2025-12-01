import { Injectable, Logger } from '@nestjs/common';

/**
 * Queue service for TTS generation to prevent audio conflicts
 * When multiple projects run concurrently, audio generation is queued
 * to ensure only one audio is being generated at a time
 */
@Injectable()
export class TtsQueueService {
  private readonly logger = new Logger(TtsQueueService.name);
  private queue: Array<{
    id: string;
    task: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessing = false;

  /**
   * Add a TTS task to the queue
   * Returns a promise that resolves when the task is complete
   */
  async enqueue<T>(taskId: string, task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: taskId,
        task,
        resolve,
        reject,
      });

      this.logger.log(
        `Task ${taskId} added to TTS queue. Queue length: ${this.queue.length}`,
      );

      // Start processing if not already processing
      this.processQueue();
    });
  }

  /**
   * Process the queue sequentially
   */
  private async processQueue(): Promise<void> {
    // If already processing, return (the current process will continue)
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      this.logger.log(
        `Processing TTS task ${item.id}. Remaining in queue: ${this.queue.length}`,
      );

      try {
        const result = await item.task();
        item.resolve(result);
        this.logger.log(`TTS task ${item.id} completed successfully`);
      } catch (error) {
        this.logger.error(`TTS task ${item.id} failed: ${error.message}`);
        item.reject(error);
      }
    }

    this.isProcessing = false;
    this.logger.log('TTS queue is empty');
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is currently processing
   */
  isQueueProcessing(): boolean {
    return this.isProcessing;
  }
}
