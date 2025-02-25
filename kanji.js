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
    // Configuration constants
    const CONFIG = {
        RESOLVER_KEY: "KANJI_API",
        CACHE_KEY: "kanji-terminator-caches",
        MAX_CACHE_SIZE: 500,
        DEBOUNCE_DELAY: 500,
        CHUNK_SIZE: 200,
        EXCLUDED_TAGS: {
            ruby: true,
            script: true,
            select: true,
            textarea: true,
            input: true,
        },
        // Unicode range for CJK Chinese characters
        KANJI_REGEX: /[\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A]+/
    };

    // --- Utility Functions ---

    /**
     * Creates a debounced version of the provided function
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} - Debounced function
     */
    function debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    }

    /**
     * Measures elapsed time from a given start time
     * @returns {number} - Elapsed time in milliseconds
     */
    function getElapsedTime() {
        return Date.now() - startTime;
    }

    // --- Cache Management ---

    /**
     * Cache service for managing kanji readings
     */
    const CacheService = {
        cache: {},

        /**
         * Load cached kanji readings from storage
         * @returns {Object} - Cached kanji readings
         */
        load() {
            let cacheStr = GM_getValue(CONFIG.CACHE_KEY, "");
            if (cacheStr) {
                this.cache = JSON.parse(cacheStr);
            }
            return this.cache;
        },

        /**
         * Save cached kanji readings to storage
         */
        save() {
            // Truncate cache if it grows too large
            if (Object.keys(this.cache).length >= CONFIG.MAX_CACHE_SIZE) {
                // Keep the most recent 75% of the entries
                const entries = Object.entries(this.cache);
                const keepCount = Math.floor(CONFIG.MAX_CACHE_SIZE * 0.75);
                const newEntries = entries.slice(-keepCount);
                
                // Rebuild the cache with only the most recent entries
                this.cache = Object.fromEntries(newEntries);
                console.debug(`Kanji Terminator: Cache truncated to ${keepCount} entries`);
            }
            
            let cacheStr = JSON.stringify(this.cache);
            GM_setValue(CONFIG.CACHE_KEY, cacheStr);
        },

        /**
         * Get reading for a specific kanji
         * @param {string} kanji - Kanji to lookup
         * @returns {string|undefined} - Reading if available
         */
        get(kanji) {
            return this.cache[kanji];
        },

        /**
         * Store reading for a kanji
         * @param {string} kanji - Kanji to store
         * @param {string} reading - Reading for the kanji
         */
        set(kanji, reading) {
            this.cache[kanji] = reading;
        },

        /**
         * Check if a kanji exists in the cache
         * @param {string} kanji - Kanji to check
         * @returns {boolean} - True if cached
         */
        has(kanji) {
            return kanji in this.cache;
        }
    };

    // --- DOM Manipulation ---

    /**
     * Handles DOM manipulation for kanji furigana
     */
    const DOMHandler = {
        doc: document,
        queue: {}, // Kanji queue to be converted

        /**
         * Initialize styles and setup
         */
        initialize() {
            GM_addStyle("rt.kanji-terminator-rt::before { content: attr(data-rt); }");
        },

        /**
         * Scan DOM for text nodes and add ruby elements
         * @param {Node} node - Starting node to scan
         */
        scanTextNodes(node) {
            let currentLevel = [node];

            while (currentLevel.length > 0) {
                let curNode = currentLevel.pop();

                // Check if node is still in the DOM
                if (!curNode.parentNode || !this.doc.body.contains(node)) {
                    return;
                }

                let textNode = curNode;

                switch (curNode.nodeType) {
                    case Node.ELEMENT_NODE:
                        // Skip excluded tags and editable content
                        if (
                            curNode.tagName.toLowerCase() in CONFIG.EXCLUDED_TAGS ||
                            curNode.isContentEditable
                        ) {
                            continue;
                        }

                        // Add child nodes to process queue
                        curNode.childNodes.forEach(child => {
                            currentLevel.push(child);
                        });
                        break;

                    case Node.TEXT_NODE:
                        // Process text nodes and add ruby elements
                        while ((textNode = this.addRuby(textNode)));
                        break;
                }
            }
        },

        /**
         * Create ruby element for kanji
         * @param {Node} node - Text node to process
         * @returns {Node|false} - Next text node or false if done
         */
        addRuby(node) {
            // Not a text node
            if (!node.nodeValue) {
                return false;
            }

            // Find kanji in text
            let match = CONFIG.KANJI_REGEX.exec(node.nodeValue);
            if (!match) {
                return false;
            }

            // Create ruby element structure
            let ruby = this.doc.createElement("ruby");
            ruby.appendChild(this.doc.createTextNode(match[0]));

            let rt = this.doc.createElement("rt");
            rt.classList.add("kanji-terminator-rt");
            ruby.appendChild(rt);

            // Add to queue for conversion
            if (this.queue[match[0]]) {
                this.queue[match[0]].push(rt);
            } else {
                this.queue[match[0]] = [rt];
            }

            // Handle remaining text
            let rest = node.splitText(match.index);
            node.parentNode.insertBefore(ruby, rest);
            rest.nodeValue = rest.nodeValue.substring(match[0].length);

            // Return remaining text for recursive processing
            return rest;
        },

        /**
         * Update ruby elements with readings from cache
         * @param {string} kanji - Kanji to update
         */
        updateRubyFromCache(kanji) {
            const reading = CacheService.get(kanji);
            if (!reading) {
                return;
            }

            (this.queue[kanji] || []).forEach(node => {
                node.dataset.rt = reading;
            });

            delete this.queue[kanji];
        }
    };

    // --- API Service ---

    /**
     * Handles API communication for kanji conversion
     */
    const APIService = {
        apiUrl: GM_getValue(CONFIG.RESOLVER_KEY),

        /**
         * Set the API URL
         * @param {string} url - New API URL
         */
        setApiUrl(url) {
            this.apiUrl = url;
            GM_setValue(CONFIG.RESOLVER_KEY, url);
        },

        /**
         * Process all queued kanji
         * @returns {Promise<void>}
         */
        async processQueue() {
            const queue = DOMHandler.queue;
            let chunk = [];
            let requestCount = 0;
            let kanjiCount = 0;
            startTime = Date.now();

            // Process each kanji in the queue
            for (let kanji in queue) {
                kanjiCount++;

                // Use cached reading if available
                if (CacheService.has(kanji)) {
                    DOMHandler.updateRubyFromCache(kanji);
                    continue;
                }

                // Add to current chunk
                chunk.push(kanji);

                // Process chunk when it reaches max size
                if (chunk.length >= CONFIG.CHUNK_SIZE) {
                    requestCount++;
                    this.convertToHiragana(chunk);
                    chunk = [];
                }
            }

            // Process remaining kanji
            if (chunk.length) {
                requestCount++;
                this.convertToHiragana(chunk);
            }

            // Log statistics
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

            // Save updated cache
            CacheService.save();
        },

        /**
         * Convert kanji to hiragana using API
         * @param {string[]} kanjis - Array of kanji to convert
         */
        convertToHiragana(kanjis) {
            if (!kanjis || !kanjis.length) {
                console.debug("Kanji Terminator: No kanji to convert");
                return;
            }

            // Filter out already cached kanji
            kanjis = kanjis.filter(kanji => !CacheService.has(kanji));

            if (!kanjis.length) return;

            // Make API request
            GM_xmlhttpRequest({
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                url: this.apiUrl,
                data: JSON.stringify({ texts: kanjis }),
                onload: response => {
                    try {
                        if (response.responseText) {
                            const json = JSON.parse(response.responseText);

                            // Process and cache each kanji reading
                            json.data.split("\n").forEach((reading, idx) => {
                                const kanji = kanjis[idx];
                                CacheService.set(kanji, reading);
                                DOMHandler.updateRubyFromCache(kanji);
                            });
                        } else {
                            console.debug("Kanji Terminator: Empty response for kanjis", kanjis);
                        }
                    } catch(error) {
                        console.debug("Kanji Terminator: Error processing response", error);
                    }
                },
                onerror: error => {
                    console.debug("Kanji Terminator: Request failed", error);
                }
            });
        }
    };

    // --- App Controller ---

    let startTime;
    const throttledProcessQueue = debounce(() => APIService.processQueue(), CONFIG.DEBOUNCE_DELAY);

    /**
     * Handle DOM mutations
     * @param {MutationRecord[]} mutationList - List of mutations
     */
    function mutationHandler(mutationList) {
        mutationList.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                DOMHandler.scanTextNodes(node);
            });
        });

        throttledProcessQueue();
    }

    /**
     * Prompt user to set API URL
     */
    function promptForApiUrl() {
        const resolver = prompt("Enter your kanji video resolver API URL:");
        if (resolver) {
            APIService.setApiUrl(resolver);
            alert("Resolver API URL saved successfully!");
        }
    }

    /**
     * Initialize the application
     */
    function initialize() {
        // Only run on Japanese pages
        if (document.documentElement.lang !== "ja") {
            return;
        }

        // Load cached kanji readings
        CacheService.load();

        // Initialize DOM handler
        DOMHandler.initialize();

        // Set up mutation observer
        const observer = new MutationObserver(mutationHandler);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Process existing content
        DOMHandler.scanTextNodes(document.body);
    }

    // Register menu command
    GM_registerMenuCommand("Set kanji Resolver API URL", promptForApiUrl);

    // Start the application
    initialize();
}());