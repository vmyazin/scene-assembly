# Launcher thumbnail loops

Every clip: 16:9, 8 s, no audio, locked camera. Use the listed keyframe as BOTH first and last frame (frames mode) so the clip loops seamlessly. Scene Assembly refuses one upload in both slots, so stage the keyframe twice.

| Mode | Keyframe | Model | Status |
| --- | --- | --- | --- |
| Text to video | `text-to-video-empty-prompt.png` | fal Veo 3.1 | Done (types "walkking") |
| Image to video | `public/thumbnails/neon-cat-leap-cyan-magenta.jpg` | fal Veo 3.1 | Done |
| First & last frame | `public/thumbnails/neon-cat-jump-dashboard.jpg` | runware Veo 3.1 Lite | Done |
| Edit video | `public/thumbnails/edit-video.jpg` | Atlas Seedance 2.0 Fast | Done (PiAPI Veo 3.1 Fast rejected it) |
| Character references | `character-references-keyframe.png` | Atlas Seedance 2.0 Fast | Done (PiAPI Veo 3.1 Fast rejected it) |

## Text to video

Shows: a written prompt is all it takes.

A dark isometric grid of neon-edged cards, each holding a sleeping, dimmed drawing of the same cat in a different art style. In the foreground floats a sleek frosted-glass prompt box with a soft cyan glowing border, a blinking text cursor, and a glowing magenta sparkle button on its right side. Text types into the prompt box one letter at a time, steady and readable: "a cat walking". A mouse pointer glides to the glowing magenta sparkle button on the right side of the box and clicks it. The button flashes, and a thin progress glow races along the box's border. The prompt box opens up into a 16:9 video frame with a glowing border, and inside it a pink neon cat walks smoothly across the frame in a continuous walk cycle. At the same moment, light spills out of the frame and ripples across the grid behind it: each card flares to full color and its cat starts walking in its own style (pixel art, watercolor, chrome, low-poly, pencil sketch). After a beat, the video frame folds back into the prompt box, the text deletes itself, and the grid dims back to sleep, the cursor blinking in the empty box exactly as the clip began. Clean UI motion graphics, crisp sharp text, deep black background, magenta and cyan neon with subtle bloom, locked camera, smooth confident pacing, seamless loop.

Negative: garbled or misspelled text, extra words in the box, camera movement, extra UI elements, cat anatomy morphing, flicker, cards changing shape.

## Image to video

Shows: one still is read in and set in motion.

Three translucent glass panels with glowing neon edges float in a dark space, arranged left to right. The left panel holds a still image of a magenta neon cat, frozen mid-crouch like a photograph. A bright cyan scan line sweeps once down the left panel, like an image being uploaded and read, and a soft ring of light pulses around its border. The frozen cat comes to life: it pushes off and leaps out of the left panel, flying through the glowing center panel with cyan speed lines and a smooth arcing light trail, and lands gracefully on the right panel, settling into a still pose. All three panels then glide smoothly one position to the left: the right panel takes the place of the left, and a fresh empty panel slides in from the right. The scene ends composed exactly as it began, ready to leap again. Neon magenta and cyan on deep black, glassy reflections, gentle purple floor glow, fluid elegant motion, seamless loop.

Negative: camera cuts, cat changing color or shape, panels warping, sudden zoom, extra cats, jitter.

## First & last frame

Shows: both ends are fixed; only the motion between them is generated.

Never say "ghost" in this prompt: Veo draws literal cartoon ghosts.

Two glass panels with glowing violet neon edges face each other across a dark space. The left panel is the first frame: a violet neon line-drawing of a cat crouched, ready to spring. The right panel is the last frame: the same cat landing, front paws down, tail curled up. Between them runs a cyan arc with faint, thin grey outline sketches of the same cat in in-between running poses. Both panels and both drawings stay fixed in place for the whole clip; only the space between them comes alive. The left panel pulses brightly once, then the right panel pulses brightly once, marking the two fixed frames. Then the motion between them is filled in: a glowing violet neon line-drawing of the cat springs from the crouch on the left panel and leaps along the cyan arc; each faint outline sketch along the arc glows briefly as the cat passes through it, from left to right, until the cat lands precisely in the pose drawn on the right panel and merges into it with a soft flash. The outline sketches dim back to faint grey and the scene settles exactly as it began. Every figure in the scene is the same cat drawn in thin neon lines. Clean motion graphics, deep black background, violet and cyan glow, locked camera, smooth confident pacing, seamless loop.

Negative: ghosts, cartoon characters, any creature other than the cat, panels moving, the drawings on the panels changing pose, camera movement, text, flicker.

## Edit video

Shows: same performance, same motion, only the character is replaced.

A photoreal split-screen before-and-after of the same karaoke performance, on a nightclub stage with purple and cyan spotlights, a glowing neon music-note sign and a glittering curtain. A glowing vertical violet-cyan energy seam divides the frame. Left of the seam is the original video: an orange tabby cat singing into a microphone and dancing. Right of the seam is the edited video: a kangaroo in the cat's place, performing the exact same song with the exact same moves. Both performers dance in perfect sync the whole time: the same head bob, the same raised paw, the same sway and the same open-mouthed singing on every beat, on the identical stage with identical lighting. Every couple of beats a shimmering wave of light particles flows from the cat's side through the seam into the kangaroo's side, showing the original being turned into the edit. Only the character differs between the two sides; the motion, timing, stage, lights and camera are identical. The performers return to their starting poses at the end, exactly as the clip began. Photoreal, cinematic stage lighting, locked camera, seamless loop.

Negative: the two performers moving out of sync, the seam moving, characters swapping sides, camera movement, extra performers, text.

## Character references

Shows: the reference views stay put while the same person is carried into new scenes.

A dark product interface. On the left, three small reference cards with glowing violet-cyan borders show the same elderly potter: front view, three-quarter view and side profile. These three reference cards stay perfectly still for the entire clip. On the right, a large glowing frame shows him in his sunlit pottery studio, smiling as he admires a glossy green ceramic bowl. A pulse of cyan light travels from the reference cards along the thin connecting line into the large frame, and the scene inside the frame changes with a smooth light-sweep transition to a new place: the same man, with the same face, grey hair, navy jacket and clay-spattered apron, walking through a lantern-lit night market carrying the green bowl. A second pulse travels along the line and the scene changes again: the same man standing on a misty seaside pier at dawn, holding the green bowl and smiling at the sea. A final pulse returns the frame to his sunlit pottery studio, ending exactly as the clip began. His identity, face, hair and clothes stay perfectly consistent in every scene; only the setting around him changes. Photoreal cinematic lighting inside the frame, dark neon interface around it, the layout never moves, smooth transitions, seamless loop.

Negative: his face or age changing between scenes, different clothes, reference cards moving or changing, text or labels, extra people in focus, camera shake.
