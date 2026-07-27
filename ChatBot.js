(function (global) {
    const DEFAULT_MODEL = 'gpt-4.1-nano';
    const DEFAULT_TEMPERATURE = 0.75;
    const DEFAULT_MAX_TURNS = 8;
    const DEFAULT_MAX_TOKENS = 120;
    const STYLE_ID = 'chatbot-styles';
    const PANEL_HIDDEN_CLASS = 'chatbot-panel--hidden';
    const BUBBLE_VISIBLE_CLASS = 'chatbot-bubble--visible';
    const NPC_IDLE_CANDIDATES = [
        'GameAnims/game_idle_breathing_loop',
        'GameAnims/game_idle_neutral',
        'GameAnims/game_talkLoop_neutral'
    ];
    const NPC_WALK_CANDIDATES = [
        'GameAnims/game_walkloop_neutral_01',
        'GameAnims/game_walkloop_neutral_02 stomp',
        'GameAnims/game_walkloop_neutral_03 float'
    ];
    const NPC_TALK_ANIMATION = 'GameAnims/game_talkLoop_neutral';
    const NPC_SKIN_ORDER = [
        'Common/',
        'FullOutfit/',
        'ClothingBotFar/',
        'ClothingBotNear/',
        'ClothingInner/',
        'ClothingTopFar/',
        'ClothingTopNear/',
        'EarAccessory/',
        'FaceAccessory/',
        'EyeStyle/',
        'Hair/',
        'HeadGear/',
        'ShoesFar/',
        'ShoesNear/'
    ];
    const NPC_WALK_SPEED = 300;
    const NPC_ROAM_RADIUS = 3800;
    const NPC_HIT_ANIMATION = 'GameAnims/game_hit';
    const NPC_HIT_FREEZE_DURATION = 0.85;

    const PERSONALITIES = [
                { id: 'susan', name: 'Susan', systemPrompt: 'You are Susan. Friendly, kind, bubbly sense of humour. Keep replies concise and playful, often less than 7 words.', tone: 'friendly' },

        { id: 'glenda', name: 'Glenda', systemPrompt: 'You are Glenda. Wildly imaginative, chaotic, and funny like you are on an LSD trip, but keep replies short and always readable.', tone: 'chaotic' },
    
        { id: 'fred', name: 'Fred', systemPrompt: 'You are Fred. Serious, a bit bored, answer to the point with minimal fluff.', tone: 'serious' },
    ];    

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.chatbot-panel {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: 10px 12px;
    border: 1px solid #444;
    border-radius: 10px;
    font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    font-size: 12px;
    z-index: 220;
    width: min(520px, 92vw);
    box-shadow: 0 10px 25px rgba(0,0,0,0.35);
}
.${PANEL_HIDDEN_CLASS} { display: none; }
.chatbot-panel h3 {
    margin: 0 0 6px 0;
    font-size: 13px;
    letter-spacing: 0.5px;
}
.chatbot-row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    align-items: center;
}
.chatbot-row select,
.chatbot-row input[type="text"] {
    flex: 1;
    background: #111;
    border: 1px solid #555;
    color: #fff;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
}
.chatbot-row button {
    background: #2b6cb0;
    border: 1px solid #144272;
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
}
.chatbot-row button:disabled {
    opacity: 0.6;
    cursor: default;
}
.chatbot-status {
    font-size: 11px;
    color: #cbd5e1;
    margin-top: 4px;
}
.chatbot-footnote {
    margin-top: 4px;
    font-size: 11px;
    color: #9aa8b8;
}
.chatbot-bubble {
    position: absolute;
    left: 50%;
    bottom: calc(100% + var(--speech-offset-y, 10px));
    transform: translate(calc(-50% + var(--speech-offset-x, 0px) + var(--bubble-bump-x, 0px)), calc(var(--speech-translate-y, 6px) + var(--bubble-bump-y, 0px))) scale(0.92);
    transform-origin: bottom center;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 18px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.95);
    color: #111;
    max-width: 620px;
    width: min(620px, 30ch);
    min-height: 90px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
    font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    opacity: 0;
    pointer-events: none;
    z-index: 260;
    transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.chatbot-bubble::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -12px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-width: 8px 10px 0 10px;
    border-style: solid;
    border-color: rgba(255, 255, 255, 0.95) transparent transparent transparent;
}
.chatbot-bubble--npc { background: rgba(249, 168, 212, 0.95); }
.chatbot-bubble--npc::after { border-color: rgba(249, 168, 212, 0.95) transparent transparent transparent; }
.chatbot-bubble--player { background: rgba(177, 233, 255, 0.95); }
.chatbot-bubble--player::after { border-color: rgba(177, 233, 255, 0.95) transparent transparent transparent; }
.${BUBBLE_VISIBLE_CLASS} {
    opacity: 1;
    transform: translate(-50%, -4px) scale(1);
}
.chatbot-bubble--npc {
    --bubble-bump-y: -140px;
    max-width: 520px;
    width: min(520px, 20ch);
    min-height: 72px;
    padding: 12px 16px;
    font-size: 15px;
}
.chatbot-bubble--npc::after {
    bottom: -8px;
    border-width: 7px 9px 0 9px;
}
`;
        document.head.appendChild(style);
    }

    function clampConversation(history, maxTurns) {
        const limit = Math.max(1, maxTurns) * 2;
        return history.slice(-limit);
    }

    function buildMessages(personality, history) {
        const messages = [];
        if (personality?.systemPrompt) {
            messages.push({ role: 'system', content: personality.systemPrompt });
        }
        return messages.concat(history);
    }

    function createBubble(container, variant) {
        if (!container) return null;
        const root = document.createElement('div');
        root.className = `chatbot-bubble chatbot-bubble--${variant || 'npc'}`;
        const text = document.createElement('div');
        root.appendChild(text);
        container.appendChild(root);
        let visible = false;
        return {
            root,
            setText(content) {
                if (!text) return;
                text.textContent = content;
                if (!visible) {
                    requestAnimationFrame(() => {
                        root.classList.add(BUBBLE_VISIBLE_CLASS);
                        visible = true;
                    });
                }
            },
            setTyping() {
                this.setText('...');
            },
            hide() {
                visible = false;
                root.classList.remove(BUBBLE_VISIBLE_CLASS);
            }
        };
    }

    function pickRandomSkin(skinNames, prefix) {
        const filtered = skinNames.filter(name => name.startsWith(prefix));
        if (!filtered.length) return '';
        return filtered[Math.floor(Math.random() * filtered.length)];
    }

    class ChatBotController {
        constructor(options = {}) {
            injectStyles();
            this.options = Object.assign({
                model: DEFAULT_MODEL,
                temperature: DEFAULT_TEMPERATURE,
                maxTurns: DEFAULT_MAX_TURNS,
                maxTokens: DEFAULT_MAX_TOKENS,
                personalities: PERSONALITIES
            }, options);
            this.personalities = Array.isArray(this.options.personalities) && this.options.personalities.length
                ? this.options.personalities
                : PERSONALITIES;
            this.personality = this.personalities[0];
            this.conversation = [];
            this.active = false;
            this.pending = false;
            this.abortController = null;
            this.playerContainer = this.options.playerContainer || null;
            this.gameBoard = this.options.gameBoard || null;
            this.spineLib = this.options.spineLib || (global.spine || null);
            this.renderScale = this.options.renderScale || 1;
            this.playerVisualSize = this.options.playerVisualSize || { width: 2600, height: 2600 };
            this.footOffset = typeof this.options.footOffset === 'number' ? this.options.footOffset : -1130;
            this.floorHeight = typeof this.options.floorHeight === 'number' ? this.options.floorHeight : 1000;
            this.viewport = this.options.viewport || null;
            this.npcAssets = this.options.npcAssets || { skelUrl: 'spine stuff/chibi.skel', atlasUrl: 'spine stuff/chibi.atlas' };
            this.npcOffsetScale = typeof options.offsetScale === 'number' ? options.offsetScale : 0.55;
            this.npcState = { centerX: 0, bottomY: 0, timer: 0, mode: 'idle', facingRight: true, initialized: false, anchorX: 0, targetX: 0, hitFreezeTimer: 0, isHitReacting: false };
            this.includeHairFn = typeof this.options.includeHair === 'function' ? this.options.includeHair : (() => true);
            this.npcColors = null;
            this.npcContainer = null;
            this.npcBubble = null;
            this.playerBubble = null;
            this.npcSpine = null;
            this.statusEl = null;
            this.textInput = null;
            this.panel = null;
            this._raf = null;
            this.npcChatTalkActive = false;

            this.buildPanel();
            this.createNpcContainer();
            this.attachBubbles();
            this.spawnNpc();
        }

        buildPanel() {
            const panel = document.createElement('div');
            panel.className = `chatbot-panel ${PANEL_HIDDEN_CLASS}`;
            const title = document.createElement('h3');
            title.textContent = 'NPC Chat';

            const personaRow = document.createElement('div');
            personaRow.className = 'chatbot-row';
            const personaSelect = document.createElement('select');
            this.personalities.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                personaSelect.appendChild(opt);
            });
            personaSelect.addEventListener('change', () => {
                const next = this.personalities.find(p => p.id === personaSelect.value);
                if (next) {
                    this.personality = next;
                    this.updateStatus(`Personality: ${next.name}`);
                    this.randomizeNpcLook();
                }
            });
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', () => this.stopChat());
            personaRow.append(personaSelect, closeBtn);

            const inputRow = document.createElement('div');
            inputRow.className = 'chatbot-row';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Type your message and press Enter...';
            const sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.textContent = 'Send';
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendFromInput();
                }
            });
            sendBtn.addEventListener('click', () => this.sendFromInput());
            inputRow.append(input, sendBtn);

            const status = document.createElement('div');
            status.className = 'chatbot-status';
            status.textContent = 'Press T to toggle chat.';

            const footnote = document.createElement('div');
            footnote.className = 'chatbot-footnote';
            footnote.textContent = `Model: ${this.options.model || DEFAULT_MODEL} - Typing shows in the bubbles - T to open/close`;

            panel.append(title, personaRow, inputRow, status, footnote);
            document.body.appendChild(panel);

            this.panel = panel;
            this.textInput = input;
            this.statusEl = status;
        }

        createNpcContainer() {
            if (!this.gameBoard) return;
            const npcContainer = document.createElement('div');
            npcContainer.id = 'npc-container';
            npcContainer.style.position = 'absolute';
            npcContainer.style.pointerEvents = 'none';
            npcContainer.style.overflow = 'visible';
            npcContainer.style.display = 'flex';
            npcContainer.style.justifyContent = 'center';
            npcContainer.style.alignItems = 'flex-end';
            npcContainer.style.transformOrigin = 'top left';
            npcContainer.style.zIndex = '2';
            this.gameBoard.appendChild(npcContainer);
            this.npcContainer = npcContainer;
        }

        attachBubbles() {
            if (this.playerContainer) {
                this.playerBubble = createBubble(this.playerContainer, 'player');
            }
            if (this.npcContainer) {
                this.npcBubble = createBubble(this.npcContainer, 'npc');
            }
        }

        updateNpc(dt, ctx = {}) {
            if (this.active) {
                // Freeze NPC while chat UI is active
                this.npcState.vx = 0;
                this.npcState.mode = 'idle';
                if (!this.npcChatTalkActive) {
                    this.setNpcTalkLoop();
                    this.npcChatTalkActive = true;
                }
                return;
            }
            this.npcChatTalkActive = false;
            if (!this.npcContainer) return;
            const worldWidth = ctx.worldWidth || 0;
            const worldHeight = ctx.worldHeight || 0;
            const camera = ctx.camera || { x: 0, y: 0 };
            const zoomLevel = ctx.zoomLevel || 1;
            const spineCanvasRenderZoom = ctx.spineCanvasRenderZoom || zoomLevel;
            const containerWidth = (ctx.containerSize?.width) || this.playerVisualSize.width || 2600;
            const containerHeight = (ctx.containerSize?.height) || this.playerVisualSize.height || 2600;
            const floorHeight = typeof ctx.floorHeight === 'number' ? ctx.floorHeight : this.floorHeight;
            const footOffset = typeof ctx.footOffset === 'number' ? ctx.footOffset : this.footOffset;
            const playerPos = ctx.playerWorld || null;

            if (!this.npcState.initialized) {
                const baseX = playerPos?.x || (worldWidth / 2);
                const baseY = playerPos?.y || (worldHeight - floorHeight);
                const initialX = baseX + (Math.random() * 800 - 400);
                this.npcState.centerX = initialX;
                this.npcState.bottomY = Math.max(0, Math.min(worldHeight, baseY));
                this.npcState.anchorX = initialX;
                this.npcState.initialized = true;
                this.npcState.timer = 0;
                this.npcState.mode = 'idle';
                this.npcState.facingRight = true;
            }

            this.advanceNpcBehaviour(dt, { worldWidth, worldHeight, floorHeight });
            this.applyNpcScreenPosition({
                camera,
                zoomLevel,
                spineCanvasRenderZoom,
                containerWidth,
                containerHeight,
                footOffset
            });
        }

        spawnNpc() {
            if (!this.spineLib || !this.npcContainer || !this.npcAssets?.skelUrl || !this.npcAssets?.atlasUrl) return;
            const boardRect = this.gameBoard?.getBoundingClientRect();
            if (boardRect && (boardRect.width === 0 || boardRect.height === 0)) {
                requestAnimationFrame(() => this.spawnNpc());
                return;
            }
            new this.spineLib.SpinePlayer(this.npcContainer, {
                skelUrl: this.npcAssets.skelUrl,
                atlasUrl: this.npcAssets.atlasUrl,
                premultipliedAlpha: true,
                alpha: true,
                showControls: false,
                defaultMix: 0.05,
                fitToCanvas: false,
                viewport: this.viewport || null,
                success: (instance) => {
                    this.npcSpine = instance;
                    this.randomizeNpcLook();
                    this.setNpcIdle();
                },
                error: (err) => {
                    console.error('[ChatBot NPC] Failed to load spine:', err);
                    this.updateStatus('NPC model failed to load.');
                }
            });
        }

        randomizeNpcLook() {
            if (!this.npcSpine?.skeleton?.data) return;
            const data = this.npcSpine.skeleton.data;
            const skinNames = data.skins.map(s => s.name);
            const combined = new this.spineLib.Skin('npc-random-skin');
            const order = this.options.npcSkinOrder || NPC_SKIN_ORDER;
            // Always prefer Common/Base first if present.
            const defaultBase = skinNames.includes('Common/Base') ? 'Common/Base' : '';
            if (defaultBase) {
                const base = data.findSkin(defaultBase);
                if (base) combined.addSkin(base);
            }
            order.forEach(prefix => {
                const name = pickRandomSkin(skinNames, prefix);
                if (!name) return;
                const skinToAdd = data.findSkin(name);
                if (skinToAdd) combined.addSkin(skinToAdd);
            });
            const skeleton = this.npcSpine.skeleton;
            skeleton.setSkin(combined);
            skeleton.setSlotsToSetupPose();
            const colorsFn = typeof this.options.generateColors === 'function' ? this.options.generateColors : null;
            const applyFn = typeof this.options.applyColors === 'function' ? this.options.applyColors : null;
            if (!this.npcColors && colorsFn) {
                this.npcColors = colorsFn(null, { skin: true, hair: true, eyes: true });
            }
            if (applyFn && this.npcColors) {
                applyFn(skeleton, this.npcColors, { includeHair: this.includeHairFn() });
            }
            if (this.npcSpine.sceneRenderer?.skeletonRenderer?.premultipliedAlpha !== undefined) {
                this.npcSpine.sceneRenderer.skeletonRenderer.premultipliedAlpha = true;
            }
            this.setNpcIdle();
        }

        setNpcIdle() {
            const state = this.npcSpine?.animationState;
            const data = this.npcSpine?.skeleton?.data;
            if (!state || !data) return;
            const pick = (this.options.npcIdleCandidates || NPC_IDLE_CANDIDATES).find(name => data.findAnimation(name));
            if (pick) {
                state.setAnimation(0, pick, true);
            }
        }

        setNpcWalk() {
            const state = this.npcSpine?.animationState;
            const data = this.npcSpine?.skeleton?.data;
            if (!state || !data) return;
            const pick = (this.options.npcWalkCandidates || NPC_WALK_CANDIDATES).find(name => data.findAnimation(name));
            if (pick) {
                state.setAnimation(0, pick, true);
            } else {
                this.setNpcIdle();
            }
        }

        setNpcTalkLoop() {
            const state = this.npcSpine?.animationState;
            const data = this.npcSpine?.skeleton?.data;
            if (!state || !data) return;
            if (data.findAnimation(NPC_TALK_ANIMATION)) {
                state.setAnimation(0, NPC_TALK_ANIMATION, true);
            } else {
                this.setNpcIdle();
            }
        }

        toggleChat() {
            if (this.active) this.stopChat(); else this.startChat();
            return true;
        }

        advanceNpcBehaviour(dt, bounds) {
            const state = this.npcState;
            if (!state || !Number.isFinite(dt)) return;
            const worldWidth = bounds.worldWidth || 0;
            const worldHeight = bounds.worldHeight || 0;
            const floorHeight = typeof bounds.floorHeight === 'number' ? bounds.floorHeight : this.floorHeight;
            const groundY = Math.max(0, worldHeight - floorHeight);
            state.bottomY = groundY;

            if (state.hitFreezeTimer > 0) {
                state.hitFreezeTimer = Math.max(0, state.hitFreezeTimer - dt);
                state.vx = 0;
                state.mode = 'idle';
                if (state.hitFreezeTimer === 0 && state.isHitReacting) {
                    state.isHitReacting = false;
                    state.timer = 0.6;
                    this.setNpcIdle();
                }
                if (this.npcSpine?.skeleton) {
                    this.npcSpine.skeleton.scaleX = state.facingRight ? 1 : -1;
                }
                return;
            }

            state.timer -= dt;
            if (state.timer <= 0) {
                const chooseWalk = Math.random() < 0.6;
                if (chooseWalk) {
                    const roamRadius = this.options.npcRoamRadius || NPC_ROAM_RADIUS;
                    const minX = Math.max(0, state.anchorX - roamRadius);
                    const maxX = Math.max(minX + 1, state.anchorX + roamRadius);
                    state.targetX = minX + Math.random() * (maxX - minX);
                    const speed = this.options.npcWalkSpeed || NPC_WALK_SPEED;
                    const dir = state.targetX >= state.centerX ? 1 : -1;
                    state.vx = dir * speed;
                    state.mode = 'walk';
                    state.timer = 3.0; // max walk duration before re-evaluating
                    state.facingRight = dir < 0; // match player convention (true = left)
                    this.setNpcWalk();
                } else {
                    state.vx = 0; state.vy = 0;
                    state.mode = 'idle';
                    state.timer = 0.8 + Math.random() * 1.8;
                    this.setNpcIdle();
                }
            }

            if (state.mode === 'walk') {
                const step = (state.vx || 0) * dt;
                const nextX = state.centerX + step;
                const halfW = 0.5 * (this.playerVisualSize?.width || 2600);
                const roamRadius = this.options.npcRoamRadius || NPC_ROAM_RADIUS;
                const minX = Math.max(halfW, state.anchorX - roamRadius);
                const maxX = Math.min(Math.max(minX + 1, worldWidth - halfW), state.anchorX + roamRadius + halfW);
                state.centerX = Math.max(minX, Math.min(maxX, nextX));
                if ((state.vx >= 0 && state.centerX >= state.targetX) || (state.vx < 0 && state.centerX <= state.targetX)) {
                    state.timer = 0;
                    state.mode = 'idle';
                    state.vx = 0;
                    this.setNpcIdle();
                }
            }

            // Face direction on the skeleton (match player convention)
            if (this.npcSpine?.skeleton) {
                this.npcSpine.skeleton.scaleX = state.facingRight ? 1 : -1;
            }
        }

        getNpcWorldBounds() {
            if (!this.npcState?.initialized) return null;
            const width = (this.playerVisualSize?.width) || 2600;
            const height = (this.playerVisualSize?.height) || 2600;
            const footOffset = typeof this.footOffset === 'number' ? this.footOffset : 0;
            const centerX = this.npcState.centerX || 0;
            const bottomY = this.npcState.bottomY || 0;
            const left = centerX - (width / 2);
            const top = bottomY - height - footOffset;
            return {
                x: left,
                y: top,
                width,
                height,
                left,
                top,
                right: left + width,
                bottom: top + height
            };
        }

        playNpcHitAnimation() {
            const state = this.npcSpine?.animationState;
            const data = this.npcSpine?.skeleton?.data;
            if (!state || !data) return;
            if (data.findAnimation(NPC_HIT_ANIMATION)) {
                const entry = state.setAnimation(0, NPC_HIT_ANIMATION, false);
                if (entry) {
                    entry.mixDuration = 0.05;
                    entry.listener = {
                        complete: () => { if (this.npcState.hitFreezeTimer <= 0) this.setNpcIdle(); },
                        end: () => { if (this.npcState.hitFreezeTimer <= 0) this.setNpcIdle(); },
                        dispose: () => { if (this.npcState.hitFreezeTimer <= 0) this.setNpcIdle(); }
                    };
                }
            } else {
                this.setNpcIdle();
            }
        }

        playHitReaction(options = {}) {
            const freezeDuration = Math.max(0, options.freezeDuration ?? NPC_HIT_FREEZE_DURATION);
            this.npcState.hitFreezeTimer = freezeDuration;
            this.npcState.mode = 'idle';
            this.npcState.vx = 0;
            this.npcState.isHitReacting = true;
            this.playNpcHitAnimation();
        }

        startChat() {
            this.active = true;
            this.panel?.classList.remove(PANEL_HIDDEN_CLASS);
            this.updateStatus(`Chatting as ${this.personality?.name || 'NPC'}`);
            this.textInput?.focus();
            this.conversation = clampConversation(this.conversation, this.options.maxTurns);
            if (typeof this.options.onChatStateChange === 'function') {
                this.options.onChatStateChange(true);
            }
        }

        stopChat() {
            this.active = false;
            this.npcChatTalkActive = false;
            this.pending = false;
            this.abortRequest();
            this.panel?.classList.add(PANEL_HIDDEN_CLASS);
            this.setNpcTyping(false);
            this.npcBubble?.hide();
            this.playerBubble?.hide();
            if (typeof this.options.onChatStateChange === 'function') {
                this.options.onChatStateChange(false);
            }
        }

        applyNpcScreenPosition(ctx) {
            const camera = ctx.camera || { x: 0, y: 0 };
            const zoom = ctx.zoomLevel || 1;
            const spineCanvasRenderZoom = ctx.spineCanvasRenderZoom || zoom;
            const containerWidth = (ctx.containerWidth !== undefined ? ctx.containerWidth : (ctx.containerSize?.width)) || 2600;
            const containerHeight = (ctx.containerHeight !== undefined ? ctx.containerHeight : (ctx.containerSize?.height)) || 2600;
            const footOffset = typeof ctx.footOffset === 'number' ? ctx.footOffset : this.footOffset;
            const centerX = this.npcState.centerX || 0;
            const bottomY = this.npcState.bottomY || 0;
            const containerWorldLeft = centerX - (containerWidth / 2);
            const containerWorldTop = bottomY - containerHeight - footOffset;
            const screenLeft = (containerWorldLeft - camera.x) * zoom;
            const screenTop = (containerWorldTop - camera.y) * zoom;
            const screenWidth = containerWidth * zoom;
            const screenHeight = containerHeight * zoom;
            this.npcContainer.style.left = `${screenLeft}px`;
            this.npcContainer.style.top = `${screenTop}px`;
            this.npcContainer.style.width = `${screenWidth}px`;
            this.npcContainer.style.height = `${screenHeight}px`;
            const spineSurface = this.npcContainer.querySelector(':scope > .spine-player');
            if (spineSurface) {
                const renderWidth = Math.max(1, containerWidth * spineCanvasRenderZoom);
                const renderHeight = Math.max(1, containerHeight * spineCanvasRenderZoom);
                const displayScale = zoom / spineCanvasRenderZoom;
                const layoutKey = `${renderWidth}|${renderHeight}|${displayScale}`;
                if (spineSurface.dataset.gameZoomLayout !== layoutKey) {
                    spineSurface.dataset.gameZoomLayout = layoutKey;
                    Object.assign(spineSurface.style, {
                        position: 'absolute',
                        left: '0',
                        top: '0',
                        width: `${renderWidth}px`,
                        height: `${renderHeight}px`,
                        transformOrigin: 'top left',
                        transform: `scale(${displayScale})`,
                        willChange: 'transform'
                    });
                }
            }
            const speechOffsetY = -800 * zoom;
            const speechTranslateY = 6 * zoom;
            const speechOffsetX = -250 * zoom;
            this.npcContainer.style.setProperty('--speech-offset-y', `${speechOffsetY}px`);
            this.npcContainer.style.setProperty('--speech-translate-y', `${speechTranslateY}px`);
            this.npcContainer.style.setProperty('--speech-offset-x', `${speechOffsetX}px`);
            const applyFn = typeof this.options.applyColors === 'function' ? this.options.applyColors : null;
            if (applyFn && this.npcSpine?.skeleton && this.npcColors) {
                applyFn(this.npcSpine.skeleton, this.npcColors, { includeHair: this.includeHairFn() });
            }
            this.resolveBubbleOverlap();
        }

        resolveBubbleOverlap() {
            const npcRoot = this.npcBubble?.root;
            const playerRoot = this.playerBubble?.root;
            if (!npcRoot || !playerRoot) return;
            const npcVisible = npcRoot.classList.contains(BUBBLE_VISIBLE_CLASS);
            const playerVisible = playerRoot.classList.contains('speech-bubble--visible');
            if (!npcVisible || !playerVisible) {
                npcRoot.style.setProperty('--bubble-bump-y', '0px');
                npcRoot.style.setProperty('--bubble-bump-x', '0px');
                playerRoot.style.setProperty('--bubble-bump-y', '0px');
                playerRoot.style.setProperty('--bubble-bump-x', '0px');
                return;
            }
            const npcRect = npcRoot.getBoundingClientRect();
            const playerRect = playerRoot.getBoundingClientRect();
            const overlap = !(npcRect.right < playerRect.left || npcRect.left > playerRect.right || npcRect.bottom < playerRect.top || npcRect.top > playerRect.bottom);
            if (overlap) {
                const horizontalPush = 160;
                const verticalPush = 160;
                const npcShiftX = npcRect.left >= playerRect.left ? horizontalPush : -horizontalPush;
                const playerShiftX = -npcShiftX;
                npcRoot.style.setProperty('--bubble-bump-y', `-${verticalPush}px`);
                npcRoot.style.setProperty('--bubble-bump-x', `${npcShiftX}px`);
                playerRoot.style.setProperty('--bubble-bump-y', `${verticalPush}px`);
                playerRoot.style.setProperty('--bubble-bump-x', `${playerShiftX}px`);
            } else {
                npcRoot.style.setProperty('--bubble-bump-y', '0px');
                npcRoot.style.setProperty('--bubble-bump-x', '0px');
                playerRoot.style.setProperty('--bubble-bump-y', '0px');
                playerRoot.style.setProperty('--bubble-bump-x', '0px');
            }
        }

        abortRequest() {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
        }

        sendFromInput() {
            if (!this.active) this.startChat();
            const text = (this.textInput?.value || '').trim();
            if (!text) return;
            if (this.textInput) this.textInput.value = '';
            this.sendMessage(text);
        }

        sendMessage(text) {
            if (!text) return;
            if (this.active) {
                // Pause roaming while chatting
                this.npcState.vx = 0;
                this.npcState.mode = 'idle';
                this.setNpcIdle();
            }
            this.conversation.push({ role: 'user', content: text });
            this.conversation = clampConversation(this.conversation, this.options.maxTurns);
            this.playerBubble?.setText(text);
            this.setNpcTyping(true);
            this.fetchReply();
        }

        async fetchReply() {
            if (this.pending) return;
            const proxyUrl = typeof this.options.getProxyUrl === 'function'
                ? this.options.getProxyUrl()
                : (global.ANIMEE_CHAT_PROXY_URL || '');
            if (!proxyUrl) {
                this.setNpcTyping(false);
                this.npcBubble?.setText('Chat is offline.');
                this.updateStatus('Configure a secure backend proxy to enable replies.');
                return;
            }
            let endpoint;
            try {
                endpoint = new URL(proxyUrl, global.location?.href);
                if (endpoint.protocol !== 'https:') throw new Error('Chat proxy must use HTTPS.');
            } catch (error) {
                this.setNpcTyping(false);
                this.npcBubble?.setText('Chat proxy is unavailable.');
                this.updateStatus(error?.message || 'Invalid chat proxy URL.');
                return;
            }
            this.pending = true;
            this.abortRequest();
            this.abortController = new AbortController();
            const payload = {
                model: this.options.model || DEFAULT_MODEL,
                messages: buildMessages(this.personality, this.conversation),
                max_tokens: this.options.maxTokens || DEFAULT_MAX_TOKENS,
                temperature: this.options.temperature ?? DEFAULT_TEMPERATURE
            };
            try {
                const res = await fetch(endpoint.href, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload),
                    signal: this.abortController.signal
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data?.error?.message || `HTTP ${res.status}`);
                }
                const reply = data?.choices?.[0]?.message?.content?.trim();
                if (reply) {
                    this.conversation.push({ role: 'assistant', content: reply });
                    this.conversation = clampConversation(this.conversation, this.options.maxTurns);
                    this.npcBubble?.setText(reply);
                    this.updateStatus(`${this.personality?.name || 'NPC'} replied.`);
                } else {
                    this.npcBubble?.setText('No reply received.');
                    this.updateStatus('API returned no content.');
                }
            } catch (err) {
                if (err?.name === 'AbortError') return;
                console.error('[ChatBot] API error', err);
                this.npcBubble?.setText('Oops, I lost my words.');
                this.updateStatus(err?.message || 'API error');
            } finally {
                this.pending = false;
                this.setNpcTyping(false);
            }
        }

        setNpcTyping(isTyping) {
            if (isTyping) {
                this.npcBubble?.setTyping();
                this.updateStatus('NPC is typing...');
            }
        }

        updateStatus(message) {
            if (this.statusEl) this.statusEl.textContent = message || '';
        }

        isChatElement(target) {
            if (!target || !this.panel) return false;
            return this.panel.contains(target);
        }

        handleKeyDown(event) {
            const key = (event.key || '').toLowerCase();
            if (key === 't' && !event.repeat) {
                if (this.isChatElement(event.target)) {
                    return true; // handled inside chat UI; do not toggle or block typing
                }
                event.preventDefault();
                this.toggleChat();
                return true;
            }
            if (!this.active) return false;
            // prevent roaming while in chat mode
            this.npcState.vx = 0;
            this.npcState.mode = 'idle';
            if (key === 'escape') {
                event.preventDefault();
                this.stopChat();
                return true;
            }
            if (key === 'enter' && this.textInput === document.activeElement) {
                event.preventDefault();
                this.sendFromInput();
                return true;
            }
            if (this.isChatElement(event.target)) {
                return true;
            }
            return false;
        }

        handleKeyUp(event) {
            if (!this.active) return false;
            if (this.isChatElement(event.target)) return true;
            return false;
        }

        shouldBlockGameInput() {
            return this.active;
        }

        destroy() {
            const removeNode = (node) => {
                if (node && node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            };
            this.stopChat();
            this.abortRequest();
            this.pending = false;
            this.npcChatTalkActive = false;
            this.conversation = [];
            if (this.npcSpine?.dispose) {
                try { this.npcSpine.dispose(); } catch (_) { /* ignore */ }
            } else if (this.npcSpine?.destroy) {
                try { this.npcSpine.destroy(); } catch (_) { /* ignore */ }
            }
            this.npcSpine = null;
            removeNode(this.npcBubble?.root);
            removeNode(this.playerBubble?.root);
            removeNode(this.panel);
            removeNode(this.npcContainer);
            this.npcBubble = null;
            this.playerBubble = null;
            this.panel = null;
            this.npcContainer = null;
            this.statusEl = null;
            this.textInput = null;
            this.npcState.initialized = false;
        }

        isChatting() {
            return this.active;
        }
    }

    global.ChatBot = {
        create: (options) => new ChatBotController(options)
    };
})(window);
