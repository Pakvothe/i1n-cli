import type { Format, I1nParser } from "../shared/types.js";
import { jsonNestedParser } from "./json-nested.js";
import { jsonFlatParser } from "./json-flat.js";
import { arbParser } from "./arb.js";
import { yamlParser } from "./yaml.js";
import { androidXmlParser } from "./android-xml.js";
import { appleStringsParser } from "./apple-strings.js";
import { typescriptParser } from "./typescript.js";

const PARSERS: Record<Format, I1nParser> = {
  "nested-json": jsonNestedParser,
  "flat-json": jsonFlatParser,
  arb: arbParser,
  yaml: yamlParser,
  "android-xml": androidXmlParser,
  "apple-strings": appleStringsParser,
  typescript: typescriptParser,
};

export function getParser(format: Format): I1nParser {
  return PARSERS[format];
}
