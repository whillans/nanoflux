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
export const TITLE_TOKENS_VERSION = 2;

/**
 * Separators before the publisher in Google News titles, as fetched
 * ("Headline - Reuters") and as translated ("标题——《卫报》", "标题 -《卫报》").
 */
const SOURCE_SEPARATOR = /\s-|——/g;
/** Longer trailing parts are taken as title text rather than a publisher name. */
const MAX_SOURCE_CHARS = 60;

/**
 * Drop the trailing publisher from a Google News title: it is a rare token
 * that differs between reports of the same news and matches unrelated ones
 * from the same outlet.
 */
export function stripGoogleNewsSource(title: string): string {
  const last = [...title.matchAll(SOURCE_SEPARATOR)].at(-1);
  if (!last) return title;
  const head = title.slice(0, last.index).trimEnd();
  const source = title.slice(last.index + last[0].length).trim();
  return head && source && source.length <= MAX_SOURCE_CHARS ? head : title;
}

/**
 * Space-separated title keywords as stored in `t_items.title_tokens`.
 * `stopwords` must be lowercase; tokens are matched case-insensitively.
 * `googleNews` drops the trailing publisher first (see `stripGoogleNewsSource`).
 */
export function titleTokens(title: string, stopwords: ReadonlySet<string>, googleNews = false): string {
  return jieba.tag(googleNews ? stripGoogleNewsSource(title) : title, true)
    .filter(({ word, tag }) => isKeyword(word, tag))
    .map(({ word }) => word)
    .filter((token) => !stopwords.has(token.toLocaleLowerCase()))
    .join(" ");
}
