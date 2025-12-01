/**
 * Utility for generating safe file names from project topics
 */

/**
 * Generate a safe file name from a topic string
 * - Replaces spaces with underscores
 * - Removes special characters
 * - Converts to lowercase
 * - Limits length to 50 characters
 * - Appends date if duplicate checking is needed
 */
export function generateSafeSlug(topic: string, existingSlug?: string): string {
  // Remove special characters, replace spaces with underscores
  let slug = topic
    .toLowerCase()
    .trim()
    // Replace spaces and multiple spaces with single underscore
    .replace(/\s+/g, '_')
    // Remove special characters except underscores
    .replace(/[^a-z0-9_]/g, '')
    // Remove consecutive underscores
    .replace(/_+/g, '_')
    // Remove leading/trailing underscores
    .replace(/^_+|_+$/g, '')
    // Limit length
    .substring(0, 50);

  // If empty, use default
  if (!slug) {
    slug = 'story';
  }

  // If we need to check for duplicates and this matches an existing slug,
  // append date in format yyyymmdd
  if (existingSlug && slug === existingSlug) {
    const date = new Date();
    const dateStr =
      date.getFullYear().toString() +
      (date.getMonth() + 1).toString().padStart(2, '0') +
      date.getDate().toString().padStart(2, '0');
    slug = `${slug}_${dateStr}`;
  }

  return slug;
}

/**
 * Generate a unique project slug by checking existing slugs
 */
export async function generateUniqueSlug(
  topic: string,
  checkExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const baseSlug = generateSafeSlug(topic);
  let slug = baseSlug;
  let counter = 1;

  // Check if slug exists, if so add counter or date
  while (await checkExists(slug)) {
    const date = new Date();
    const dateStr =
      date.getFullYear().toString() +
      (date.getMonth() + 1).toString().padStart(2, '0') +
      date.getDate().toString().padStart(2, '0');

    if (counter === 1) {
      slug = `${baseSlug}_${dateStr}`;
    } else {
      slug = `${baseSlug}_${dateStr}_${counter}`;
    }
    counter++;

    // Safety limit to prevent infinite loop
    if (counter > 100) {
      slug = `${baseSlug}_${Date.now()}`;
      break;
    }
  }

  return slug;
}
