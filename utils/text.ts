import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

const jieba = Jieba.withDict(dict);
const WORD_LIKE = /[\p{L}\p{N}]/u;
const HAS_LETTER = /\p{L}/u;

/** Word-like tokens for Chinese and English (jieba, HMM enabled). */
export function tokenizeText(text: string): string[] {
  return jieba.cut(text, true).filter((token) => WORD_LIKE.test(token));
}

/** Word token count for Chinese and English (jieba). */
export function countContentTokens(text: string): number {
  return tokenizeText(text).length;
}

/**
 * Whether a jieba POS tag marks a keyword for duplicate matching: nouns (n*),
 * verbs (v*), abbreviations (j) and English words (eng). Words found only by
 * HMM are tagged `x` like punctuation; those with letters are kept since they
 * are usually new names or terms.
 */
function isKeyword(word: string, tag: string): boolean {
  if (tag === "x") return HAS_LETTER.test(word);
  return tag.startsWith("n") || tag.startsWith("v") || tag === "j" || tag === "eng";
}

/**
 * Version of the `titleTokens` rules. Bump it whenever their output changes
 * (keyword tags, dictionary) so stored `title_tokens` are recomputed on start.
 */
export const TITLE_TOKENS_VERSION = 1;

/**
 * Space-separated title keywords as stored in `t_items.title_tokens`.
 * `stopwords` must be lowercase; tokens are matched case-insensitively.
 */
export function titleTokens(title: string, stopwords: ReadonlySet<string>): string {
  return jieba.tag(title, true)
    .filter(({ word, tag }) => isKeyword(word, tag))
    .map(({ word }) => word)
    .filter((token) => !stopwords.has(token.toLocaleLowerCase()))
    .join(" ");
}
