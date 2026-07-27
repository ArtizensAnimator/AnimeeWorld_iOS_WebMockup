(function (global) {
    const STYLE_ID = 'speech-bubble-styles';
    const BUBBLE_CLASS = 'speech-bubble';
    const VISIBLE_CLASS = 'speech-bubble--visible';
    const BUBBLE_WIDTH = 650;
    const BUBBLE_MIN_HEIGHT =120;
    const BUBBLE_LINE_WIDTH_CH = 25;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.${BUBBLE_CLASS} {
    position: absolute;
    left: 50%;
    
    bottom: calc(100% + var(--speech-offset-y, 10px));

    transform: translate(calc(-50% + var(--bubble-bump-x, 0px)), calc(var(--speech-translate-y, 6px) + var(--bubble-bump-y, 0px))) scale(0.92);

    transform-origin: bottom center;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 22px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.92);
    color: #222;
    max-width: ${BUBBLE_WIDTH}px;
    width: min(${BUBBLE_WIDTH}px, ${BUBBLE_LINE_WIDTH_CH}ch);
    min-height: ${BUBBLE_MIN_HEIGHT}px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.4;
    text-align: center;
    font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    opacity: 0;
    pointer-events: none;
    z-index: 250;
    transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
.${BUBBLE_CLASS}::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -12px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-width: 8px 10px 0 10px;
    border-style: solid;
    border-color: rgba(255, 255, 255, 0.92) transparent transparent transparent;
}
.${BUBBLE_CLASS}.${VISIBLE_CLASS} {
    opacity: 1;
    transform: translate(calc(-50% + var(--bubble-bump-x, 0px)), calc(-4px + var(--bubble-bump-y, 0px))) scale(1);
}
`;
        document.head.appendChild(style);
    }

    function scrubPhrases(rawPhrases) {
        if (!Array.isArray(rawPhrases)) return [];
        return rawPhrases
            .map(entry => typeof entry === 'string' ? entry.trim() : '')
            .filter(entry => entry.length > 0);
    }

    function pickRandom(phrases, previous) {
        if (!phrases.length) return '';
        if (phrases.length === 1) return phrases[0];
        let phrase = phrases[Math.floor(Math.random() * phrases.length)];
        if (phrase === previous) {
            phrase = phrases[Math.floor(Math.random() * phrases.length)];
        }
        return phrase;
    }

    class SpeechBubbleController {
        constructor(container, phrasesUrl) {
            this.container = container || null;
            this.phrasesUrl = phrasesUrl || null;
            this.root = null;
            this.textElement = null;
            this.phrases = [];
            this.lastPhrase = '';
            this.visible = false;
            this.pendingShow = false;
            this.phrasesLoaded = false;
            injectStyles();
            this.initDOM();
            if (this.phrasesUrl) {
                this.loadPhrases(this.phrasesUrl);
            }
        }

        initDOM() {
            if (!this.container) {
                console.warn('[SpeechBubble] Missing container element.');
                return;
            }
            const root = document.createElement('div');
            root.className = BUBBLE_CLASS;
            const text = document.createElement('div');
            root.appendChild(text);
            this.container.appendChild(root);
            this.root = root;
            this.textElement = text;
        }

        async loadPhrases(url) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const phrases = scrubPhrases(data);
                if (!phrases.length) {
                    console.warn('[SpeechBubble] No valid phrases found in JSON.');
                } else {
                    this.phrases = phrases;
                }
            } catch (error) {
                console.error('[SpeechBubble] Failed to load phrases:', error);
            } finally {
                this.phrasesLoaded = true;
                if (this.pendingShow) {
                    this.pendingShow = false;
                    this.show();
                }
            }
        }

        handleTalkState(isTalking) {
            if (!this.root || !this.textElement) return;
            if (isTalking) {
                if (this.visible) return;
                if (!this.phrasesLoaded) {
                    this.pendingShow = true;
                    return;
                }
                this.show();
            } else if (this.visible) {
                this.hide();
            }
        }

        show() {
            if (!this.root || !this.textElement) return;
            if (!this.phrases.length) return;
            const phrase = pickRandom(this.phrases, this.lastPhrase);
            this.lastPhrase = phrase;
            this.textElement.textContent = phrase;
            requestAnimationFrame(() => {
                this.root.classList.add(VISIBLE_CLASS);
                this.visible = true;
            });
        }

        hide() {
            if (!this.root) return;
            this.root.classList.remove(VISIBLE_CLASS);
            this.visible = false;
        }
    }

    function createController(options = {}) {
        const container = options.container instanceof HTMLElement ? options.container : null;
        const phrasesUrl = typeof options.phrasesUrl === 'string' ? options.phrasesUrl : null;
        return new SpeechBubbleController(container, phrasesUrl);
    }

    global.SpeechBubbleManager = { create: createController };
})(window);
