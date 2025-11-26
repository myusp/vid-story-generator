import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ImageService {
  private baseUrl: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'POLINATIONS_BASE_URL',
      'https://image.pollinations.ai',
    );
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
      const imageUrl = `${this.baseUrl}/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

      // Download image
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Save image
      fs.writeFileSync(outputPath, response.data);

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  }
}
