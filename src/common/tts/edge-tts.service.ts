import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface EdgeTtsVoice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  SuggestedCodec: string;
  FriendlyName: string;
  Status: string;
}

@Injectable()
export class EdgeTtsService {
  private readonly logger = new Logger(EdgeTtsService.name);

  async listVoices(): Promise<EdgeTtsVoice[]> {
    try {
      const { stdout } = await execAsync('edge-tts --list-voices');
      const lines = stdout.trim().split('\n');
      const voices: EdgeTtsVoice[] = [];

      // Skip header line
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const parts = line.split(/\s{2,}/); // Split by 2 or more spaces
          if (parts.length >= 6) {
            voices.push({
              Name: parts[0],
              ShortName: parts[1],
              Gender: parts[2],
              Locale: parts[3],
              SuggestedCodec: parts[4],
              FriendlyName: parts[5] || '',
              Status: parts[6] || '',
            });
          }
        }
      }

      return voices;
    } catch (error) {
      this.logger.error('Failed to list voices', error.message);
      return [];
    }
  }

  async generateSpeech(
    text: string,
    voice: string,
    outputPath: string,
    useSsml: boolean = false,
  ): Promise<{ audioPath: string; durationMs: number }> {
    try {
      // Ensure output directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Build edge-tts command
      let command = `edge-tts --voice "${voice}" --write-media "${outputPath}"`;
      
      if (useSsml) {
        // Write SSML to temp file
        const tempSsmlPath = outputPath.replace(/\.\w+$/, '.ssml');
        fs.writeFileSync(tempSsmlPath, text);
        command += ` --file "${tempSsmlPath}"`;
      } else {
        command += ` --text "${text.replace(/"/g, '\\"')}"`;
      }

      await execAsync(command);

      // Clean up temp SSML file if it exists
      if (useSsml) {
        const tempSsmlPath = outputPath.replace(/\.\w+$/, '.ssml');
        if (fs.existsSync(tempSsmlPath)) {
          fs.unlinkSync(tempSsmlPath);
        }
      }

      // Get audio duration using ffprobe
      let durationMs = 0;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        );
        durationMs = Math.floor(parseFloat(stdout.trim()) * 1000);
      } catch (error) {
        this.logger.warn('Failed to get audio duration', error.message);
      }

      return {
        audioPath: outputPath,
        durationMs,
      };
    } catch (error) {
      this.logger.error('Failed to generate speech', error.message);
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  }

  /**
   * Convert plain text narration to SSML with expressions
   */
  convertToSsml(text: string, voice: string, expressionLevel: string = 'moderate'): string {
    // Basic SSML template with expression and style
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
    <voice name="${voice}">
        <prosody rate="0%" pitch="0%">
            ${this.addSsmlExpression(text, expressionLevel)}
        </prosody>
    </voice>
</speak>`;
  }

  private addSsmlExpression(text: string, level: string): string {
    // Add breaks and emphasis based on punctuation
    let ssmlText = text;

    // Add pauses after periods, commas, etc.
    ssmlText = ssmlText.replace(/\./g, '.<break time="500ms"/>');
    ssmlText = ssmlText.replace(/,/g, ',<break time="300ms"/>');
    ssmlText = ssmlText.replace(/!/g, '!<break time="600ms"/>');
    ssmlText = ssmlText.replace(/\?/g, '?<break time="600ms"/>');

    // Add emphasis to exclamations and questions
    ssmlText = ssmlText.replace(/([^.!?]+[!])/g, '<emphasis level="strong">$1</emphasis>');

    return ssmlText;
  }
}
