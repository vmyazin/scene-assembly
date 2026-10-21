/**
 * The instruction a mode wraps around what the user typed before it reaches the
 * model. Every mode has one so a session can add its own; most are `{prompt}`,
 * which sends the text as written.
 */
export interface MasterPrompt {
  /** `{prompt}` is the typed text; `{references}` says what each upload is for. */
  template: string;
  /** Sent instead of the template when the prompt box is empty. */
  whenEmpty?: string;
}

export const PROMPT_TOKEN = '{prompt}';
export const REFERENCES_TOKEN = '{references}';

const THUMBNAIL_TEMPLATE = `Create a VIRAL YouTube/Social Media thumbnail with these elements:
- DRAMATIC, eye-catching scene with shocked/surprised facial expression
- BIG, BOLD text overlays with key phrases (use vibrant colors like yellow, red, white)
- Arrows, circles, or highlighting elements pointing to important parts
- High contrast and saturated colors for maximum impact
- Professional editing style that screams "CLICK ME!"
- Energy and urgency in the composition
${REFERENCES_TOKEN}
User's custom requirements: ${PROMPT_TOKEN}

Style: Photorealistic, professional thumbnail editing, viral content aesthetics`;

/**
 * The built-in master prompt. Style transfer's empty-prompt fallback depends on
 * how many images are attached, so the default is resolved per run and the
 * editor shows the one that would be sent now.
 */
export function defaultMasterPrompt(featureId: string, imageCount: number): MasterPrompt {
  if (featureId === 'social-media-thumbnail') return { template: THUMBNAIL_TEMPLATE };
  if (featureId === 'style-transfer') {
    if (imageCount === 2) {
      return {
        template: PROMPT_TOKEN,
        whenEmpty: 'Apply the artistic style and aesthetic from the first image to the content and composition of the second image. Preserve the subject matter of the second image while adopting the color palette, brushstrokes, texture, and artistic techniques of the first image.',
      };
    }
    if (imageCount === 1) {
      return {
        template: PROMPT_TOKEN,
        whenEmpty: 'Transform this image into an artistic masterpiece. Apply creative stylization while maintaining the core composition and subject matter.',
      };
    }
  }
  return { template: PROMPT_TOKEN };
}

/**
 * Keep feature prompt expansion identical for guest and account execution.
 * `master` is the session's edited copy, when there is one.
 */
export function featureImagePrompt(
  featureId: string,
  prompt: string,
  imageCount: number,
  master: MasterPrompt = defaultMasterPrompt(featureId, imageCount),
): string {
  if (!prompt && master.whenEmpty) return master.whenEmpty;
  // Function replacers, so a `$&` the user typed is not read as a pattern.
  return master.template
    .replaceAll(REFERENCES_TOKEN, () => thumbnailReferenceRoles(imageCount))
    .replaceAll(PROMPT_TOKEN, () => prompt);
}

/**
 * Says what each thumbnail upload is for. Without it the model treats a second
 * photo as a candidate subject and blends the two faces, or invents a new one.
 */
function thumbnailReferenceRoles(imageCount: number): string {
  if (imageCount === 0) return '';
  const subject = '- Image 1 is the main subject. Keep their face and identity recognizable; expression, pose and lighting may change to fit the thumbnail.';
  if (imageCount === 1) return `\nReference image:\n${subject}\n`;
  const others = imageCount === 2
    ? 'Image 2 is a supporting element (a product, logo, prop, background or style to match). Place it in the scene; never merge it into'
    : `Images 2–${imageCount} are supporting elements (a product, logo, prop, background or style to match). Place them in the scene; never merge them into`;
  return `\nReference images:\n${subject}\n- ${others} the subject's face.\n`;
}
