const WINDOWS_1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function byteFor(character: string) {
  const code = character.charCodeAt(0);
  if (code <= 255) return code;
  const index = WINDOWS_1252.indexOf(character);
  return index < 0 ? -1 : index + 128;
}

export function repairChordProEncoding(value: string): string {
  let result = value;
  for (let pass = 0; pass < 2; pass += 1) {
    let repaired = "";
    for (let index = 0; index < result.length; index += 1) {
      const lead = byteFor(result[index]);
      const length = lead >= 194 && lead <= 223 ? 2 : lead >= 224 && lead <= 239 ? 3 : lead >= 240 && lead <= 244 ? 4 : 0;
      const bytes = Array.from(result.slice(index, index + length), byteFor);
      if (length && bytes.length === length && bytes.slice(1).every((byte) => byte >= 128 && byte <= 191)) {
        try {
          repaired += new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
          index += length - 1;
          continue;
        } catch { /* Keep invalid or already-correct text verbatim. */ }
      }
      repaired += result[index];
    }
    if (repaired === result) break;
    result = repaired;
  }
  return result;
}

// Imported charts may contain rich-text markup. Keep their text and line breaks;
// never render the imported markup as HTML.
export function normalizeChordProText(value: string | null | undefined): string {
  if (!value) return "";
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sharp: "♯", flat: "♭" };
  let text = repairChordProEncoding(value);
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|sharp|flat);/gi, (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
      const point = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    });
  }
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|section|li|h[1-6]|pre)\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|section|li|h[1-6]|pre|span|strong|b|em|i|u|font|a)\b[^>]*>/gi, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\uFEFF\u200B]/g, "")
    .replace(/\u00a0/g, " ");
}
