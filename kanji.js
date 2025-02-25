// ==UserScript==
// @name        Kanji Terminator
// @description Generate Furigana for Kanji in Japanese
// @author      tizee
// @license     MIT
// @namespace   https://github.com/tizee-tampermonkey-scripts/tampermonkey-kanji-terminator
// @homepageURL https://github.com/tizee-tampermonkey-scripts/tampermonkey-kanji-terminator
// @match       *://*/*
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_registerMenuCommand
// @version     1.1
// ==/UserScript==
(function() {
    // Custom debounce function
    function debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId); // Clear the previous timeout
            timeoutId = setTimeout(() => {
                func.apply(this, args); // Call the function after the delay
            }, delay);
        };
    }

    const RESOLVER_KEY = "KANJI_API";
    let API = GM_getValue(RESOLVER_KEY, "http://localhost:8787");
    let doc = document;
    let queue = {}; // Kanji queue to be converted
    let cachedKanji = loadCacheKanji();

    // --- Menu Command ---
    GM_registerMenuCommand("Set kanji Resolver API URL", () => {
        const resolver = prompt("Enter your kanji video resolver API URL:");
        if (resolver) {
            GM_setValue(RESOLVER_KEY, resolver);
            API = resolver;
            alert("Resolver API URL saved successfully!");
        }
    });

    // load cached values
    function loadCacheKanji() {
        let cacheStr = GM_getValue("kanji-terminator-caches", "");
        if (cacheStr) {
            return JSON.parse(cacheStr);
        }
        return {};
    }

    function saveCacheKanji(cache) {
        if (Object.keys(cache).length >= 500) {
            GM_setValue("kanji-terminator-caches", "");
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

    let throttled_kanjiToHiragana = debounce(kanjiToHiragana, 500);

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


    function toHiragana(kanjis) {
        if (!kanjis) {
            console.debug("Kanji Terminator: `kanjis` is undefined or null");
            return;
        }
        GM_xmlhttpRequest({
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            url: API,
            data: JSON.stringify({ texts: kanjis }),
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
                    console.debug("Kanji Terminator: error for kanjis", kanjis);
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
}());
