import type { Span } from "./claims.js";
import { fold } from "./terms.js";

export interface OfferName {
  name: string;
  aliases: string[];
}

export interface OfferMention {
  offer: string;
  index: number;
  end: number;
}

/** Lowercases and strips accents without changing string length, so indexes stay valid. */
function foldSameLength(text: string): string {
  let out = "";
  for (const ch of text) {
    const f = fold(ch);
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds every mention of an offer name or alias (case- and accent-insensitive,
 * whole words). Where mentions overlap, the longest wins.
 */
export function findOfferMentions(text: string, offers: OfferName[]): OfferMention[] {
  const folded = foldSameLength(text);
  const candidates: OfferMention[] = [];
  for (const offer of offers) {
    const phrases = [...new Set([offer.name, ...offer.aliases].map((p) => fold(p).trim()).filter(Boolean))];
    for (const phrase of phrases) {
      const body = phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "gu");
      for (const m of folded.matchAll(re)) {
        candidates.push({ offer: offer.name, index: m.index!, end: m.index! + m[0].length });
      }
    }
  }
  candidates.sort((a, b) => b.end - b.index - (a.end - a.index) || a.index - b.index);
  const kept: OfferMention[] = [];
  for (const c of candidates) {
    if (!kept.some((k) => c.index < k.end && c.end > k.index)) kept.push(c);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/** Start offsets of sentences: after a line break, or after . ! ? followed by space and a capital, digit or ¡¿. */
function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(/\n|[.!?]+["')\]]*\s+(?=[\p{Lu}\d¡¿])/gu)) starts.push(m.index! + m[0].length);
  return starts;
}

/** Start offsets of paragraphs (blocks separated by a blank line). */
function paragraphStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) starts.push(m.index! + m[0].length);
  return starts;
}

function blockOf(starts: number[], index: number): number {
  let block = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= index) block = i;
  return block;
}

/**
 * Attributes claims to offers by proximity in the text:
 *  1. the nearest offer named earlier in the same sentence;
 *  2. otherwise the first offer named later in the same sentence;
 *  3. otherwise the nearest offer named earlier in the same paragraph;
 *  4. otherwise none (the claim is compared with the whole record).
 */
export function attributeOffers(text: string, claims: Span[], mentions: OfferMention[]): Array<string | null> {
  if (mentions.length === 0) return claims.map(() => null);
  const sentences = sentenceStarts(text);
  const paragraphs = paragraphStarts(text);
  const mentionInfo = mentions.map((m) => ({ ...m, s: blockOf(sentences, m.index), p: blockOf(paragraphs, m.index) }));

  return claims.map((c) => {
    const s = blockOf(sentences, c.index);
    const p = blockOf(paragraphs, c.index);
    const before = mentionInfo.filter((m) => m.end <= c.index);
    const sameSentenceBefore = before.filter((m) => m.s === s);
    if (sameSentenceBefore.length) return sameSentenceBefore[sameSentenceBefore.length - 1]!.offer;
    const sameSentenceAfter = mentionInfo.find((m) => m.index >= c.end && m.s === s);
    if (sameSentenceAfter) return sameSentenceAfter.offer;
    const sameParagraphBefore = before.filter((m) => m.p === p);
    if (sameParagraphBefore.length) return sameParagraphBefore[sameParagraphBefore.length - 1]!.offer;
    return null;
  });
}
