import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyRollingService {
  private geminiKeys: string[] = [];
  private openaiKeys: string[] = [];
  private geminiTtsKeys: string[] = [];
  private geminiIndex = 0;
  private openaiIndex = 0;
  private geminiTtsIndex = 0;

  constructor(private configService: ConfigService) {
    this.initializeKeys();
  }

  private initializeKeys() {
    const geminiKeysStr = this.configService.get<string>('GEMINI_API_KEYS', '');
    const openaiKeysStr = this.configService.get<string>('OPENAI_API_KEYS', '');
    const geminiTtsKeysStr = this.configService.get<string>(
      'GEMINI_TTS_API_KEYS',
      '',
    );

    this.geminiKeys = geminiKeysStr
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    this.openaiKeys = openaiKeysStr
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    this.geminiTtsKeys = geminiTtsKeysStr
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
  }

  getNextGeminiKey(): string {
    if (this.geminiKeys.length === 0) {
      throw new Error('No Gemini API keys configured');
    }

    const key = this.geminiKeys[this.geminiIndex];
    this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;
    return key;
  }

  getNextOpenAIKey(): string {
    if (this.openaiKeys.length === 0) {
      throw new Error('No OpenAI API keys configured');
    }

    const key = this.openaiKeys[this.openaiIndex];
    this.openaiIndex = (this.openaiIndex + 1) % this.openaiKeys.length;
    return key;
  }

  hasGeminiKeys(): boolean {
    return this.geminiKeys.length > 0;
  }

  hasOpenAIKeys(): boolean {
    return this.openaiKeys.length > 0;
  }

  getNextGeminiTtsKey(): string {
    if (this.geminiTtsKeys.length === 0) {
      throw new Error('No Gemini TTS API keys configured');
    }

    const key = this.geminiTtsKeys[this.geminiTtsIndex];
    this.geminiTtsIndex = (this.geminiTtsIndex + 1) % this.geminiTtsKeys.length;
    return key;
  }

  hasGeminiTtsKeys(): boolean {
    return this.geminiTtsKeys.length > 0;
  }
}
