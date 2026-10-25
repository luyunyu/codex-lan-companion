import { referencesFromMarkdown } from "../public/mention-format.js";

export function desktopUserInput(text, images = []) {
  const input = [];
  if (text) input.push({ type: "text", text, text_elements: [] });
  input.push(...referencesFromMarkdown(text));
  for (const image of images) {
    input.push({ type: "image", url: `data:${image.mimeType};base64,${image.data}` });
  }
  return input;
}
