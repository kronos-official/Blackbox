import { generateImage } from "../server/_core/imageGeneration.ts";

try {
  const result = await generateImage({
    prompt: "A premium abstract navy and cyan security card mockup, no text, no letters, no numbers, portrait composition",
    model: "MODEL_GEMINI_2_5_FLASH_IMAGE_PREVIEW",
    timeoutMs: 15000,
  });
  console.log(JSON.stringify({ ok: true, hasUrl: Boolean(result.url), url: result.url }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, name: error?.name, message: error?.message, stack: error?.stack }, null, 2));
  process.exitCode = 1;
}
