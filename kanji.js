// ==UserScript==
// @name        Kanji Terminator
// @description Generate Furigana for Kanji in Japanese
// @author      tizee
// @license     MIT
// @namespace   https://github.com/tizee
// @homepageURL https://github.com/tizee/kanji-terminator
// @require     https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js
// @match       *://*/*
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_setValue
// @grant       GM_getValue
// @version     2024.03.01
// ==/UserScript==

let doc = document;
let queue = {}; // Kanji queue to be converted
let cachedKanji = loadCacheKanji();
// load cached values
function loadCacheKanji() {
  let cacheStr = GM_getValue("kanji-terminator-caches", null);
  if (cacheStr) {
    return JSON.parse(cacheStr);
  }
  return {};
}

function saveCacheKanji(cache) {
  if (cache.keys().length >= 500) {
    GM_setValue("kanji-terminator-caches", {});
    return;
  }
  let cacheStr = JSON.stringify(cache);
  GM_setValue("kanji-terminator-caches", cacheStr);
}

let currentTime = undefined;

function getElapsedTime() {
  return Date.now() - currentTime;
}

function scanTextNodes(node) {
  // Ignore text boxes and echoes
  let excludeTags = {
    ruby: true,
    script: true,
    select: true,
    textarea: true,
    input: true,
  };

  let currentLevel = [node];
  while (currentLevel.length > 0) {
    let cur_node = currentLevel.pop();
    // The node could have been detached from the DOM tree
    if (!cur_node.parentNode || !doc.body.contains(node)) {
      return;
    }
    let text_node = cur_node;
    switch (cur_node.nodeType) {
      case Node.ELEMENT_NODE:
        if (
          cur_node.tagName.toLowerCase() in excludeTags ||
          cur_node.isContentEditable
        ) {
          continue;
        }
        cur_node.childNodes.forEach((val, idx, arr) => {
          currentLevel.push(val);
        });
      case Node.TEXT_NODE:
        while ((text_node = addRuby(text_node)));
    }
  }
}

let throttled_kanjiToHiragana = _.debounce(kanjiToHiragana, 500);

function mutationHandler(mutationList) {
  mutationList.forEach(function (mutationRecord) {
    mutationRecord.addedNodes.forEach(function (node) {
      scanTextNodes(node);
    });
  });
  throttled_kanjiToHiragana();
}

function main() {
  if (doc.documentElement.lang !== "ja") {
    return;
  }
  GM_addStyle("rt.kanji-terminator-rt::before { content: attr(data-rt); }");
  let ob = new MutationObserver(mutationHandler);
  ob.observe(doc.body, {
    childList: true,
    subtree: true,
  });

  scanTextNodes(doc.body);
}

// insert Ruby nodes recursively
function addRuby(node) {
  // not a Text Node
  if (!node.nodeValue) {
    return false;
  }
  let kanji = /[\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A]+/; // unicode range for CJK Chinese characters
  // skip Hiragana and Katakana
  let match = kanji.exec(node.nodeValue);
  if (!match) {
    return false;
  }
  // <span>漢字</span> -> <span><ruby>漢字<rt class="kanji-terminator-rt" data-rt="かんじ"></rt></ruby></span>
  let ruby = doc.createElement("ruby");
  ruby.appendChild(doc.createTextNode(match[0]));
  let rt = doc.createElement("rt");
  rt.classList.add("kanji-terminator-rt");
  ruby.appendChild(rt);

  // pending for conversion from Kanji to Hiragana
  if (queue[match[0]]) {
    queue[match[0]].push(rt);
  } else {
    queue[match[0]] = [rt];
  }

  // rest of text
  let rest = node.splitText(match.index);
  node.parentNode.insertBefore(ruby, rest);
  rest.nodeValue = rest.nodeValue.substring(match[0].length);
  // recursively
  return rest;
}

async function kanjiToHiragana() {
  let chunk = [];
  let chunkSize = 200;
  let requestCount = 0;
  let kanjiCount = 0;
  currentTime = Date.now();

  for (let kanji in queue) {
    kanjiCount++;
    if (kanji in cachedKanji) {
      updateRubyFromCached(kanji);
      continue;
    }
    chunk.push(kanji);
    if (chunk.length >= chunkSize) {
      requestCount++;
      toHiragana(chunk);
      chunk = [];
    }
  }

  if (chunk.length) {
    requestCount++;
    toHiragana(chunk);
  }

  if (kanjiCount) {
    console.debug(
      getElapsedTime(),
      "ms Kanji Terminator:",
      kanjiCount,
      "Kanji converted in",
      requestCount,
      "requests, frame",
      window.location.href
    );
  }
  saveCacheKanji(cachedKanji);
}

const API = "http://localhost:2024/";
function toHiragana(kanjis) {
  GM_xmlhttpRequest({
    method: "GET",
    url: API + encodeURIComponent(kanjis.join("\n")),
    onload: function (resp) {
      /*
       * data: result / error message
       * */
      console.log(resp.responseText);
      if (resp.responseText) {
        let json = JSON.parse(resp.responseText);
        json.data.split("\n").forEach((kanji, idx, arr) => {
          cachedKanji[kanjis[idx]] = kanji;
          updateRubyFromCached(kanjis[idx]);
        });
      } else {
        // invalid kanji
        console.error("Kanji Terminator: error for kanjis", kanjis);
      }
    },
  });
}

function updateRubyFromCached(kanji) {
  if (!cachedKanji[kanji]) {
    return;
  }
  (queue[kanji] || []).forEach(function (node) {
    node.dataset.rt = cachedKanji[kanji];
  });
  delete queue[kanji];
}

main();
