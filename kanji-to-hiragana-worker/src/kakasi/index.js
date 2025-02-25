// This file is the main entry point for the kakasi Node.js library
"use strict";

const { convertKanjiCompound } = require('./kanji_converter');
const kanjiDict = require('./kanji_dict').kanjiDict;
const synDict = require('./syn_dict').synDict;

/**
 * Normalize Japanese text by replacing kanji synonyms
 * @param {string} text - Input text to normalize
 * @returns {string} - Normalized text
 */
function normalize(text) {
  return [...text].map(char => synDict[char] || char).join('');
}

/**
 * Convert kanji to hiragana
 * @param {string} text - Input text containing kanji
 * @returns {string} - Text with kanji converted to hiragana
 */
function kanjiToHiragana(text) {
  const normalizedText = normalize(text);
  let result = '';
  let i = 0;

  while (i < normalizedText.length) {
    const char = normalizedText[i];
    const code = char.charCodeAt(0);

    // Check if it's a kanji (CJK Unified Ideographs)
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // Try to convert kanji compound
      const { reading, count } = convertKanjiCompound(normalizedText.substring(i), kanjiDict);

      if (count > 0) {
        result += reading;
        i += count;
      } else {
        // If no kanji compound found, keep the character as is
        result += char;
        i += 1;
      }
    } else {
      // Non-kanji character, keep as is
      result += char;
      i += 1;
    }
  }

  return result;
}

module.exports = {
  kanjiToHiragana,
  normalize
};
