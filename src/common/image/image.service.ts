import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private baseUrl: string;
  private axiosInstance: AxiosInstance;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'POLINATIONS_BASE_URL',
      'https://image.pollinations.ai',
    );

    // Create axios instance with retry configuration
    this.axiosInstance = axios.create({
      timeout: 1000 * 60 * 2,
    });

    // Configure axios-retry with exponential backoff
    axiosRetry(this.axiosInstance, {
      retries: 5, // Retry up to 5 times
      shouldResetTimeout: true, // Reset timeout for each retry
      retryDelay: (r, e) => axiosRetry.exponentialDelay(r, e, 3000),
      retryCondition: (error) => {
        // Retry on network errors, timeouts, or 5xx status codes
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          error.code === 'ECONNABORTED' ||
          (error.response?.status >= 500 && error.response?.status <= 599)
        );
      },
      onRetry: (retryCount, error) => {
        this.logger.warn(
          `Retry attempt ${retryCount} for image generation. Error: ${error.message} (Code: ${error.code})`,
        );
      },
    });
  }

  async generateImage(
    prompt: string,
    outputPath: string,
    width: number = 720,
    height: number = 1280,
  ): Promise<string> {
    try {
      // Polinations AI URL format
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `${this.baseUrl}/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=flux&enhance=true`;

      this.logger.log(
        `Generating image for prompt: ${prompt.substring(0, 50)}...`,
      );

      // Download image with retry
      const response = await this.axiosInstance.get(imageUrl, {
        responseType: 'arraybuffer',
      });

      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Save image
      fs.writeFileSync(outputPath, response.data);

      this.logger.log(`Image generated successfully: ${outputPath}`);
      return outputPath;
    } catch (error) {
      this.logger.error(
        `Failed to generate image after retries: ${error.message}`,
      );
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  }
}
