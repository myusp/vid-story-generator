import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum TtsProviderType {
  EDGE_TTS = 'edge-tts',
  GEMINI_TTS = 'gemini-tts',
  POLLINATIONS_TTS = 'pollinations-tts',
}

export class GenerateTtsDto {
  @ApiProperty({
    description: 'Text to convert to speech',
    example: 'Hello, this is a test of text to speech generation.',
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    description: 'Voice name/code to use',
    example: 'en-US-JennyNeural',
  })
  @IsString()
  @IsNotEmpty()
  voice: string;

  @ApiProperty({
    description: 'TTS provider to use',
    enum: TtsProviderType,
    example: TtsProviderType.EDGE_TTS,
  })
  @IsEnum(TtsProviderType)
  provider: TtsProviderType;

  // Edge TTS specific options
  @ApiPropertyOptional({
    description:
      'Pitch adjustment for Edge TTS (e.g., "+10Hz", "-5Hz", "+0Hz")',
    example: '+0Hz',
  })
  @IsOptional()
  @IsString()
  pitch?: string;

  @ApiPropertyOptional({
    description: 'Rate adjustment for Edge TTS (e.g., "+20%", "-10%", "+0%")',
    example: '+0%',
  })
  @IsOptional()
  @IsString()
  rate?: string;

  @ApiPropertyOptional({
    description: 'Volume adjustment for Edge TTS (e.g., "+10%", "-5%", "+0%")',
    example: '+0%',
  })
  @IsOptional()
  @IsString()
  volume?: string;

  // Gemini TTS specific options
  @ApiPropertyOptional({
    description:
      'Style instruction for Gemini TTS (e.g., "Speak energetically and enthusiastically")',
    example: 'Speak in a calm and soothing tone',
  })
  @IsOptional()
  @IsString()
  style?: string;
}
