/**
 * Punctuation-based text splitter for TTS prosody segments
 * Splits text based on punctuation marks to create natural speech segments
 */

export interface ProsodySegment {
  text: string;
  rate: string;
  volume: string;
  pitch: string;
}

/**
 * Split text into segments based on punctuation marks
 * Each segment will maintain the punctuation that ends it
 */
export function splitByPunctuation(text: string): string[] {
  // Split by sentence-ending punctuation while keeping the punctuation with the text
  // Matches: . ! ? ; : ... (ellipsis) and combinations like !? or ?!
  const segments: string[] = [];

  // Regex pattern to split on sentence-ending punctuation
  // Handles:
  // - Single punctuation: . ! ? ; :
  // - Ellipsis: ... or …
  // - Combinations: !? ?! !! ??
  // The pattern captures text followed by punctuation marks
  const pattern = /([^.!?;:…]+(?:\.{2,}|…|[.!?;:]+(?:\s*[.!?;:]+)*))\s*/g;

  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const segment = match[1].trim();
    if (segment) {
      segments.push(segment);
    }
    lastIndex = pattern.lastIndex;
  }

  // Handle any remaining text without punctuation at the end
  const remaining = text.substring(lastIndex).trim();
  if (remaining) {
    segments.push(remaining);
  }

  // If no segments were created (no punctuation), return the whole text as one segment
  if (segments.length === 0 && text.trim()) {
    segments.push(text.trim());
  }

  return segments;
}

/**
 * Determine prosody settings based on punctuation and text content
 * Using subtle variations to maintain smooth, natural speech flow
 */
export function getProsodyFromPunctuation(text: string): {
  rate: string;
  volume: string;
  pitch: string;
} {
  const trimmedText = text.trim();

  // Check for multiple exclamation marks (very excited) - reduced variation
  if (/!{2,}$/.test(trimmedText) || /!\?|\?!/.test(trimmedText)) {
    return { rate: '+5%', volume: '+15%', pitch: '+5Hz' };
  }

  // Check for exclamation (excited/emphasis) - reduced variation
  if (trimmedText.endsWith('!')) {
    return { rate: '+3%', volume: '+10%', pitch: '+3Hz' };
  }

  // Check for question marks - reduced variation
  if (trimmedText.endsWith('?')) {
    return { rate: '+2%', volume: '+5%', pitch: '+5Hz' };
  }

  // Check for ellipsis (suspense/slow) - reduced variation
  if (/\.{2,}$/.test(trimmedText) || trimmedText.endsWith('…')) {
    return { rate: '-5%', volume: '-3%', pitch: '-2Hz' };
  }

  // Check for colon (introducing something) - minimal variation
  if (trimmedText.endsWith(':')) {
    return { rate: '-2%', volume: '+2%', pitch: '+0Hz' };
  }

  // Check for semicolon (pause/continuation) - minimal variation
  if (trimmedText.endsWith(';')) {
    return { rate: '-2%', volume: '+0%', pitch: '+0Hz' };
  }

  // Default for periods and other punctuation
  return { rate: '+0%', volume: '+0%', pitch: '+0Hz' };
}

/**
 * Convert text to prosody segments based on punctuation
 * This replaces AI-based prosody generation with deterministic punctuation-based splitting
 */
export function textToProsodySegments(narration: string): ProsodySegment[] {
  const textSegments = splitByPunctuation(narration);

  return textSegments.map((text) => {
    const prosody = getProsodyFromPunctuation(text);
    return {
      text,
      ...prosody,
    };
  });
}
