export function stripMarkdown(text: string): string {
  return text
    // Remove HTML comments <!-- ... -->
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove <picture>...</picture> blocks entirely (GitHub image embeds)
    .replace(/<picture>[\s\S]*?<\/picture>/gi, "")
    // Remove <img ...> tags, keep alt text if present
    .replace(/<img\s[^>]*alt="([^"]*)"[^>]*\/?>/gi, "$1")
    .replace(/<img[^>]*\/?>/gi, "")
    // Remove <details>/<summary> tags but keep inner text
    .replace(/<\/?(?:details|summary)>/gi, "")
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    // Markdown images ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Markdown links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bold/italic **text** or __text__
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Strikethrough ~~text~~
    .replace(/~~(.*?)~~/g, "$1")
    // Inline code `text`
    .replace(/`([^`]+)`/g, "$1")
    // Heading markers ###
    .replace(/^#{1,6}\s+/gm, "")
    // Blockquote markers >
    .replace(/^>\s?/gm, "")
    // Collapse runs of blank lines to single
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
