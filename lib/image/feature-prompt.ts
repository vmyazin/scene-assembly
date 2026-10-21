/** Keep feature prompt expansion identical for guest and account execution. */
export function featureImagePrompt(featureId: string, prompt: string, imageCount: number): string {
  let finalPrompt = prompt;
  if (featureId === 'social-media-thumbnail') {
    finalPrompt = `Create a VIRAL YouTube/Social Media thumbnail with these elements:
- DRAMATIC, eye-catching scene with shocked/surprised facial expression
- BIG, BOLD text overlays with key phrases (use vibrant colors like yellow, red, white)
- Arrows, circles, or highlighting elements pointing to important parts
- High contrast and saturated colors for maximum impact
- Professional editing style that screams "CLICK ME!"
- Energy and urgency in the composition
${thumbnailReferenceRoles(imageCount)}
User's custom requirements: ${prompt}

Style: Photorealistic, professional thumbnail editing, viral content aesthetics`;
  } else if (featureId === 'style-transfer') {
    if (imageCount === 2) {
      finalPrompt = prompt || 'Apply the artistic style and aesthetic from the first image to the content and composition of the second image. Preserve the subject matter of the second image while adopting the color palette, brushstrokes, texture, and artistic techniques of the first image.';
    } else if (imageCount === 1) {
      finalPrompt = prompt || 'Transform this image into an artistic masterpiece. Apply creative stylization while maintaining the core composition and subject matter.';
    }
  }

  return finalPrompt;
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
