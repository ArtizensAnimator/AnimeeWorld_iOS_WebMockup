import { BackgroundTileRenderer, loadTiledBackgroundScene } from './backgroundTiles.js';
import { createBeaverNpcController } from './beaverNpc.js';

   const __animeeStartGame = () => {
            if (!spine || !spine.SpinePlayer) {
                console.error("SpinePlayer not found.");
                document.getElementById('debug-info').textContent = "Error: SpinePlayer library not found.";
                return;
            }

            function installSpineRuntimeCompatibility() {
                const runtime = window.spine || spine;
                const defineAlias = (proto, name, get, set) => {
                    if (!proto || Object.prototype.hasOwnProperty.call(proto, name)) return;
                    Object.defineProperty(proto, name, { configurable: true, get, set });
                };
                const skeletonProto = runtime?.Skeleton?.prototype;
                if (skeletonProto) {
                    if (!skeletonProto.setToSetupPose && skeletonProto.setupPose) skeletonProto.setToSetupPose = skeletonProto.setupPose;
                    if (!skeletonProto.setSlotsToSetupPose && skeletonProto.setupPoseSlots) skeletonProto.setSlotsToSetupPose = skeletonProto.setupPoseSlots;
                    if (!skeletonProto.setBonesToSetupPose && skeletonProto.setupPoseBones) skeletonProto.setBonesToSetupPose = skeletonProto.setupPoseBones;
                }
                const animationStateProto = runtime?.AnimationState?.prototype;
                if (animationStateProto && !animationStateProto.getCurrent && animationStateProto.getTrack) {
                    animationStateProto.getCurrent = animationStateProto.getTrack;
                }
                defineAlias(runtime?.Slot?.prototype, 'attachment', function () {
                    return this.pose?.attachment ?? null;
                }, function (attachment) {
                    if (this.pose) this.pose.attachment = attachment;
                });
                defineAlias(runtime?.Bone?.prototype, 'x', function () {
                    return this.pose?.x ?? 0;
                }, function (value) {
                    if (this.pose) this.pose.x = value;
                });
                defineAlias(runtime?.Bone?.prototype, 'y', function () {
                    return this.pose?.y ?? 0;
                }, function (value) {
                    if (this.pose) this.pose.y = value;
                });
                defineAlias(runtime?.Bone?.prototype, 'worldX', function () {
                    return this.appliedPose?.worldX ?? 0;
                }, function (value) {
                    if (this.appliedPose) this.appliedPose.worldX = value;
                });
                defineAlias(runtime?.Bone?.prototype, 'worldY', function () {
                    return this.appliedPose?.worldY ?? 0;
                }, function (value) {
                    if (this.appliedPose) this.appliedPose.worldY = value;
                });
            }

            installSpineRuntimeCompatibility();

            const TMP_BOUNDS_OFFSET = new spine.Vector2();
            const TMP_BOUNDS_SIZE = new spine.Vector2();
            const TMP_BOUNDS_ARRAY = [];

            function resetSpineSlotsToSetupPose(skeleton) {
                if (typeof skeleton?.setupPoseSlots === 'function') {
                    skeleton.setupPoseSlots();
                } else if (typeof skeleton?.setSlotsToSetupPose === 'function') {
                    skeleton.setSlotsToSetupPose();
                }
            }

            function resetSpineBonesToSetupPose(skeleton) {
                if (typeof skeleton?.setupPoseBones === 'function') {
                    skeleton.setupPoseBones();
                } else if (typeof skeleton?.setBonesToSetupPose === 'function') {
                    skeleton.setBonesToSetupPose();
                }
            }

            // MARK: - --- Game Constants and VARIABLES ---
            const IS_NATIVE_IOS = window.Capacitor?.getPlatform?.() === 'ios';
            const CHARACTER_SKEL_URL = 'spine stuff/chibi-8.skel';
            const CHARACTER_ATLAS_URL = IS_NATIVE_IOS
                ? 'spine stuff/chibi-mobile.atlas'
                : 'spine stuff/chibi.atlas';
            const SPINE_RENDER_SCALE = .3;
            const PLAYER_WORLD_SIZE_SCALE = 0.8;
            const PLAYER_SKELETON_VISUAL_SCALE = 0.85 * PLAYER_WORLD_SIZE_SCALE;
            let CANVAS_WIDTH = Math.max(1, Math.floor(window.innerWidth || 990));
            let CANVAS_HEIGHT = Math.max(1, Math.floor(window.innerHeight || 990));
            const DEFAULT_WORLD_WIDTH = 12000;
            const DEFAULT_WORLD_HEIGHT = 13971;
            let WORLD_WIDTH = DEFAULT_WORLD_WIDTH;
            let WORLD_HEIGHT = DEFAULT_WORLD_HEIGHT;
            const PLAYER_CONTAINER_SIZE = { width: 2600, height: 2600 }; // Fixed visual container to prevent jitter
            const PLAYER_VIEWPORT_OFFSET = { x: 0, y: 550 }; // Shift Spine scene up/down within the container
            let PLAYER_VISUAL_WIDTH = PLAYER_CONTAINER_SIZE.width;
            let PLAYER_VISUAL_HEIGHT = PLAYER_CONTAINER_SIZE.height;
            const PLAYER_VIEWPORT_WORLD = {
                x: -(PLAYER_CONTAINER_SIZE.width / SPINE_RENDER_SCALE) / 2 + PLAYER_VIEWPORT_OFFSET.x,
                y: -(PLAYER_CONTAINER_SIZE.height / SPINE_RENDER_SCALE) / 2 + PLAYER_VIEWPORT_OFFSET.y,
                width: PLAYER_CONTAINER_SIZE.width / SPINE_RENDER_SCALE,
                height: PLAYER_CONTAINER_SIZE.height / SPINE_RENDER_SCALE
            };
            const PLAYER_VIEWPORT_CONFIG = {
                x: PLAYER_VIEWPORT_WORLD.x,
                y: PLAYER_VIEWPORT_WORLD.y,
                width: PLAYER_VIEWPORT_WORLD.width,
                height: PLAYER_VIEWPORT_WORLD.height,
                padLeft: 0,
                padRight: 0,
                padTop: 0,
                padBottom: 0,
                clip: false,
                debugRender: false,
                transitionTime: 0,
                animations: {}
            };

            const PLAYER_COLLISION_BOX = {
                width: 80 * PLAYER_WORLD_SIZE_SCALE,
                height: 200 * PLAYER_WORLD_SIZE_SCALE
            };
            const PLAYER_HITBOX_OFFSET_X = 0;
            const PLAYER_HITBOX_OFFSET_Y = 0;
            let PLAYER_HITBOX_WIDTH = PLAYER_COLLISION_BOX.width;
            let PLAYER_HITBOX_HEIGHT = PLAYER_COLLISION_BOX.height;

            const FOOT_OFFSET = -1130 // positive lifts sprite up

            const SPEED_SCALE_FACTOR = SPINE_RENDER_SCALE * 5;
            let PLAYER_WALK_SPEED = 385 * SPEED_SCALE_FACTOR;
            let PLAYER_RUN_SPEED = 650 * SPEED_SCALE_FACTOR;
            const JUMP_VELOCITY = -1650; // pixels per second
            const GRAVITY = 5900; // pixels per second^2
            const MAX_JUMP_HOLD_TIME = 0.22; // seconds
            const JUMP_APEX_SMOOTHING = 60; // Velocity buffer around the apex to prevent flicker
            const DOUBLE_JUMP_FALL_GRACE = 0.18; // Time (s) to delay single-fall intro so double jump can take over
            const LAND_BLEND_TO_RUN_THRESHOLD = 300; // Speed threshold to skip landing and blend directly to move
            const GROUND_ANIMATION_LOCKOUT = 0.12; // Seconds after leaving ground before ground anims can resume
            const JUMP_HOLD_ACCELERATION = -1900; // extra upward force while held
            const JUMP_RELEASE_DAMPING = 2000; // additionaDl downward force when released early
            const SLOPE_SLIDE_ANGLE_THRESHOLD_DEG = 40; // tweakable threshold for slide animation
            const SLOPE_SLIDE_SPEED = 1200; // horizontal speed along slope when sliding
            const SLOPE_TILT_BLEND_IN_SPEED = 140; // degrees per second toward target tilt
            const SLOPE_TILT_BLEND_OUT_SPEED = 820; // degrees per second back to upright
            const RUN_FLIP_DELAY_SECONDS = 1 / 60; // delay before flipping when changing run direction

            // Jetpack variables (adjust to taste)
            let JETPACK_MAX_FUEL = 14.35; // 30% less fuel than the previous prototype
            let JETPACK_BURN_RATE = 1.7; // fuel consumed per second while thrusting
            let JETPACK_REFUEL_RATE_GROUNDED = 2.2; // fuel regenerated per second on the ground
            let JETPACK_REFUEL_RATE_AIRBORNE = 0; // fuel regenerated per second while coasting in air
            let JETPACK_THRUST_ACCEL = -7200; // slow rocket-like acceleration after gravity
            let JETPACK_MAX_ASCENT_SPEED = -3800; // higher eventual rocket top speed

            const BLOCK_SCALE = .5; // 
            const FLOOR_GRID_SIZE = 120;
            const FLOOR_GRID_COLOR = 'rgba(255, 255, 255, 0.1)';
            const FLOOR_GRID_BACKGROUND = '#1a1c20';

            const FLOOR_HEIGHT = 820; // pixels from bottom; ground is another 200 world pixels lower


            //DEBUG ON OR OFF DEBUG SETTINGS
            let DEBUG_DRAW = false; // set to true to show boxes and angles etc, false to hide
            let DEBUG_SWORD_HITBOX = true;


            const DEBUG_INPUT_LOGGING = false;
            const DEBUG_ANIMATION_EVENT_LOGGING = true;
            const DEBUG_ANIMATION_FRAME_LOGGING = false;
            const DEBUG_ANIMATION_TRACK_FRAME_LOGGING = false;
            const DEBUG_GROUND_STATE_LOGGING = false;
            const DEBUG_JUMP_FLAG_LOGGING = false;
            const DEBUG_OVERLAY_TRACK_LOGGING = false;
            const DEBUG_SPINE_EVENT_LOGGING = false;
            const DEBUG_EMOTE_LOGGING = false;

            const MIN_ZOOM = 0.1;
            const MAX_ZOOM = 10;
            const ZOOM_STEP = 0.05;
            const DEFAULT_ZOOM = IS_NATIVE_IOS ? 0.33 : 0.6;
            const CAMERA_FOLLOW_RATE_NORMAL = 6;
            const CAMERA_FOLLOW_RATE_FAST = 22;
            const CAMERA_FAST_SPEED_REFERENCE = 4000;
            const CAMERA_VELOCITY_LOOK_AHEAD_SECONDS = 0.06;
            const CAMERA_MAX_LOOK_AHEAD_RATIO = 0.18;
            // Keep Spine/WebGL canvases at a stable resolution while the camera zooms.
            // The player upgrades through a few quality tiers after wheel input settles.
            const SPINE_CANVAS_RENDER_ZOOM = IS_NATIVE_IOS ? 0.18 : DEFAULT_ZOOM;
            const PLAYER_SPINE_RENDER_ZOOM_STEPS = Object.freeze(
                IS_NATIVE_IOS ? [0.18, 0.25, 0.33, 0.45] : [DEFAULT_ZOOM, 0.8, 1, 1.2]
            );
            const PLAYER_SPINE_MAX_BACKING_SIZE = IS_NATIVE_IOS ? 1536 : 4096;
            const PLAYER_SPINE_QUALITY_SETTLE_MS = 180;
            const ZOOM_WHEEL_DELTA_UNIT = 100;
            const ZOOM_WHEEL_SENSITIVITY = Math.log(1 + ZOOM_STEP) / ZOOM_WHEEL_DELTA_UNIT;

            let hairColoringEnabled = true;

            const JOYSTICK_RADIUS = 70;
            const JOYSTICK_DEADZONE = 0.18;
            const JOYSTICK_RUN_THRESHOLD = 0.65;
            const JOYSTICK_JUMP_THRESHOLD = 0.35;
            const JOYSTICK_ACTIVATION_MIN_Y = 0.4;
            const JOYSTICK_SKID_STICK_THRESHOLD = 0.00000001; // magnitude required to count as a firm opposite push
            const JOYSTICK_SKID_DELTA_THRESHOLD = 3000; // min difference between desired vs current speed to trigger skid
            const JOYSTICK_SKID_MIN_SPEED = 1200; // min current speed for joystick skid delta check
            
            
            const COLLISION_EPSILON = 0.5;
            const RAD_TO_DEG = 180 / Math.PI;


            function randomFloat(min, max) { return Math.random() * (max - min) + min; }
            function getRandomVibrantColor() {
                const h = Math.random();
                const s = randomFloat(0.6, 1.0);
                const l = randomFloat(0.4, 0.7);
                let r, g, b;
                if (s === 0) {
                    r = g = b = l;
                } else {
                    const hue2rgb = (p, q, t) => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1 / 6) return p + (q - p) * 6 * t;
                        if (t < 1 / 2) return q;
                        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                    };
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    r = hue2rgb(p, q, h + 1 / 3);
                    g = hue2rgb(p, q, h);
                    b = hue2rgb(p, q, h - 1 / 3);
                }
                return { r, g, b, a: 1.0 };
            }
            function lightenColor(c, factor) {
                const f = Math.max(0, Math.min(1, factor));
                return {
                    r: c.r + (1 - c.r) * f,
                    g: c.g + (1 - c.g) * f,
                    b: c.b + (1 - c.b) * f,
                    a: c.a !== undefined ? c.a : 1.0
                };
            }
            function logInputEvent(type, detail) {
                if (!DEBUG_INPUT_LOGGING) return;
                console.log(`[InputDebug] ${type}`, detail);
            }
            function logEmoteEvent(message, detail = null) {
                if (!DEBUG_EMOTE_LOGGING) return;
                if (detail !== null) {
                    console.log(`[EmoteDebug] ${message}`, detail);
                } else {
                    console.log(`[EmoteDebug] ${message}`);
                }
            }
            function cancelActiveEmote(reason, detail) {
                if (!isEmotePlaying()) return;
                logEmoteEvent(`Cancel emote: ${reason}`, detail);
                cancelEmotePlayback();
            }
            function generateCharacterColors(prev = null, opts = { skin: true, hair: true, eyes: true }) {
                const colors = Object.assign({}, prev || {});
                if (opts.hair) {
                    const baseHair = getRandomVibrantColor();
                    colors.Hair = baseHair;
                    colors.HairShadow = { r: Math.max(0, baseHair.r * 0.5), g: Math.max(0, baseHair.g * 0.5), b: Math.max(0, baseHair.b * 0.5), a: 1.0 };
                    colors.HairHighlight = {
                        r: Math.min(1, baseHair.r * 1.5 + 0.15),
                        g: Math.min(1, baseHair.g * 1.5 + 0.15),
                        b: Math.min(1, baseHair.b * 1.5 + 0.15),
                        a: 1.0
                    };
                }
                if (opts.skin) {
                    const skinL = randomFloat(0.7, 0.95);
                    colors.Skin = {
                        r: skinL,
                        g: skinL * randomFloat(0.75, 0.9),
                        b: skinL * randomFloat(0.65, 0.85),
                        a: 1.0
                    };
                }
                if (opts.eyes) {
                    const baseIris = getRandomVibrantColor();
                    colors.IrisB = baseIris;
                    colors.IrisA = lightenColor(baseIris, 0.25);
                    colors.IrisC = lightenColor(baseIris, 0.5);
                    colors.IrisHL = lightenColor(baseIris, 0.7);
                }
                return colors;
            }
            const SUFFIX_TO_COLOR_GROUP = {
                '_ColorHairShadow': 'HairShadow',
                '_ColorHairHlight': 'HairHighlight',
                '_ColorHair': 'Hair',
                '_ColorSkin': 'Skin',
                '_ColorIrisLeft': 'IrisB',
                '_ColorIrisRight': 'IrisB',
                '_ColorIrisA-L': 'IrisA',
                '_ColorIrisB-L': 'IrisB',
                '_ColorIrisC-L': 'IrisC',
                '_ColorIrisA-R': 'IrisA',
                '_ColorIrisB-R': 'IrisB',
                '_ColorIrisC-R': 'IrisC',
                '_ColorIrisHL-L': 'IrisHL',
                '_ColorIrisHL-R': 'IrisHL'
            };
            // Pre-compiled regex cache for attachment color matching (perf optimization)
            const SUFFIX_REGEX_CACHE = {};
            for (const suffix in SUFFIX_TO_COLOR_GROUP) {
                const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                SUFFIX_REGEX_CACHE[suffix] = new RegExp(escaped + '(_\\d+|\\d*)$', 'i');
            }
            function applyAttachmentColors(skeleton, colors, opts = {}) {
                if (!skeleton) return;
                const colorMap = colors || {};
                const includeHair = opts.includeHair !== undefined ? opts.includeHair : hairColoringEnabled;
                skeleton.slots.forEach(slot => {
                    const att = slot.attachment;
                    if (!att || !att.name || !att.color || typeof att.color.set !== 'function') return;
                    const attachmentName = String(att.name).trim();
                    for (const suffix in SUFFIX_TO_COLOR_GROUP) {
                        const regex = SUFFIX_REGEX_CACHE[suffix];
                        if (regex.test(attachmentName)) {
                            const group = SUFFIX_TO_COLOR_GROUP[suffix];
                            if (!includeHair && HAIR_COLOR_GROUPS.has(group)) {
                                att.color.set(1, 1, 1, 1);
                                break;
                            }
                            const c = colorMap[group];
                            if (c) {
                                att.color.set(c.r, c.g, c.b, c.a !== undefined ? c.a : 1.0);
                            }
                            break;
                        }
                    }
                });
            }

            // --- DOM Elements ---
            let jetpackVfxController = null;
            let jetpackRemoveEntry = null;
            let landingVfxController = null;
            let skidVfxController = null;
            let swordHitVfxController = null;
    let coinCollectVfxController = null;
    let beaverNpcController = null;
    const PLAYER_SPAWN_OFFSET_X = -4000;
    const beaverConversationState = { active: false };

            const gameWrapper = document.getElementById('game-wrapper');
            const gameBoardElement = document.getElementById('game-board');
            const canvas = document.getElementById('game-canvas');
            const ctx = canvas.getContext('2d');
            const backgroundLayerSurfaces = new Map();
            const platformOverlayCanvas = document.createElement('canvas');
            const platformOverlayCtx = platformOverlayCanvas.getContext('2d');
            const ambientLeafOverlayCanvas = document.createElement('canvas');
            const ambientLeafOverlayCtx = ambientLeafOverlayCanvas.getContext('2d');
            const playerContainerElement = document.getElementById('player-container');
            const talkAnimationLabelElement = document.getElementById('talk-animation-label');
            const joystickContainer = document.getElementById('joystick');
            const mouseTrackerElement = document.getElementById('mouse-tracker');
            const joystickThumb = document.getElementById('joystick-thumb');
            const uiControls = document.getElementById('ui-controls');
            const toggleUiButton = document.getElementById('toggle-ui-btn');
            const randomizeColorsButton = document.getElementById('randomize-colors-btn');
            const randomizeSkinsButton = document.getElementById('randomize-skins-btn');
            const randomAnimationTestButton = document.getElementById('random-animation-test-btn');
            const jetpackModeButton = document.getElementById('jetpack-mode-btn');
            const cameraTrackingButton = document.getElementById('camera-tracking-btn');
            const cameraRecenterButton = document.getElementById('camera-recenter-btn');
            const skinControlsContainer = document.getElementById('skin-controls');
            const hairColorToggle = document.getElementById('toggle-hair-color');
            const animationSetSelect = document.getElementById('animation-set-select');
            const runAnimationSelect = document.getElementById('run-animation-select');
            const walkAnimationSelect = document.getElementById('walk-animation-select');
            const buildModeButton = document.getElementById('build-mode-btn');
            const chairToolButton = document.getElementById('chair-tool-btn');
            const doorToolButton = document.getElementById('door-tool-btn');
            const addTextButton = document.getElementById('add-text-btn');
            const buildAddTools = document.getElementById('build-add-tools');
            const buildAddButton = document.getElementById('build-add-btn');
            const buildAddMenu = document.getElementById('build-add-menu');
            const buildAddMenuButtons = Array.from(buildAddMenu?.querySelectorAll('[role="menuitem"]') || []);
            const buildAddNote = document.getElementById('build-add-note');
            const buildPlacementStatus = document.getElementById('build-placement-status');
            const buildLayerBackButton = document.getElementById('build-layer-back-btn');
            const buildLayerForwardButton = document.getElementById('build-layer-forward-btn');
            const buildLayerStatus = document.getElementById('build-layer-status');
            const buildLayerPanel = document.getElementById('build-layer-panel');
            const bushSkinControl = document.getElementById('bush-skin-control');
            const bushSkinSelect = document.getElementById('bush-skin-select');
            const doorClearButton = document.getElementById('door-clear-btn');
            const npcToggleButton = document.getElementById('npc-toggle-btn');
            const clearPlatformsButton = document.getElementById('clear-platforms-btn');
            const copyPlatformsButton = document.getElementById('copy-platforms-btn');
            const backgroundSelect = document.getElementById('background-select');
            const backgroundToggleButton = document.getElementById('toggle-background-btn');
            const coinCounterElement = document.getElementById('coin-counter');
            const jetpackBarElement = document.getElementById('jetpack-bar');
            const jetpackBarFillElement = document.getElementById('jetpack-bar-fill');
            const sitPromptElement = document.getElementById('sit-prompt');
            const speechBubbleController = window.SpeechBubbleManager ? window.SpeechBubbleManager.create({
                container: playerContainerElement,
                phrasesUrl: 'phrases.json'
            }) : null;
            let npcEnabled = false;
            let chatBotController = null;

            function createChatBotController() {
                if (!window.ChatBot) {
                    console.warn('ChatBot module is not available; NPC cannot be enabled.');
                    return null;
                }
                return window.ChatBot.create({
                    model: 'gpt-4.1-nano',
                    temperature: 0.75,
                    maxTurns: 8,
                    playerContainer: playerContainerElement,
                    gameBoard: gameBoardElement,
                    spineLib: spine,
                    npcAssets: { skelUrl: CHARACTER_SKEL_URL, atlasUrl: CHARACTER_ATLAS_URL },
                    renderScale: SPINE_RENDER_SCALE,
                    playerVisualSize: PLAYER_CONTAINER_SIZE,
                    footOffset: FOOT_OFFSET,
                    floorHeight: FLOOR_HEIGHT,
                    viewport: PLAYER_VIEWPORT_CONFIG,
                    offsetScale: 0.55,
                    getProxyUrl: () => window.ANIMEE_CHAT_PROXY_URL || '',
                    generateColors: () => generateCharacterColors(null, { skin: true, hair: true, eyes: true }),
                    applyColors: (skeleton, colors, opts = {}) => applyAttachmentColors(skeleton, colors, { includeHair: opts.includeHair !== undefined ? opts.includeHair : hairColoringEnabled }),
                    includeHair: () => hairColoringEnabled,
                    onChatStateChange: (active) => {
                        if (!active) {
                            stopTalkOverlay();
                            speechBubbleController?.handleTalkState(false);
                        }
                    }
                });
            }

            function enableNpc() {
                const proxyUrl = typeof window.ANIMEE_CHAT_PROXY_URL === 'string'
                    ? window.ANIMEE_CHAT_PROXY_URL.trim()
                    : '';
                if (!proxyUrl) {
                    console.warn('NPC chat is disabled until ANIMEE_CHAT_PROXY_URL points to a secure backend.');
                    setBuildAddFeedback('NPC chat requires a secure backend proxy. No API key is stored in the app.');
                    updateNpcToggleButton();
                    return;
                }
                if (!chatBotController && !hasManagedSpinePlayerCapacity()) {
                    console.warn('NPC was not loaded because the scene has reached its Spine graphics capacity.');
                    setBuildAddFeedback('Graphics capacity reached. Remove a fan, bush, or door before loading the NPC.');
                    return;
                }
                if (!chatBotController) {
                    chatBotController = createChatBotController();
                }
                npcEnabled = !!chatBotController;
                updateNpcToggleButton();
            }

            function disableNpc() {
                npcEnabled = false;
                if (chatBotController?.destroy) {
                    chatBotController.destroy();
                } else if (chatBotController?.stopChat) {
                    chatBotController.stopChat();
                }
                chatBotController = null;
                updateNpcToggleButton();
            }

            function toggleNpcEnabled() {
                if (npcEnabled) disableNpc(); else enableNpc();
            }

            if (canvas) canvas.tabIndex = -1;

            function focusGameCanvas() {
                if (canvas && document.activeElement !== canvas) {
                    canvas.focus({ preventScroll: true });
                }
            }

            function shouldRefocusCanvas(target) {
                if (!target) return false;
                const element = target instanceof HTMLElement ? target : null;
                const control = element ? element.closest('button, input, select, textarea') : null;
                if (!control) return false;
                if (control.id === 'add-text-btn') return false;
                const tagName = control.tagName;
                if (tagName === 'SELECT' || tagName === 'TEXTAREA') return false;
                if (tagName === 'INPUT') {
                    const type = (control.getAttribute('type') || 'text').toLowerCase();
                    if (!type || ['text', 'search', 'number', 'email', 'password', 'tel', 'url', 'color'].includes(type)) {
                        return false;
                    }
                }
                return true;
            }

            function isEditingWorldText(target) {
                return target instanceof HTMLElement && !!target.closest('.world-text-input');
            }

            if (uiControls && canvas) {
                const scheduleCanvasFocus = (event) => {
                    if (shouldRefocusCanvas(event.target)) {
                        setTimeout(focusGameCanvas, 0);
                    }
                };
                ['click', 'change'].forEach(eventName => uiControls.addEventListener(eventName, scheduleCanvasFocus));
            }

            focusGameCanvas();
            let currentBackgroundScene = null;
            let backgroundSceneLoaded = false;
            let backgroundLoadToken = 0;
            let backgroundLoadPromise = Promise.resolve();
            let backgroundLoadResolvers = [];
            let backgroundLoadAbortController = null;
            let backgroundVisible = false;
            const BACKGROUND_SCENE_SCALE = 1.6;
            const backgroundTileRenderer = new BackgroundTileRenderer(IS_NATIVE_IOS ? {
                loadConcurrency: 1,
                prefetchMargin: 0,
                maxEntries: 32,
                maxBytes: 24 * 1024 * 1024,
                maxLevelScale: 0.25,
            } : {});
            if (IS_NATIVE_IOS) {
                console.info('iOS strict memory profile enabled: quarter-resolution character atlas, coins disabled, lazy VFX/props, reduced WebGL surfaces, and 24 MB tile cache.');
            }
            Object.defineProperty(window, '__backgroundTileDebug', {
                configurable: true,
                value: Object.freeze({ getSnapshot: () => backgroundTileRenderer.getSnapshot() })
            });
            window.addEventListener('beforeunload', () => backgroundTileRenderer.dispose(), { once: true });
            let lastMouseX = 0;
            let lastMouseY = 0;

            // UI throttling state (perf optimization)
            let lastMouseTrackerUpdate = 0;
            let lastJetpackBarUpdate = 0;
            const UI_THROTTLE_MS = 50; // throttle UI updates to ~20fps

            function updateMouseTrackerDisplay() {
                if (!mouseTrackerElement) return;
                const now = performance.now();
                if (now - lastMouseTrackerUpdate < UI_THROTTLE_MS) return;
                lastMouseTrackerUpdate = now;
                const zoomPercent = Math.round((zoomLevel / DEFAULT_ZOOM) * 100);
                let worldX = 0, worldY = 0;
                if (gameBoardElement) {
                    const rect = gameBoardElement.getBoundingClientRect();
                    const screenX = lastMouseX - rect.left;
                    const screenY = lastMouseY - rect.top;
                    worldX = screenX / zoomLevel + camera.x;
                    worldY = screenY / zoomLevel + camera.y;
                }
                mouseTrackerElement.textContent = `X: ${Math.round(worldX)} Y: ${Math.round(worldY)} Zoom: ${zoomPercent}%`;
            }
            function updateBackgroundToggleButton() {
                if (backgroundToggleButton) {
                    backgroundToggleButton.textContent = backgroundVisible ? 'Hide BG' : 'Show BG';
                }
            }

            function updateNpcToggleButton() {
                if (npcToggleButton) {
                    const proxyConfigured = typeof window.ANIMEE_CHAT_PROXY_URL === 'string'
                        && window.ANIMEE_CHAT_PROXY_URL.trim().length > 0;
                    npcToggleButton.disabled = !proxyConfigured && !npcEnabled;
                    npcToggleButton.textContent = npcEnabled
                        ? 'Unload NPC'
                        : (proxyConfigured ? 'Load NPC' : 'NPC Chat: Proxy Required');
                    npcToggleButton.setAttribute('aria-pressed', String(npcEnabled));
                }
            }

            function updateJetpackModeButton() {
                if (jetpackModeButton) {
                    const status = jetpackState.enabled ? 'ON' : 'OFF';
                    jetpackModeButton.textContent = `JETPACK MODE! ${status}`;
                    jetpackModeButton.setAttribute('aria-pressed', String(jetpackState.enabled));
                }
            }











            function resolveBackgroundLoad() {
                if (backgroundLoadResolvers.length) {
                    backgroundLoadResolvers.splice(0).forEach((resolve) => resolve());
                }
                backgroundLoadPromise = Promise.resolve();
            }

            function loadPsdBackgroundScene(sceneDef, signal) {
                return loadTiledBackgroundScene(sceneDef, {
                    sceneScale: BACKGROUND_SCENE_SCALE,
                    signal
                });
            }
            const SKIN_GROUP_DEFS = [
                { key: 'ClothingBotFar', prefix: 'ClothingBotFar/' }, { key: 'ClothingBotNear', prefix: 'ClothingBotNear/' },
                { key: 'ClothingInner', prefix: 'ClothingInner/' }, { key: 'ClothingTopFar', prefix: 'ClothingTopFar/' },
                { key: 'ClothingTopNear', prefix: 'ClothingTopNear/' }, { key: 'Common', prefix: 'Common/' },
                { key: 'EarAccessory', prefix: 'EarAccessory/' }, { key: 'EyeStyle', prefix: 'EyeStyle/' },
                { key: 'FaceAccessory', prefix: 'FaceAccessory/' }, { key: 'FullOutfit', prefix: 'FullOutfit/' },
                { key: 'Hair', prefix: 'Hair/' }, { key: 'HeadGear', prefix: 'HeadGear/' },
                { key: 'ShoesFar', prefix: 'ShoesFar/' }, { key: 'ShoesNear', prefix: 'ShoesNear/' }
            ];
            const DEFAULT_COMMON_SKIN = 'Common/Base';
            const HAIR_COLOR_GROUPS = new Set(['Hair', 'HairShadow', 'HairHighlight']);
            const BACKGROUND_SCENES = [
                {
                    id: 'AnimeWorld_Sketch05',
                    label: 'AnimeWorld_Sketch05',
                    type: 'psd-json',
                    jsonPath: 'img_assets/0000 BIG BACKGROUND STUFF/AnimeWorld_Sketch05.json',
                    tileManifestPath: 'img_assets/0000 BIG BACKGROUND STUFF/tiles/manifest.json',
                    parallaxByLayer: {
                        '006 SKY': 0.12,
                        '005 SKYWHALES': 0.28,
                        '004 Mountains etc': 0.55,
                        '003 Clouds': 1.08,
                        '002 GAME AREA': 1.0,
                    },
                    zIndexByLayer: {
                        '006 SKY': 0,
                        '005 SKYWHALES': 10,
                        '004 Mountains etc': 20,
                        '003 Clouds': 30,
                        '002 GAME AREA': 40
                    }
                }
            ];

            const AMBIENT_LEAF_IMAGE_PATHS = [
                'Environment BG Anims/Leaves/LEAF01.png',
                'Environment BG Anims/Leaves/LEAF02.png',
                'Environment BG Anims/Leaves/LEAF03.png',
                'Environment BG Anims/Leaves/LEAF04.png'
            ];
            const AMBIENT_LEAF_FPS = 10;
            const AMBIENT_LEAF_STEP = 1 / AMBIENT_LEAF_FPS;
            const AMBIENT_LEAF_MAX_COUNT = 51;
            const AMBIENT_LEAF_INITIAL_COUNT = AMBIENT_LEAF_MAX_COUNT;
            const AMBIENT_LEAF_SPAWN_PADDING = 620;
            const AMBIENT_LEAF_DESPAWN_PADDING = 900;
            const AMBIENT_LEAF_WIND_CHANGE_MIN = 8;
            const AMBIENT_LEAF_WIND_CHANGE_MAX = 18;
            const AMBIENT_LEAF_CLUSTER_CHANCE = 0.96;
            const AMBIENT_LEAF_CLUSTER_COUNT = 5;
            const AMBIENT_LEAF_CLUSTER_ROW_COUNT = 6;
            const AMBIENT_LEAF_CLUSTER_RADIUS_X = 170;
            const AMBIENT_LEAF_CLUSTER_RADIUS_Y = 70;
            const AMBIENT_LEAF_LAYERS = [
                { depth: 0, parallax: 0.98, scale: { min: 0.42, max: 0.78 }, opacity: { min: 0.42, max: 0.66 }, speed: 0.72 },
                { depth: 1, parallax: 1.08, scale: { min: 0.72, max: 1.18 }, opacity: { min: 0.62, max: 0.84 }, speed: 0.94 },
                { depth: 2, parallax: 1.187, scale: { min: 1.12, max: 1.95 }, opacity: { min: 0.78, max: 0.98 }, speed: 1.18 }
            ];
            const AMBIENT_LEAF_TUMBLE_MIN_WIDTH = 0.08;



            //COIN SETTINGS!
            const COIN_FRAME_COUNT = 23;
            const ENABLE_COINS = !IS_NATIVE_IOS;
            const COIN_FRAME_STEP = 1;  // Tweak this to skip frames (e.g., 3 = every 3rd frame)
            const COIN_FRAME_DURATION = 0.08333;
            const COIN_SPAWN_SPACING = 10;
            const COIN_SPAWN_DENSITY = 0.1;
            const COIN_HEIGHT_OFFSET = 10;
            const COIN_FRAME_PATHS = Array.from({ length: COIN_FRAME_COUNT }, (_, idx) => `img_assets/Spinning Coin PNG SEQ/Spinning coin Loop 1s Straight 100x100 12 fps/Spinning coin Loop 1s Straight 100x100 12 fps_${String(idx).padStart(5, '0')}.png`);
           
           
           
           
           
            const SKID_PUFF_X_OFFSET = 220; // tweakable horizontal offset (multiplied by facing direction)
           
            const LANDING_PUFF_SEQUENCE_CONFIG = {
                key: 'landPuff',
                framePattern: 'img_assets/VFX LandPuff PNG SEQ/VFX LandPuff flash v001__{frame}.png',
                frameStart: 1,
                frameEnd: 5,
                framePad: 1,
                fps: 24,
                anchor: { x: 0.5, y: 1 },
                scale: 0.7
            };

            const LANDING_PUFF_MIN_IMPACT_SPEED = 1900;
            const LANDING_TOO_HARD_IMPACT_SPEED = 3000;
            const SKID_PUFF_SEQUENCE_CONFIG = {
                key: 'skidPuff',
                framePattern: 'img_assets/VFX SKID PUFF/VFX SKID PUFF__{frame}.png',
                frameStart: 1,
                frameEnd: 10,
                framePad: 4,
                fps: 22,
                anchor: { x: 0.5, y: 1 },
                scale: 0.8
            };
            const SWORD_HIT_SEQUENCE_CONFIG = {
                key: 'swordHit',
                framePattern: 'img_assets/VFX Hit PNG SEQ/VFX Hit PNG SEQ v001__{frame}.png',
                frameStart: 1,
                frameEnd: 4,
                framePad: 4,
                fps: 16,
                anchor: { x: 0.5, y: 0.5 },
                scale: 1
            };
            const SWORD_HIT_VFX_SETTINGS = {
                minCount: 1,
                maxCount: 2,
                forwardOffset: -380,
                forwardJitter: 100,
                verticalJitter: 130,
                heightRatio: 0.92,
                scaleRange: { min: 0.5, max: 1.5 },
                staggerFrames: 2
            };
            const COIN_COLLECT_VFX_CONFIG = {
                key: 'coinCollect',
                framePattern: 'img_assets/VFX coin collect/collect coins FLASH__{frame}.png',
                frameStart: 1,
                frameEnd: 18,
                frameStep: 3,  // Tweak this to skip frames (e.g., 3 = every 3rd frame)
                framePad: 4,
                fps: 24,
                anchor: { x: 0.5, y: 0.5 },
                scale: 1
            };

            // ===== COIN PILE VFX (spawns when sword hits door) =====
            const coinYoffset = -10;
            const COIN_PILE_SEQUENCE_CONFIGS = [
                {
                    key: 'coinPile001',
                    framePattern: 'img_assets/Coin Piles appear/CoinPile001/{frame}.png',
                    frameStart: 1,
                    frameEnd: 28,
                    frameStep: 1,
                    framePad: 5,  // 00001.png format
                    fps: 12,
                    anchor: { x: 0.5, y: coinYoffset },  // Bottom-center anchor
                    scale: 1
                },
                {
                    key: 'coinPile002',
                    framePattern: 'img_assets/Coin Piles appear/CoinPile002/{frame}.png',
                    frameStart: 1,
                    frameEnd: 28,
                    frameStep: 1,
                    framePad: 5,
                    fps: 12,
                    anchor: { x: 0.5, y: coinYoffset },
                    scale: 1
                },
                {
                    key: 'coinPile003',
                    framePattern: 'img_assets/Coin Piles appear/CoinPile003/{frame}.png',
                    frameStart: 1,
                    frameEnd: 28,
                    frameStep: 1,
                    framePad: 5,
                    fps: 12,
                    anchor: { x: 0.5, y: coinYoffset },
                    scale: 1
                }
            ];

            // Tweakable settings for coin pile spawning
            const COIN_PILE_SETTINGS = {
                offsetX: 0,           // Horizontal offset from door center
                offsetY: 0,           // Vertical offset from door bottom
                scale: 1.0,           // Scale multiplier for coin pile
                offsetJitterX: 50,    // Random horizontal jitter range
                offsetJitterY: 0,     // Random vertical jitter range
                vfxMultiplier: 5,     // Number of coin collect VFX to play when picked up
                animationDuration: 28 / 24  // 28 frames at 24 fps = ~1.167 seconds
            };

            let coinPileVfxController = null;

            // Coin pile collectibles (static piles left after VFX animation completes)
            const coinPileCollectibles = [];
            const coinPileCollectiblePool = [];
            const coinPileFinalFrames = {};  // Cache for final frame images keyed by pile variant

            function acquireCoinPileCollectible() {
                return coinPileCollectiblePool.length > 0
                    ? coinPileCollectiblePool.pop()
                    : { centerX: 0, centerY: 0, width: 100, height: 100, variant: 1, timer: 0, ready: false, scale: 1 };
            }

            function releaseCoinPileCollectible(pile) {
                coinPileCollectiblePool.push(pile);
            }

            // Preload final frame images for coin pile variants
            (function preloadCoinPileFinalFrames() {
                if (!ENABLE_COINS) return;
                for (let i = 1; i <= 3; i++) {
                    const img = new Image();
                    img.src = `img_assets/Coin Piles appear/CoinPile00${i}/00028.png`;
                    coinPileFinalFrames[i] = img;
                }
            })();

            const COIN_COLLECT_VFX_SETTINGS = {
                offsetJitterX: 50,
                offsetJitterY: 50,
                baseOffsetY: -100  // Tweak this to adjust VFX spawn height
            };
            const COIN_COLLECT_SOUNDS = [
                'audio_assets/ES_Ring, Gemstone, Medium 02 - Epidemic Sound.wav',
                'audio_assets/ES_Ring, Gemstone, Long 04 - Epidemic Sound.wav',
                'audio_assets/ES_Ring, Gemstone, Medium 06 - Epidemic Sound.wav',
                'audio_assets/ES_Ring, Gemstone, Medium 05 - Epidemic Sound.wav'
            ];
            const COIN_SOUND_POOL_SIZE = 5;
            const coinSoundPool = [];
            let coinSoundPoolIndex = 0;
            function initCoinSoundPool() {
                if (!ENABLE_COINS) return;
                for (let i = 0; i < COIN_SOUND_POOL_SIZE; i++) {
                    const audio = new Audio();
                    audio.preload = 'auto';
                    coinSoundPool.push(audio);
                }
                // Preload all sound files
                COIN_COLLECT_SOUNDS.forEach(src => {
                    const preload = new Audio(src);
                    preload.preload = 'auto';
                });
            }
            function playCoinCollectSound() {
                const audio = coinSoundPool[coinSoundPoolIndex];
                coinSoundPoolIndex = (coinSoundPoolIndex + 1) % COIN_SOUND_POOL_SIZE;
                const randomSound = COIN_COLLECT_SOUNDS[Math.floor(Math.random() * COIN_COLLECT_SOUNDS.length)];
                audio.src = randomSound;
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
            initCoinSoundPool();
            const coinFrames = [];
            let coinFrameSize = { width: 48, height: 48 };
            let coinFramesLoaded = 0;
            const coins = [];
            // Coin object pool for reduced GC pressure (perf optimization)
            const coinPool = [];
            const ambientLeafImages = AMBIENT_LEAF_IMAGE_PATHS.map((path) => {
                const image = new Image();
                image.decoding = 'async';
                image.src = path;
                image.onerror = () => console.warn(`Failed to load ambient leaf image: ${path}`);
                return image;
            });
            const ambientLeaves = [];
            let ambientLeafStepAccumulator = 0;
            let ambientLeafSpawnAccumulator = 0;
            let ambientLeafClock = 0;
            let ambientLeafWarmStarted = false;
            let ambientLeafWindDirection = Math.random() < 0.5 ? -1 : 1;
            let ambientLeafWindTimer = randomFloat(AMBIENT_LEAF_WIND_CHANGE_MIN, AMBIENT_LEAF_WIND_CHANGE_MAX);
            function acquireCoin() {
                return coinPool.length > 0 ? coinPool.pop() : { centerX: 0, centerY: 0, width: 48, height: 48, platformY: 0, frame: 0, timer: 0 };
            }
            function releaseCoin(coin) {
                coinPool.push(coin);
            }
            if (window.VFX && playerContainerElement && gameBoardElement) {
                jetpackVfxController = window.VFX.init({
                    container: playerContainerElement,
                    stage: gameBoardElement,
                    offsets: { x: -22, y: 28, mirrorX: true }
                });
                if (window.VFX.createSequenceController) {
                    landingVfxController = window.VFX.createSequenceController({
                        stage: gameBoardElement,
                        sequences: [LANDING_PUFF_SEQUENCE_CONFIG],
                        preload: !IS_NATIVE_IOS,
                        zIndex: 51
                    });
                    skidVfxController = window.VFX.createSequenceController({
                        stage: gameBoardElement,
                        sequences: [SKID_PUFF_SEQUENCE_CONFIG],
                        preload: !IS_NATIVE_IOS,
                        zIndex: 51
                    });
                    swordHitVfxController = window.VFX.createSequenceController({
                        stage: gameBoardElement,
                        sequences: [SWORD_HIT_SEQUENCE_CONFIG],
                        preload: !IS_NATIVE_IOS,
                        zIndex: 52
                    });
                    if (ENABLE_COINS) {
                        coinCollectVfxController = window.VFX.createSequenceController({
                            stage: gameBoardElement,
                            sequences: [COIN_COLLECT_VFX_CONFIG],
                            preload: true,
                            zIndex: 99999
                        });
                        coinPileVfxController = window.VFX.createSequenceController({
                            stage: gameBoardElement,
                            sequences: COIN_PILE_SEQUENCE_CONFIGS,
                            preload: true,
                            zIndex: 51
                        });
                    }
                }
            }
            if (ENABLE_COINS) COIN_FRAME_PATHS.forEach((path) => {
                const image = new Image();
                image.onload = () => {
                    coinFramesLoaded += 1;
                    if (coinFramesLoaded === 1 && image.width && image.height) {
                        coinFrameSize = { width: image.width, height: image.height };
                        coins.forEach((coin) => {
                            coin.width = coinFrameSize.width;
                            coin.height = coinFrameSize.height;
                            coin.centerY = Math.max(0, coin.platformY - COIN_HEIGHT_OFFSET - coin.height / 2);
                        });
                    }
                };
                image.src = path;
                coinFrames.push(image);
            });
            const BUILD_STORAGE_KEY = 'shooter-build-lines-v1';
            const CHAIR_STORAGE_KEY = 'shooter-chair-placements-v1';
            const CHAIR_ASSET_PATH = 'img_assets/chair001.png';
            const CHAIR_DEFAULT_SIZE = { width: 180, height: 180 };
            const CHAIR_REMOVE_RADIUS = 12;
            const DOOR_STORAGE_KEY = 'shooter-door-placements-v1';
            const BALLOON_STORAGE_KEY = 'shooter-balloon-placement-v1';
            const SPINE_PROP_STORAGE_KEY = 'shooter-spine-props-v1';
            const TEXT_BOX_STORAGE_KEY = 'shooter-text-boxes-v1';
            const BUTTERFLY_SPAWN_STORAGE_KEY = 'shooter-butterfly-spawns-v1';
            const BUTTERFLY_SEQUENCE_PATH = 'Environment BG Anims/ENV Bugs/Butterfly_png_seq';
            const BUTTERFLY_FRAME_COUNT = 10;
            const BUTTERFLY_FLY_FPS = 10;
            const BUTTERFLY_MOTION_FPS = 10;
            const BUTTERFLY_MOTION_STEP = 1 / BUTTERFLY_MOTION_FPS;
            const BUTTERFLY_IDLE_FPS = 9;
            const BUTTERFLIES_PER_SPAWN = 5;
            const MAX_BUTTERFLY_SPAWNS = 8;
            const BUTTERFLY_FLIGHT_RADIUS = { x: 320, y: 210 };
            const BUTTERFLY_SPAWN_HIT_RADIUS = 70;
            const BUTTERFLY_BASE_SCALE = 0.434; // 30% smaller than the original 0.62 scale.
            const BUTTERFLY_PLAYER_SCARE_RADIUS = { x: 360, y: 270 };
            const BUTTERFLY_INDIVIDUAL_SCARE_RADIUS = { x: 185, y: 165 };
            const BUTTERFLY_SCATTER_HOLD_SECONDS = 1;
            const BUTTERFLY_SCATTER_SPEED = 430;
            const BUTTERFLY_SCATTER_DURATION = 0.55;
            const BUTTERFLY_SCATTER_DELAY_MAX = 0.48;
            const BUTTERFLY_FLY_FRAME_SIZE = { width: 134, height: 141 };
            const BUTTERFLY_LANDED_FRAME_SIZE = { width: 102, height: 80 };
            const butterflyFrames = Object.freeze({
                flying: Array.from({ length: BUTTERFLY_FRAME_COUNT }, (_, index) => {
                    const image = new Image();
                    image.src = `${BUTTERFLY_SEQUENCE_PATH}/butterfly-fly_loop_${String(index).padStart(2, '0')}.png`;
                    return image;
                }),
                landed: Array.from({ length: BUTTERFLY_FRAME_COUNT }, (_, index) => {
                    const image = new Image();
                    image.src = `${BUTTERFLY_SEQUENCE_PATH}/butterfly-idle_landed_${String(index).padStart(2, '0')}.png`;
                    return image;
                })
            });
            const BACKGROUND_LAYER_DEPTHS = Object.freeze([0, 10, 20, 30, 40]);
            const BUILD_DRAW_ORDER_STEPS = Object.freeze([5, 15, 25, 35, 45, 55]);
            const BUILD_DRAW_ORDER_MIN = BUILD_DRAW_ORDER_STEPS[0];
            const BUILD_DRAW_ORDER_MAX = BUILD_DRAW_ORDER_STEPS[BUILD_DRAW_ORDER_STEPS.length - 1];
            const BUILD_DRAW_ORDER_DEFAULT = 35;
            const TEXT_BOX_DRAW_ORDER_DEFAULT = 45;
            const PLATFORM_DRAW_ORDER = 32;
            const DOOR_REMOVE_RADIUS = 24;
            const DOOR_ASSET_PATHS = { json: 'spine stuff/door_skeleton.json', atlas: 'spine stuff/Spine DOOR_v001.atlas' };
            const DOOR_SKELETON_SIZE = { width: 864, height: 1303.2 }; // enlarged base skeleton size (+20%)
            const DOOR_PREV_DEFAULT_SCALE = 0.94;
            const DOOR_DEFAULT_SCALE = 0.5; // scale skeleton size down to world units (+20% from previous)
            const DOOR_INTERACT_PADDING = { x: 90, y: 60 };
            let DOOR_ANIMATION_SYNC_OFFSET = 0; // seconds; + delays player anim, - delays door anim
            const DOOR_PROMPT_TEXT = 'Press F or G to enter';
            const DOOR_IDLE_ANIMATION = 'door_idle';
            const DOOR_OPEN_ANIMATION = 'door_open';
            const DOOR_SECONDARY_ANIMATIONS = { begin: 'door_open2_begin', cycle: 'door_open2_cycle', end: 'door_open2_end' };
            const BALLOON_ASSET_PATHS = {
                json: 'spine stuff/BALLOONS SPINE/BALLOON.json',
                atlas: 'spine stuff/BALLOONS SPINE/BALLOON.atlas.txt'
            };
            const BALLOON_SKELETON_BOUNDS = {
                x: -431.3603515625,
                y: -1.130157470703125,
                width: 826.0001220703125,
                height: 1741.9998779296875
            };
            const BALLOON_DEFAULT_SCALE = 0.5;
            const BALLOON_HIT_BONE_NAME = 'HIT BONE';
            const BALLOON_VARIANTS = [
                {
                    id: 'standard',
                    startOffsetX: 360,
                    allowMixing: false,
                    idleAnimation: 'idle',
                    windAnimations: { left: 'wind_L', right: 'wind_R' }
                }
            ];
            const BALLOON_TRIGGER_RADIUS = { x: 460, y: 500 };
            const BALLOON_VIEWPORT_PADDING_RATIO = 0.08;
            const BALLOON_MIN_HORIZONTAL_SPEED = 50;
            const BALLOON_WIND_MIX_OUT = 0.2;
            const BALLOON_RETRIGGER_COOLDOWN = 0.35;
            const MAX_MANAGED_SPINE_PLAYERS = 12;
            const MAX_PLACED_SPINE_PROPS = 8;
            const FAN_PROP_ASSETS = {
                skeleton: 'spine stuff/FAN BLADES/FAN BLADES.skel',
                atlas: 'spine stuff/FAN BLADES/FAN BLADES.atlas',
                bounds: { x: -122.585, y: -41.808, width: 245, height: 45.013 },
                scale: 2.2
            };
            const BUSH_PROP_ASSETS = {
                skeleton: 'spine stuff/BUSHES SPINE/Bushes.skel',
                atlas: 'spine stuff/BUSHES SPINE/Bushes.atlas.txt',
                bounds: {
                    x: -623.8684692382812,
                    y: -141.77960205078125,
                    width: 1343.783935546875,
                    height: 684
                },
                scale: 1,
                viewportPadding: '0%'
            };
            const DEFAULT_BUSH_SKIN = 'Bush Near 4';
            const BUSH_WIND_TRIGGER_PADDING = { x: 220, y: 140 };
            const BUSH_WIND_TRIGGER_SCALE = 0.5;
            const BUSH_WIND_MIN_HORIZONTAL_SPEED = 50;
            const BUSH_WIND_RETRIGGER_COOLDOWN = 0.35;
            const PLACED_SPINE_PROP_DEFS = Object.freeze({
                'fan-round-spline': {
                    ...FAN_PROP_ASSETS,
                    label: 'Round fan · Spline',
                    animation: 'BladeRND_spinLoop_spline'
                },
                'fan-round-stepped': {
                    ...FAN_PROP_ASSETS,
                    label: 'Round fan · Stepped',
                    animation: 'BladeRND_spinLoop_stepped'
                },
                'fan-square-spline': {
                    ...FAN_PROP_ASSETS,
                    label: 'Square fan · Spline',
                    animation: 'BladeSQR_spinLoop_spline'
                },
                'fan-square-stepped': {
                    ...FAN_PROP_ASSETS,
                    label: 'Square fan · Stepped',
                    animation: 'BladeSQR_spinLoop_stepped'
                },
                'bush-spline': {
                    ...BUSH_PROP_ASSETS,
                    label: 'Bush · Spline',
                    animation: 'idle_spline',
                    windAnimations: { left: 'wind_left_spline', right: 'wind_right_spline' }
                },
                'bush-stepped': {
                    ...BUSH_PROP_ASSETS,
                    label: 'Bush · Stepped',
                    animation: 'idle_stepped',
                    windAnimations: { left: 'wind_left_stepped', right: 'wind_right_stepped' }
                }
            });
            const TEXT_BOX_DEFAULT_SIZE = { width: 520, height: 170 };
            const TEXT_BOX_MIN_SIZE = { width: 120, height: 60 };
            const TEXT_BOX_DEFAULT_FONT_SIZE = 40;
            const TEXT_BOX_DEFAULT_TEXT = 'Type text here';
            const DOOR_RUSH_SPEED = PLAYER_RUN_SPEED * 1.35;
            const DOOR_RUSH_EXIT_PADDING = 160;
            const DOOR_RUSH_FOOT_OFFSET = 0;
            const DOOR_MASK_CONFIG = {
                width: 340,
                inset: 22,
                heightPad: 160,
                yOffset: 0,
                scale: 1.2, // raise to enlarge both width and heightPad together
                debugColor: 'rgba(0, 200, 255, 0.3)',
                debugBorder: '#00c8ff'
            };
            const DOOR_MASK_DEBUG_ALWAYS = false; // draw mask guides even when not rushing (helps visual tuning)
            const DOOR_RUSH_FADE_START_DELAY_MS = 10; // wait before beginning the fade-to-black sequence
            const DOOR_RUSH_FADE_IN_MS = 100; // duration of fade-in to black
            const DOOR_RUSH_FADE_HOLD_MS = 300; // time to hold fully black before fading back
            const DOOR_RUSH_FADE_OUT_MS = 100; // duration of fade-out from black
            const DOOR_RUSH_HIDE_DELAY_MS = 50; // delay before hiding the player during the fade
            const DOOR_RUSH_HIDE_EXTRA_MS = 60; // extra time the player stays hidden to sell the inside-door travel
            const DOOR_RUSH_CAMERA_ZOOM_DELTA = 0.01; // how much to zoom out during door rush
            const DOOR_RUSH_CAMERA_EASE_DURATION = 0.15; // seconds for zoom ease in/out


            const MIN_SEGMENT_LENGTH = 5;
            const DEFAULT_PLATFORM_THICKNESS = 28;
            const skinInputs = {};
            const skinToggles = {};
            const skinButtons = {};
            let availableSkinsByGroup = {};
            let currentSkinSelections = {};
            let spineData = null;
            let allSkinNames = [];
            let buildModeEnabled = false;
            let platformPlacementMode = false;
            let isDrawingSegment = false;
            let pendingSegment = null;
            let pendingSegmentPreview = null;
            let buildSegments = [];
            let chainAnchor = null;
            let basePlatforms = [];
            let buildPlatforms = [];
            let finalPlatforms = [];
            let platforms = [];
            let currentBackground = '';
            let cachedBuildData = {};
            let cachedChairData = {};
            let cachedDoorData = {};
            let cachedBalloonData = {};
            let cachedSpinePropData = {};
            let cachedTextBoxData = {};
            let cachedButterflySpawnData = {};
            let blockHeight = 0;
            let chairPlacements = [];
            let chairPlacementMode = false;
            let doorPlacements = [];
            let doorPlacementMode = false;
            const chairImage = new Image();
            let chairImageLoaded = false;
            let chairRenderSize = { ...CHAIR_DEFAULT_SIZE };
            let doors = [];
            let balloons = [];
            let balloonPlacements = {};
            const balloonDragState = { active: false, pointerId: null, balloon: null, offsetX: 0, offsetY: 0 };
            let moneyTree = null;
            const moneyTreeDragState = { active: false, pointerId: null, offsetX: 0, offsetY: 0 };
            let placedSpineProps = [];
            let selectedPlacedSpineProp = null;
            let selectedBuildLayerItem = null;
            let placedSpinePropIdCounter = 0;
            let placedSpinePropLoadGeneration = 0;
            let placedSpinePropRestorePending = false;
            let buildAddFeedbackTimer = 0;
            let buildPlacementStatusTimer = 0;
            let pendingBuildPlacementType = '';
            const placedSpinePropDragState = { active: false, pointerId: null, prop: null, offsetX: 0, offsetY: 0 };
            Object.defineProperty(window, '__buildPropDebug', {
                configurable: true,
                value: Object.freeze({ getSnapshot: () => getBuildPropDebugSnapshot() })
            });
            let textBoxes = [];
            let selectedTextBox = null;
            const textBoxDragState = { active: false, pointerId: null, textBox: null, mode: '', offsetX: 0, offsetY: 0, startWorldX: 0, startWorldY: 0, startWidth: 0, startHeight: 0 };
            let butterflySpawns = [];
            let butterflySpawnIdCounter = 0;
            let butterflyMotionAccumulator = 0;
            const butterflySpawnDragState = { active: false, pointerId: null, spawn: null, offsetX: 0, offsetY: 0 };
            let doorPromptDoor = null;
            let activeDoorInteraction = null;
            const DEFAULT_DOOR_RUSH_STATE = { active: false, door: null, doorId: '', entryDoorId: '', direction: 1, entryDirection: 1, exitDirection: 1, targetX: 0, runStarted: false, doorFinished: false, playerFinished: false, closingStarted: false, maskSide: 'right', entryMaskSide: 'right', playerHidden: false, fadeUnlockAt: 0, finishScheduled: false, fadeStarted: false, phase: 'entry' };
            let doorRushState = { ...DEFAULT_DOOR_RUSH_STATE };
            let doorFadeOverlay = null;
            let doorFadeTimers = [];
            const doorRushCameraState = { active: false, phase: 'none', timer: 0, duration: 0, startZoom: DEFAULT_ZOOM, targetZoom: DEFAULT_ZOOM, baseZoom: DEFAULT_ZOOM, frozenX: 0, frozenY: 0 };

            const platformImage = new Image();
            let platformImageLoaded = false;
            platformImage.src = 'img_assets/snake_Block.png'; // Using snake_Block as platform
            platformImage.onload = () => {
                platformImageLoaded = true;
                console.log("Platform image loaded.");
                blockHeight = platformImage.height * BLOCK_SCALE;
                recomputePlatforms();
                spawnCoinsForCurrentPlatforms();
            };
            platformImage.onerror = () => { console.error("Failed to load platform image."); };
            chairImage.onload = () => {
                chairImageLoaded = true;
                if (chairImage.width && chairImage.height) {
                    chairRenderSize = { width: chairImage.width, height: chairImage.height };
                    ensureChairSizes();
                }
            };
            chairImage.onerror = () => { console.error(`Failed to load chair image from ${CHAIR_ASSET_PATH}.`); };
            chairImage.src = CHAIR_ASSET_PATH;

            function clampPlayerToWorldBounds() {
                if (!player) return;
                if (WORLD_WIDTH <= 0 || WORLD_HEIGHT <= 0) return;
                if (player.x < 0) player.x = 0;
                const maxX = Math.max(0, WORLD_WIDTH - player.width);
                if (player.x > maxX) player.x = maxX;
                const groundY = Math.max(0, WORLD_HEIGHT - FLOOR_HEIGHT - player.height);
                if (player.y > groundY) {
                    player.y = groundY;
                    player.vy = 0;
                    player.onGround = true;
                    player.currentPlatform = null;
                    player.airJumpAvailable = true;
                    player.hasDoubleJumped = false;
                    player.doubleJumpFallGrace = 0;
                } else if (player.y < 0) {
                    player.y = 0;
                    player.vy = 0;
                }
            }

            function positionPlayerAtWorldCenterOnce() {
                if (playerSpawnPositionApplied) return;
                if (!player) return;
                if (WORLD_WIDTH <= 0 || WORLD_HEIGHT <= 0) return;
                const centerX = Math.max(0, (WORLD_WIDTH - player.width) / 2 + PLAYER_SPAWN_OFFSET_X);
                const centerY = Math.max(0, (WORLD_HEIGHT - player.height) / 2);
                player.x = centerX;
                player.y = centerY;
                player.vy = 0;
                player.onGround = false;
                player.currentPlatform = null;
                playerSpawnPositionApplied = true;
            }

            function updateCoinCounterDisplay() {
                if (!coinCounterElement) return;
                if (!ENABLE_COINS) {
                    coinCounterElement.style.display = 'none';
                    return;
                }
                coinCounterElement.textContent = `COINS: ${coinsCollected}`;
            }

            function updateJetpackBarVisual(containerWidthPx, containerHeightPx) {
                if (!jetpackBarElement || !jetpackBarFillElement) return;
                const now = performance.now();
                if (now - lastJetpackBarUpdate < UI_THROTTLE_MS) return;
                lastJetpackBarUpdate = now;
                const shouldShow = jetpackState.enabled && JETPACK_MAX_FUEL > 0;
                jetpackBarElement.style.display = shouldShow ? 'block' : 'none';
                if (!shouldShow) return;
                const percent = Math.max(0, Math.min(1, jetpackState.fuel / JETPACK_MAX_FUEL));
                jetpackBarFillElement.style.width = `${percent * 100}%`;

                const width = containerWidthPx ?? 0;
                const height = containerHeightPx ?? 0;
                const zoomScale = PLAYER_VISUAL_HEIGHT > 0 ? (height / PLAYER_VISUAL_HEIGHT) : 1;

                const offsetX = (width - jetpackBarElement.offsetWidth) / 2;
                const offsetY = (1000 * zoomScale) - jetpackBarElement.offsetHeight;

                jetpackBarElement.style.left = `${offsetX}px`;
                jetpackBarElement.style.top = `${offsetY}px`;
            }

            function getJetpackThrustMultiplier() {
                return 1 + coinsCollected * 0.0025; // +0.25% thrust per coin

            }

            function playLandingPuffEffect() {
                if (!landingVfxController) return;
                landingVfxController.play('landPuff', {
                    worldX: player.x + player.width / 2,
                    worldY: player.y + player.height
                });
            }

            function playCoinCollectEffect(coinX, coinY) {
                // Play sound
                playCoinCollectSound();
                // Play VFX with semi-random offset
                if (!coinCollectVfxController) {
                    console.warn('[CoinVFX] Controller missing; cannot play coin collect VFX.');
                    return;
                }
                const jitterX = (Math.random() - 0.5) * 2 * COIN_COLLECT_VFX_SETTINGS.offsetJitterX;
                const jitterY = (Math.random() - 0.5) * 1.1 * COIN_COLLECT_VFX_SETTINGS.offsetJitterY;
                const finalY = coinY + jitterY + COIN_COLLECT_VFX_SETTINGS.baseOffsetY;
                console.log('[CoinVFX] Playing coin collect VFX', { worldX: coinX + jitterX, worldY: finalY });
                coinCollectVfxController.play('coinCollect', {
                    worldX: coinX + jitterX,
                    worldY: finalY
                });
            }

            function playSkidPuffEffect() {
                if (!skidVfxController) {
                    console.warn('[SkidVFX] Controller missing; cannot play skid puff.');
                    return;
                }
                const direction = player.facingRight ? 1 : -1;
                const worldX = player.x + player.width / 2 + direction * SKID_PUFF_X_OFFSET;
                const worldY = player.y + player.height;
                console.log('[SkidVFX] Playing skid puff', { worldX, worldY, direction, offset: SKID_PUFF_X_OFFSET });
                skidVfxController.play('skidPuff', {
                    worldX,
                    worldY,
                    flipX: direction < 0
                });
            }

            function playSwordHitVfx() {
                if (!swordHitVfxController) return;
                const settings = SWORD_HIT_VFX_SETTINGS;
                const minCount = Math.max(1, Math.floor(settings.minCount || 1));
                const maxCount = Math.max(minCount, Math.floor(settings.maxCount || minCount));
                const countRange = maxCount - minCount;
                const spawnCount = countRange <= 0 ? minCount : (minCount + Math.floor(Math.random() * (countRange + 1)));
                const direction = player.facingRight ? 1 : -1;
                const baseX = player.x + player.width / 2 + direction * (settings.forwardOffset || 0);
                const baseY = player.y + player.height * (settings.heightRatio ?? 0.5);
                const forwardJitter = Math.max(0, settings.forwardJitter || 0);
                const verticalJitter = Math.max(0, settings.verticalJitter || 0);
                const scaleMin = settings.scaleRange?.min ?? 1;
                const scaleMax = settings.scaleRange?.max ?? scaleMin;
                const requests = [];
                for (let i = 0; i < spawnCount; i++) {
                    const worldX = baseX + direction * randomFloat(-forwardJitter, forwardJitter);
                    const worldY = baseY + randomFloat(-verticalJitter, verticalJitter);
                    const scale = scaleMin === scaleMax ? scaleMin : randomFloat(scaleMin, scaleMax);
                    requests.push({ worldX, worldY, scale });
                }
                const staggerFrames = spawnCount > 1 ? Math.max(1, Math.floor(settings.staggerFrames || 1)) : 0;
                swordHitVfxController.playBatch('swordHit', requests, { delayFrames: staggerFrames });
            }

            function computeSwordHitboxRect() {
                const direction = player.facingRight ? 1 : -1;
                const centerX = player.x + player.width / 2 + direction * SWORD_HITBOX_FORWARD_OFFSET;
                const centerY = player.y + player.height + SWORD_HITBOX_VERTICAL_OFFSET;
                return {
                    x: centerX - SWORD_HITBOX_WIDTH / 2,
                    y: centerY - SWORD_HITBOX_HEIGHT / 2,
                    width: SWORD_HITBOX_WIDTH,
                    height: SWORD_HITBOX_HEIGHT
                };
            }

            function flashSwordHitbox(rect) {
                swordHitboxRect = rect;
                swordHitboxFlashTimer = SWORD_HITBOX_FLASH_TIME;
            }

            function rectanglesOverlap(a, b) {
                if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.width) || !Number.isFinite(a.height) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return false;
                return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
            }

            // Reusable bounds objects to reduce per-frame allocations (perf optimization)
            const _reusableNpcRect = { x: 0, y: 0, width: 0, height: 0 };
            const _reusableCoinBounds = { left: 0, right: 0, top: 0, bottom: 0 };
            const _reusableDoorRect = { x: 0, y: 0, width: 0, height: 0 };

            // Spawns a random coin pile VFX at the player's feet
            function spawnCoinPileAtDoor(door) {
                if (!ENABLE_COINS || !coinPileVfxController || !player) return;

                // Randomly pick one of the 3 coin pile sequences
                const pileIndex = Math.floor(Math.random() * 3) + 1;
                const pileKey = `coinPile00${pileIndex}`;

                // Calculate spawn position at bottom-center of player with offsets
                const jitterX = (Math.random() - 0.5) * 2 * COIN_PILE_SETTINGS.offsetJitterX;
                const jitterY = (Math.random() - 0.5) * 2 * COIN_PILE_SETTINGS.offsetJitterY;
                const spawnX = player.x + player.width / 2 + COIN_PILE_SETTINGS.offsetX + jitterX;
                const spawnY = player.y + player.height + COIN_PILE_SETTINGS.offsetY + jitterY;

                coinPileVfxController.play(pileKey, {
                    worldX: spawnX,
                    worldY: spawnY,
                    scale: COIN_PILE_SETTINGS.scale
                });

                // Create a collectible that becomes active after the VFX animation finishes
                const pile = acquireCoinPileCollectible();
                pile.centerX = spawnX;
                pile.centerY = spawnY;
                pile.variant = pileIndex;
                pile.timer = 0;
                pile.ready = false;
                pile.scale = COIN_PILE_SETTINGS.scale;
                // Get dimensions from preloaded final frame image
                const finalFrame = coinPileFinalFrames[pileIndex];
                pile.width = (finalFrame?.naturalWidth || finalFrame?.width || 100) * pile.scale;
                pile.height = (finalFrame?.naturalHeight || finalFrame?.height || 100) * pile.scale;
                coinPileCollectibles.push(pile);
            }

            function handleSwordHitEvent() {
                const rect = computeSwordHitboxRect();
                flashSwordHitbox(rect);

                // Check for NPC hit
                const npcBounds = chatBotController?.getNpcWorldBounds?.();
                if (npcBounds) {
                    _reusableNpcRect.x = npcBounds.left ?? npcBounds.x;
                    _reusableNpcRect.y = npcBounds.top ?? npcBounds.y;
                    _reusableNpcRect.width = npcBounds.width;
                    _reusableNpcRect.height = npcBounds.height;
                    if (rectanglesOverlap(rect, _reusableNpcRect)) {
                        chatBotController?.playHitReaction?.({ freezeDuration: SWORD_HITBOX_FREEZE_DURATION });
                    }
                }

                // Check for door hit - spawn coin pile
                for (const door of doors) {
                    if (!door.ready) continue;
                    _reusableDoorRect.x = door.x;
                    _reusableDoorRect.y = door.y;
                    _reusableDoorRect.width = door.width;
                    _reusableDoorRect.height = door.height;
                    if (rectanglesOverlap(rect, _reusableDoorRect)) {
                        spawnCoinPileAtDoor(door);
                    }
                }
            }

            function updateSwordHitboxDebug(dt) {
                if (swordHitboxFlashTimer <= 0) return;
                swordHitboxFlashTimer = Math.max(0, swordHitboxFlashTimer - dt);
                if (swordHitboxFlashTimer === 0) {
                    swordHitboxRect = null;
                }
            }

            function drawSwordHitboxDebug(context) {
                if (!swordHitboxRect || swordHitboxFlashTimer <= 0) return;
                context.save();
                context.globalAlpha = 0.5;
                context.fillStyle = 'rgba(255, 0, 0, 0.18)';
                context.strokeStyle = 'rgba(255, 0, 0, 0.9)';
                context.lineWidth = Math.max(2, 3 / zoomLevel);
                context.fillRect(swordHitboxRect.x, swordHitboxRect.y, swordHitboxRect.width, swordHitboxRect.height);
                context.strokeRect(swordHitboxRect.x, swordHitboxRect.y, swordHitboxRect.width, swordHitboxRect.height);
                context.restore();
            }

            // Reusable VFX camera state object to reduce allocations (perf optimization)
            const _vfxCameraState = { cameraX: 0, cameraY: 0, zoom: 1 };
            const _vfxJetpackState = { emitting: false, facingRight: false, emitterWorldX: 0, emitterWorldY: 0, cameraX: 0, cameraY: 0, zoom: 1 };

            function updateAllVfx(dt) {
                // Update shared camera state once
                _vfxCameraState.cameraX = camera.x;
                _vfxCameraState.cameraY = camera.y;
                _vfxCameraState.zoom = zoomLevel;

                // Jetpack VFX (has additional params)
                if (jetpackVfxController && playerContainerElement) {
                    _vfxJetpackState.emitting = jetpackState.enabled && jetpackState.thrusting && jetpackState.fuel > 0;
                    _vfxJetpackState.facingRight = player.facingRight;
                    _vfxJetpackState.emitterWorldX = player.x + player.width / 2;
                    _vfxJetpackState.emitterWorldY = player.y + player.height;
                    _vfxJetpackState.cameraX = _vfxCameraState.cameraX;
                    _vfxJetpackState.cameraY = _vfxCameraState.cameraY;
                    _vfxJetpackState.zoom = _vfxCameraState.zoom;
                    jetpackVfxController.update(dt, _vfxJetpackState);
                }

                // Sequence VFX controllers share same camera state
                if (landingVfxController) landingVfxController.update(dt, _vfxCameraState);
                if (skidVfxController) skidVfxController.update(dt, _vfxCameraState);
                if (swordHitVfxController) swordHitVfxController.update(dt, _vfxCameraState);
                if (coinCollectVfxController) coinCollectVfxController.update(dt, _vfxCameraState);
                if (coinPileVfxController) coinPileVfxController.update(dt, _vfxCameraState);
            }

            function applyWorldDimensionSideEffects() {
                ensurePlatformThickness();
                basePlatforms = [{ x: 0, y: WORLD_HEIGHT - FLOOR_HEIGHT, width: WORLD_WIDTH, height: blockHeight, isBuild: false, oneWay: false }];
                recomputePlatforms();
                spawnCoinsForCurrentPlatforms();
                doorPlacements = doorPlacements.map(entry => normalizeDoorEntry(entry)).filter(Boolean);
                rebuildDoorsFromPlacements();
                layoutBalloonsInWorld();
                clampPlacedSpinePropsToWorld();
                beaverNpcController?.layout();
                clampTextBoxesToWorld();
                resetAmbientLeaves();
                jetpackState.fuel = JETPACK_MAX_FUEL;
                jetpackState.thrusting = false;
                positionPlayerAtWorldCenterOnce();
                clampPlayerToWorldBounds();
                if (cameraTrackingEnabled) centerCameraOnPlayer();
                else clampCameraPosition();
                if (currentBackground) {
                    loadSegmentsForBackground(currentBackground);
                }
            }

            function createSkinControlRow(group) {
                const row = document.createElement('div');
                row.className = 'skin-row';
                row.dataset.group = group.key;

                const createEl = (tag, props) => Object.assign(document.createElement(tag), props);

                const toggle = createEl('input', { type: 'checkbox', checked: true, title: `Toggle ${group.key}` });
                toggle.addEventListener('change', () => {
                    if (toggle.checked) {
                        updateSkinControlState(group.key);
                        applyInputValue(group.key);
                    } else {
                        setSkinSelection(group.key, '', { skipApply: true });
                        updateSkinControlState(group.key);
                        applySkinSelections();
                    }
                });

                const label = createEl('span', { textContent: group.key });
                const leftButton = createEl('button', { type: 'button', textContent: '<', title: `Previous ${group.key}` });
                leftButton.addEventListener('click', () => { cycleSkin(group.key, -1); leftButton.blur(); });

                const input = createEl('input', { type: 'text', placeholder: 'Skin name' });
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyInputValue(group.key); } });
                input.addEventListener('blur', () => applyInputValue(group.key));

                const rightButton = createEl('button', { type: 'button', textContent: '>', title: `Next ${group.key}` });
                rightButton.addEventListener('click', () => { cycleSkin(group.key, 1); rightButton.blur(); });

                row.append(toggle, label, leftButton, input, rightButton);

                skinInputs[group.key] = input;
                skinButtons[group.key] = { left: leftButton, right: rightButton };
                skinToggles[group.key] = toggle;

                leftButton.disabled = true;
                rightButton.disabled = true;
                input.disabled = true;

                return row;
            }

            function buildSkinControls() {
                if (!skinControlsContainer) return;
                skinControlsContainer.innerHTML = '';
                SKIN_GROUP_DEFS.forEach(group => {
                    skinControlsContainer.appendChild(createSkinControlRow(group));
                });
            }

            function isSkinGroupEnabled(groupKey) {
                const toggle = skinToggles[groupKey];
                return !toggle || toggle.checked;
            }

            function updateSkinControlState(groupKey) {
                const available = availableSkinsByGroup[groupKey] || [];
                const hasSkins = available.length > 0;
                const buttons = skinButtons[groupKey];
                const input = skinInputs[groupKey];
                const toggle = skinToggles[groupKey];
                const enabledByToggle = toggle ? toggle.checked : true;
                const shouldDisable = !hasSkins || !enabledByToggle;
                if (buttons) {
                    buttons.left.disabled = shouldDisable;
                    buttons.right.disabled = shouldDisable;
                }
                if (input) {
                    input.disabled = shouldDisable;
                    if (shouldDisable) {
                        input.value = '';
                        input.classList.remove('invalid');
                    }
                }
            }

            function populateAvailableSkins() {
                if (!allSkinNames || !allSkinNames.length) return;
                availableSkinsByGroup = {};
                SKIN_GROUP_DEFS.forEach(group => {
                    availableSkinsByGroup[group.key] = allSkinNames.filter(name => name.startsWith(group.prefix));
                    updateSkinControlState(group.key);
                });
            }

            function findSkinInGroup(groupKey, value) {
                const available = availableSkinsByGroup[groupKey] || [];
                const target = value.trim();
                if (!target) return '';
                const exactIndex = available.indexOf(target);
                if (exactIndex !== -1) return available[exactIndex];
                const lowerTarget = target.toLowerCase();
                const match = available.find(name => name.toLowerCase() === lowerTarget);
                return match || '';
            }

            function applyInputValue(groupKey) {
                const input = skinInputs[groupKey];
                if (!input) return;
                const rawValue = input.value.trim();
                if (rawValue === '') {
                    input.classList.remove('invalid');
                    setSkinSelection(groupKey, '');
                    return;
                }
                const match = findSkinInGroup(groupKey, rawValue);
                if (match) {
                    input.classList.remove('invalid');
                    setSkinSelection(groupKey, match);
                } else {
                    input.classList.add('invalid');
                }
            }

            function cycleSkin(groupKey, direction) {
                const available = availableSkinsByGroup[groupKey] || [];
                if (!available.length) return;
                const currentName = currentSkinSelections[groupKey] || '';
                let index = available.indexOf(currentName);
                if (index === -1) {
                    index = direction > 0 ? 0 : available.length - 1;
                } else {
                    index = (index + direction + available.length) % available.length;
                }
                setSkinSelection(groupKey, available[index]);
            }

            function setSkinSelection(groupKey, skinName, options = {}) {
                const input = skinInputs[groupKey];
                if (skinName) {
                    currentSkinSelections[groupKey] = skinName;
                } else {
                    delete currentSkinSelections[groupKey];
                }
                if (input) {
                    input.value = skinName || '';
                    input.classList.remove('invalid');
                }
                if (!options.skipApply) {
                    applySkinSelections();
                }
            }

            function applySkinSelections() {
                const namesToApply = [];
                SKIN_GROUP_DEFS.forEach(group => {
                    if (isSkinGroupEnabled(group.key)) {
                        const name = currentSkinSelections[group.key];
                        if (name && !namesToApply.includes(name)) {
                            namesToApply.push(name);
                        }
                    }
                });
                applySkinNames(namesToApply);
            }

            function applySkinNames(names, options = {}) {
                if (!spinePlayer || !spinePlayer.skeleton || !spineData) return;
                const uniqueNames = [];
                names.forEach(name => {
                    if (name && !uniqueNames.includes(name)) uniqueNames.push(name);
                });
                const newSkin = new spine.Skin('combined-chibi-skin');
                uniqueNames.forEach(name => {
                    const skinToAdd = spineData.findSkin(name);
                    if (skinToAdd) newSkin.addSkin(skinToAdd);
                });
                const skeleton = spinePlayer.skeleton;
                skeleton.setSkin(newSkin);
                resetSpineSlotsToSetupPose(skeleton);
                spinePlayer.chosenSkinsForDebug = uniqueNames.slice();

                if (!playerColors) {
                    playerColors = generateCharacterColors(null, { skin: true, hair: true, eyes: true });
                }
                applyAttachmentColors(skeleton, playerColors);
                updatePlayerDimensionsFromSkeleton();

                if (options.updateUI) {
                    currentSkinSelections = {};
                    SKIN_GROUP_DEFS.forEach(group => {
                        const match = uniqueNames.find(name => name.startsWith(group.prefix));
                        const input = skinInputs[group.key];
                        if (match) {
                            currentSkinSelections[group.key] = match;
                        }
                        if (input) {
                            input.value = match || '';
                            input.classList.remove('invalid');
                        }
                    });
                }
            }

            function formatAnimationLabel(animationName) {
                if (!animationName) return '';
                const base = animationName.split('/').pop() || animationName;
                return base.replace(/_/g, ' ');
            }

            function getCachedAnimationSelection(setKey, type) {
                return animationSelectionCache[setKey] ? animationSelectionCache[setKey][type] : undefined;
            }

            function cacheAnimationSelection(setKey, type, value) {
                if (!setKey || !type) return;
                if (!animationSelectionCache[setKey]) {
                    animationSelectionCache[setKey] = {};
                }
                animationSelectionCache[setKey][type] = value;
            }

            function populateSelect(selectElement, items, preferred) {
                if (!selectElement) return '';
                const values = Array.isArray(items) ? items.slice() : [];
                const previousValue = preferred !== undefined ? preferred : selectElement.value;
                selectElement.innerHTML = '';
                values.forEach(value => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = formatAnimationLabel(value);
                    selectElement.appendChild(option);
                });
                let nextValue = '';
                if (values.length) {
                    nextValue = values.includes(previousValue) ? previousValue : values[0];
                    selectElement.value = nextValue;
                } else {
                    selectElement.selectedIndex = -1;
                }
                selectElement.disabled = values.length === 0;
                return nextValue;
            }

            function refreshVariantSelects(setKey) {
                if (!animationSetSelect || !runAnimationSelect || !walkAnimationSelect) {
                    return { run: '', walk: '' };
                }
                const set = ANIMATION_SETS[setKey];
                if (!set) {
                    runAnimationSelect.innerHTML = '';
                    walkAnimationSelect.innerHTML = '';
                    runAnimationSelect.disabled = true;
                    walkAnimationSelect.disabled = true;
                    return { run: '', walk: '' };
                }
                const selectedRun = populateSelect(runAnimationSelect, set.run, getCachedAnimationSelection(setKey, 'run'));
                const selectedWalk = populateSelect(walkAnimationSelect, set.walk, getCachedAnimationSelection(setKey, 'walk'));
                return { run: selectedRun, walk: selectedWalk };
            }

            function resolveAnimationChoice(list, requested) {
                if (!Array.isArray(list) || list.length === 0) return requested || '';
                return (requested && list.includes(requested)) ? requested : list[0];
            }

            function updateRunAnimation(newRun) {
                if (!newRun || newRun === ANIM_RUN) return;
                const previousRun = ANIM_RUN;
                ANIM_RUN = newRun;
                if (spinePlayer && spinePlayer.animationState && player.currentAnimation === previousRun) {
                    if (isEmotePlaying()) return;
                    setSpineAnimation(ANIM_RUN, true);
                }
            }

            function updateWalkAnimation(newWalk) {
                if (!newWalk || newWalk === ANIM_WALK) return;
                const previousWalk = ANIM_WALK;
                ANIM_WALK = newWalk;
                if (spinePlayer && spinePlayer.animationState && player.currentAnimation === previousWalk) {
                    if (isEmotePlaying()) return;
                    setSpineAnimation(ANIM_WALK, true);
                }
            }

            function applyMovementSpeeds(movement) {
                if (!movement) return;
                currentMovementConfig = movement;
                if (typeof movement.walkSpeed === 'number' && !Number.isNaN(movement.walkSpeed)) {
                    PLAYER_WALK_SPEED = movement.walkSpeed;
                }
                if (typeof movement.runSpeed === 'number' && !Number.isNaN(movement.runSpeed)) {
                    PLAYER_RUN_SPEED = movement.runSpeed + DRIVINGSPEED;
                }
            }

            function applyAnimationSelection(setKey, runChoice, walkChoice) {
                const set = ANIMATION_SETS[setKey];
                if (!set) return;
                currentAnimationSetKey = setKey;
                const resolvedRun = resolveAnimationChoice(set.run, runChoice);
                const resolvedWalk = resolveAnimationChoice(set.walk, walkChoice);
                cacheAnimationSelection(setKey, 'run', resolvedRun);
                cacheAnimationSelection(setKey, 'walk', resolvedWalk);
                updateRunAnimation(resolvedRun);
                updateWalkAnimation(resolvedWalk);
                applyMovementSpeeds(set.movement);
            }

            function initializeAnimationControls() {
                const setKeys = Object.keys(ANIMATION_SETS);
                if (setKeys.length === 0) return;
                const defaultKey = setKeys.includes(DEFAULT_ANIMATION_SET_KEY) ? DEFAULT_ANIMATION_SET_KEY : setKeys[0];
                if (!animationSetSelect || !runAnimationSelect || !walkAnimationSelect) {
                    applyAnimationSelection(defaultKey, getDefaultAnimation(defaultKey, 'run'), getDefaultAnimation(defaultKey, 'walk'));
                    return;
                }
                animationSetSelect.innerHTML = '';
                setKeys.forEach(key => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = ANIMATION_SETS[key].displayName || key;
                    animationSetSelect.appendChild(option);
                });
                animationSetSelect.value = defaultKey;
                const selections = refreshVariantSelects(defaultKey);
                applyAnimationSelection(defaultKey, selections.run, selections.walk);
                animationSetSelect.addEventListener('change', () => {
                    const selectedKey = ANIMATION_SETS[animationSetSelect.value] ? animationSetSelect.value : defaultKey;
                    const updatedSelections = refreshVariantSelects(selectedKey);
                    const runValue = runAnimationSelect.value || updatedSelections.run;
                    const walkValue = walkAnimationSelect.value || updatedSelections.walk;
                    applyAnimationSelection(selectedKey, runValue, walkValue);
                });
                runAnimationSelect.addEventListener('change', () => {
                    const selectedRun = runAnimationSelect.value;
                    cacheAnimationSelection(currentAnimationSetKey, 'run', selectedRun);
                    const runList = ANIMATION_SETS[currentAnimationSetKey] ? ANIMATION_SETS[currentAnimationSetKey].run : [];
                    updateRunAnimation(resolveAnimationChoice(runList, selectedRun));
                });
                walkAnimationSelect.addEventListener('change', () => {
                    const selectedWalk = walkAnimationSelect.value;
                    cacheAnimationSelection(currentAnimationSetKey, 'walk', selectedWalk);
                    const walkList = ANIMATION_SETS[currentAnimationSetKey] ? ANIMATION_SETS[currentAnimationSetKey].walk : [];
                    updateWalkAnimation(resolveAnimationChoice(walkList, selectedWalk));
                });
            }

            function updateRandomAnimationTestButton() {
                if (!randomAnimationTestButton) return;
                randomAnimationTestButton.textContent = randomAnimationTestState.active ? 'Rnd Anim Test: ON' : 'Rnd Anim Test: OFF';
                randomAnimationTestButton.setAttribute('aria-pressed', String(randomAnimationTestState.active));
            }

            function clearRandomAnimationTestFallback() {
                if (randomAnimationTestState.fallbackTimerId !== null) {
                    clearTimeout(randomAnimationTestState.fallbackTimerId);
                    randomAnimationTestState.fallbackTimerId = null;
                }
            }

            function collectRandomAnimationTestCandidates() {
                const animations = spinePlayer?.skeleton?.data?.animations;
                if (!Array.isArray(animations)) return [];
                return animations
                    .map(animation => animation?.name)
                    .filter(name => typeof name === 'string' && name.trim().length > 0);
            }

            function pickRandomAnimationForTest(candidates) {
                if (!Array.isArray(candidates) || candidates.length === 0) return '';
                if (candidates.length === 1) return candidates[0];
                const previous = randomAnimationTestState.lastAnimationName;
                const alternatives = candidates.filter(name => name !== previous);
                const pool = alternatives.length > 0 ? alternatives : candidates;
                const randomIndex = Math.floor(Math.random() * pool.length);
                return pool[randomIndex];
            }

            function queueNextRandomAnimationTest(token) {
                if (!randomAnimationTestState.active || token !== randomAnimationTestState.token) return;
                if (!spinePlayer?.animationState || !spinePlayer?.skeleton?.data) {
                    stopRandomAnimationTest({ restoreBaseAnimation: false });
                    return;
                }
                const candidates = collectRandomAnimationTestCandidates();
                const nextAnimation = pickRandomAnimationForTest(candidates);
                if (!nextAnimation) {
                    stopRandomAnimationTest({ restoreBaseAnimation: true });
                    return;
                }
                const entry = setLoggedAnimation(0, nextAnimation, false);
                if (!entry) {
                    stopRandomAnimationTest({ restoreBaseAnimation: true });
                    return;
                }
                player.currentAnimation = nextAnimation;
                randomAnimationTestState.currentEntry = entry;
                randomAnimationTestState.lastAnimationName = nextAnimation;
                clearRandomAnimationTestFallback();

                let advanced = false;
                const advanceToNext = (trackEntry) => {
                    if (advanced) return;
                    if (trackEntry && trackEntry !== entry) return;
                    advanced = true;
                    if (randomAnimationTestState.currentEntry === entry) {
                        randomAnimationTestState.currentEntry = null;
                    }
                    clearRandomAnimationTestFallback();
                    if (!randomAnimationTestState.active || token !== randomAnimationTestState.token) return;
                    setTimeout(() => queueNextRandomAnimationTest(token), 0);
                };

                const previousListener = entry.listener || {};
                entry.listener = {
                    ...previousListener,
                    complete: (trackEntry) => {
                        if (typeof previousListener.complete === 'function') previousListener.complete(trackEntry);
                        advanceToNext(trackEntry);
                    },
                    end: (trackEntry) => {
                        if (typeof previousListener.end === 'function') previousListener.end(trackEntry);
                        advanceToNext(trackEntry);
                    },
                    dispose: (trackEntry) => {
                        if (typeof previousListener.dispose === 'function') previousListener.dispose(trackEntry);
                        advanceToNext(trackEntry);
                    }
                };

                const durationSeconds = entry.animation?.duration;
                if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
                    const fallbackDelayMs = Math.max(
                        RANDOM_ANIMATION_TEST_MIN_DURATION_MS,
                        Math.round(durationSeconds * 1000) + RANDOM_ANIMATION_TEST_FALLBACK_PADDING_MS
                    );
                    randomAnimationTestState.fallbackTimerId = setTimeout(() => {
                        advanceToNext(entry);
                    }, fallbackDelayMs);
                } else {
                    randomAnimationTestState.fallbackTimerId = setTimeout(() => {
                        advanceToNext(entry);
                    }, RANDOM_ANIMATION_TEST_MIN_DURATION_MS + RANDOM_ANIMATION_TEST_FALLBACK_PADDING_MS);
                }
            }

            function stopRandomAnimationTest(options = {}) {
                const restoreBaseAnimation = options.restoreBaseAnimation !== false;
                randomAnimationTestState.active = false;
                randomAnimationTestState.token += 1;
                randomAnimationTestState.currentEntry = null;
                randomAnimationTestState.lastAnimationName = '';
                clearRandomAnimationTestFallback();
                updateRandomAnimationTestButton();
                if (!restoreBaseAnimation) return;
                if (player.onGround) {
                    applyGroundAnimation();
                } else {
                    updateAirAnimation(player.vy);
                }
            }

            function startRandomAnimationTest() {
                if (!spinePlayer?.animationState || !spinePlayer?.skeleton?.data) return;
                if (randomAnimationTestState.active) return;
                if (doorRushState.active || player.doorState !== 'none' || player.sitState !== 'none') return;
                if (player.lieState !== 'none') return;
                if (player.fidgetState !== 'none') {
                    finalizeFidgetStop();
                }
                if (isEmotePlaying()) {
                    cancelEmotePlayback();
                }
                clearStopOverlay();
                clearTalkOverlay();
                clearTrackLogged(WIND_TRACK_INDEX);
                clearTrackLogged(LANDING_OVERLAY_TRACK_INDEX);
                clearTrackLogged(STOP_OVERLAY_TRACK_INDEX);
                player.vx = 0;
                player.vy = 0;
                player.isRunning = false;
                player.isMoving = false;
                player.previousMoveType = 'idle';
                player.lastMoveType = 'idle';
                player.isSkidding = false;
                player.jumpHeld = false;
                player.isJumping = false;
                player.jumpHoldTime = 0;
                player.isLandingAnimation = false;
                player.groundAnimCooldown = 0;
                player.landingInputLockTimer = 0;
                player.landingTooHard = false;
                player.landingHardBlendTriggered = false;
                jetpackState.thrusting = false;
                randomAnimationTestState.active = true;
                randomAnimationTestState.token += 1;
                randomAnimationTestState.lastAnimationName = '';
                updateRandomAnimationTestButton();
                queueNextRandomAnimationTest(randomAnimationTestState.token);
            }

            function toggleRandomAnimationTest() {
                if (randomAnimationTestState.active) {
                    stopRandomAnimationTest({ restoreBaseAnimation: true });
                } else {
                    startRandomAnimationTest();
                }
            }

            function startLieSequence() {
                if (player.lieState !== 'none' || !spinePlayer || !spinePlayer.animationState) return;
                if (player.fidgetState !== 'none') finalizeFidgetStop();
                player.lieState = 'starting';
                player.vx = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                playSpineAnimationOnce(ANIM_LIE_START, 0, () => {
                    if (player.lieState === 'starting') enterLieLoop();
                });
            }

            function enterLieLoop() {
                player.lieState = 'loop';
                setSpineAnimation(ANIM_LIE_LOOP, true);
            }

            function stopLieSequence() {
                if (player.lieState !== 'loop' || !spinePlayer || !spinePlayer.animationState) return;
                player.lieState = 'stopping';
                playSpineAnimationOnce(ANIM_LIE_STOP, 0, () => {
                    player.lieState = 'none';
                    setSpineAnimation(ANIM_IDLE, true);
                });
            }

            buildSkinControls();
            if (hairColorToggle) {
                hairColoringEnabled = hairColorToggle.checked;
                hairColorToggle.addEventListener('change', () => {
                    hairColoringEnabled = hairColorToggle.checked;
                    if (spinePlayer && spinePlayer.skeleton) {
                        applyAttachmentColors(spinePlayer.skeleton, playerColors, { includeHair: hairColoringEnabled });
                    }
                });
            }
            function loadBuildDataFromStorage() {
                try {
                    const raw = localStorage.getItem(BUILD_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read build data', err);
                }
                return {};
            }
            // Debounce utility for localStorage writes (perf optimization)
            const STORAGE_DEBOUNCE_MS = 300;
            const _storageDebounceTimers = { build: null, chair: null, door: null, balloon: null, spineProp: null, textBox: null, butterflySpawn: null };

            function _persistBuildDataImmediate() {
                try {
                    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(cachedBuildData));
                } catch (err) {
                    console.warn('Failed to save build data', err);
                }
            }
            function persistBuildData() {
                if (_storageDebounceTimers.build !== null) clearTimeout(_storageDebounceTimers.build);
                _storageDebounceTimers.build = setTimeout(() => {
                    _storageDebounceTimers.build = null;
                    _persistBuildDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedBuildData = loadBuildDataFromStorage();
            function loadChairDataFromStorage() {
                try {
                    const raw = localStorage.getItem(CHAIR_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read chair data', err);
                }
                return {};
            }
            function _persistChairDataImmediate() {
                try {
                    localStorage.setItem(CHAIR_STORAGE_KEY, JSON.stringify(cachedChairData));
                } catch (err) {
                    console.warn('Failed to save chair data', err);
                }
            }
            function persistChairData() {
                if (_storageDebounceTimers.chair !== null) clearTimeout(_storageDebounceTimers.chair);
                _storageDebounceTimers.chair = setTimeout(() => {
                    _storageDebounceTimers.chair = null;
                    _persistChairDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedChairData = loadChairDataFromStorage();
            function loadDoorDataFromStorage() {
                try {
                    const raw = localStorage.getItem(DOOR_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read door data', err);
                }
                return {};
            }
            function _persistDoorDataImmediate() {
                try {
                    localStorage.setItem(DOOR_STORAGE_KEY, JSON.stringify(cachedDoorData));
                } catch (err) {
                    console.warn('Failed to save door data', err);
                }
            }
            function persistDoorData() {
                if (_storageDebounceTimers.door !== null) clearTimeout(_storageDebounceTimers.door);
                _storageDebounceTimers.door = setTimeout(() => {
                    _storageDebounceTimers.door = null;
                    _persistDoorDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedDoorData = loadDoorDataFromStorage();
            function loadBalloonDataFromStorage() {
                try {
                    const raw = localStorage.getItem(BALLOON_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read balloon data', err);
                }
                return {};
            }
            function _persistBalloonDataImmediate() {
                try {
                    localStorage.setItem(BALLOON_STORAGE_KEY, JSON.stringify(cachedBalloonData));
                } catch (err) {
                    console.warn('Failed to save balloon data', err);
                }
            }
            function persistBalloonData() {
                if (_storageDebounceTimers.balloon !== null) clearTimeout(_storageDebounceTimers.balloon);
                _storageDebounceTimers.balloon = setTimeout(() => {
                    _storageDebounceTimers.balloon = null;
                    _persistBalloonDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedBalloonData = loadBalloonDataFromStorage();
            function loadSpinePropDataFromStorage() {
                try {
                    const raw = localStorage.getItem(SPINE_PROP_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read placed Spine prop data', err);
                }
                return {};
            }
            function _persistSpinePropDataImmediate() {
                try {
                    localStorage.setItem(SPINE_PROP_STORAGE_KEY, JSON.stringify(cachedSpinePropData));
                } catch (err) {
                    console.warn('Failed to save placed Spine prop data', err);
                }
            }
            function persistSpinePropData() {
                if (_storageDebounceTimers.spineProp !== null) clearTimeout(_storageDebounceTimers.spineProp);
                _storageDebounceTimers.spineProp = null;
                _persistSpinePropDataImmediate();
            }
            cachedSpinePropData = loadSpinePropDataFromStorage();
            function loadTextBoxDataFromStorage() {
                try {
                    const raw = localStorage.getItem(TEXT_BOX_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read text box data', err);
                }
                return {};
            }
            function _persistTextBoxDataImmediate() {
                try {
                    localStorage.setItem(TEXT_BOX_STORAGE_KEY, JSON.stringify(cachedTextBoxData));
                } catch (err) {
                    console.warn('Failed to save text box data', err);
                }
            }
            function persistTextBoxData() {
                if (_storageDebounceTimers.textBox !== null) clearTimeout(_storageDebounceTimers.textBox);
                _storageDebounceTimers.textBox = setTimeout(() => {
                    _storageDebounceTimers.textBox = null;
                    _persistTextBoxDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedTextBoxData = loadTextBoxDataFromStorage();
            function loadButterflySpawnDataFromStorage() {
                try {
                    const raw = localStorage.getItem(BUTTERFLY_SPAWN_STORAGE_KEY);
                    if (!raw) return {};
                    const parsed = JSON.parse(raw);
                    return (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (err) {
                    console.warn('Failed to read butterfly spawn data', err);
                }
                return {};
            }
            function _persistButterflySpawnDataImmediate() {
                try {
                    localStorage.setItem(BUTTERFLY_SPAWN_STORAGE_KEY, JSON.stringify(cachedButterflySpawnData));
                } catch (err) {
                    console.warn('Failed to save butterfly spawn data', err);
                }
            }
            function persistButterflySpawnData() {
                if (_storageDebounceTimers.butterflySpawn !== null) clearTimeout(_storageDebounceTimers.butterflySpawn);
                _storageDebounceTimers.butterflySpawn = setTimeout(() => {
                    _storageDebounceTimers.butterflySpawn = null;
                    _persistButterflySpawnDataImmediate();
                }, STORAGE_DEBOUNCE_MS);
            }
            cachedButterflySpawnData = loadButterflySpawnDataFromStorage();
            function ensurePlatformThickness() {
                if (blockHeight) return;
                blockHeight = (platformImageLoaded && platformImage.height) ? (platformImage.height * BLOCK_SCALE) : DEFAULT_PLATFORM_THICKNESS;
            }
            function ensureChairSizes() {
                const width = chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                const height = chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                chairPlacements.forEach(chair => {
                    chair.width = width;
                    chair.height = height;
                });
            }

            function applySittingEase(value, easeIn = SITTING_EASE_IN, easeOut = SITTING_EASE_OUT) {
                const t = Math.max(0, Math.min(1, value));
                const inPow = Math.max(0.01, Number.isFinite(easeIn) ? easeIn : 1);
                const outPow = Math.max(0.01, Number.isFinite(easeOut) ? easeOut : 1);
                if (t <= 0.5) {
                    const normalized = t * 2;
                    return 0.5 * Math.pow(normalized, inPow);
                }
                const normalized = (1 - t) * 2;
                return 1 - 0.5 * Math.pow(normalized, outPow);
            }

            function normalizeBuildDrawOrder(value, fallback = BUILD_DRAW_ORDER_DEFAULT) {
                const parsed = Number(value);
                const requested = Number.isFinite(parsed) ? parsed : fallback;
                return BUILD_DRAW_ORDER_STEPS.reduce((closest, step) => (
                    Math.abs(step - requested) < Math.abs(closest - requested) ? step : closest
                ), BUILD_DRAW_ORDER_STEPS[0]);
            }

            function getBuildDrawOrderLabel(order) {
                if (order === 5) return 'between Sky and Clouds';
                if (order === 15) return 'between Clouds and Land';
                if (order === 25) return 'between Land and Game Area';
                if (order === 35) return 'between Game Area and Foreground';
                if (order === 45) return 'above Foreground';
                if (order === 55) return 'in front of the player';
                return `depth ${order}`;
            }

            function getBuildLayerElement(target) {
                return target?.container || target?.element || null;
            }

            function getDefaultBuildDrawOrder(kind) {
                return kind === 'text-box' ? TEXT_BOX_DRAW_ORDER_DEFAULT : BUILD_DRAW_ORDER_DEFAULT;
            }

            function applyBuildDrawOrder(target, fallback = BUILD_DRAW_ORDER_DEFAULT) {
                if (!target) return;
                target.drawOrder = normalizeBuildDrawOrder(target.drawOrder, fallback);
                const element = getBuildLayerElement(target);
                if (element) element.style.zIndex = String(target.drawOrder);
            }

            function isBuildLayerSelectionValid(selection = selectedBuildLayerItem) {
                if (!selection?.target) return false;
                if (selection.kind === 'spine-prop') return placedSpineProps.includes(selection.target);
                if (selection.kind === 'text-box') return textBoxes.includes(selection.target);
                if (selection.kind === 'balloon') return balloons.includes(selection.target);
                if (selection.kind === 'butterfly-spawn') return butterflySpawns.includes(selection.target);
                return false;
            }

            function getBuildLayerSelectionLabel(selection) {
                if (selection?.kind === 'spine-prop') return selection.target.label || 'Fan/Bush';
                if (selection?.kind === 'text-box') return 'Text box';
                if (selection?.kind === 'balloon') return 'Balloon';
                if (selection?.kind === 'butterfly-spawn') return 'Butterfly spawn';
                return 'Item';
            }

            function updateBuildLayerControls(message = '') {
                if (selectedBuildLayerItem && !isBuildLayerSelectionValid()) selectedBuildLayerItem = null;
                const selection = selectedBuildLayerItem;
                const hasSelection = !!selection;
                const fallback = hasSelection ? getDefaultBuildDrawOrder(selection.kind) : BUILD_DRAW_ORDER_DEFAULT;
                const order = hasSelection
                    ? normalizeBuildDrawOrder(selection.target.drawOrder, fallback)
                    : BUILD_DRAW_ORDER_MIN;
                if (hasSelection) applyBuildDrawOrder(selection.target, fallback);
                updateBushSkinControl();
                if (buildLayerBackButton) buildLayerBackButton.disabled = !hasSelection || order <= BUILD_DRAW_ORDER_MIN;
                if (buildLayerForwardButton) buildLayerForwardButton.disabled = !hasSelection || order >= BUILD_DRAW_ORDER_MAX;
                if (!buildLayerStatus) return;
                if (message) {
                    buildLayerStatus.textContent = message;
                } else if (!hasSelection) {
                    buildLayerStatus.textContent = 'No layerable item selected.';
                } else {
                    const limitNote = order === BUILD_DRAW_ORDER_MIN
                        ? ' · back limit'
                        : order === BUILD_DRAW_ORDER_MAX ? ' · front limit' : '';
                    buildLayerStatus.textContent = `${getBuildLayerSelectionLabel(selection)} · ${getBuildDrawOrderLabel(order)} (z ${order})${limitNote}`;
                }
            }

            function setSelectedBuildLayerItem(kind, target) {
                selectedBuildLayerItem = kind && target ? { kind, target } : null;
                updateBuildLayerControls();
            }

            function setSelectedPlacedSpineProp(prop) {
                selectedPlacedSpineProp = prop || null;
                if (selectedPlacedSpineProp) {
                    if (selectedTextBox) {
                        selectedTextBox = null;
                        textBoxes.forEach(item => item.element?.classList.remove('selected'));
                    }
                    setSelectedBuildLayerItem('spine-prop', selectedPlacedSpineProp);
                } else if (selectedBuildLayerItem?.kind === 'spine-prop') {
                    setSelectedBuildLayerItem(null, null);
                }
            }

            function getPlacedBushSkinNames(prop) {
                if (!prop?.windAnimations || !prop.spinePlayer?.skeleton?.data?.skins) return [];
                return prop.spinePlayer.skeleton.data.skins
                    .map(skin => skin?.name)
                    .filter(Boolean);
            }

            function updateBushSkinControl() {
                if (!bushSkinControl || !bushSkinSelect) return;
                const prop = selectedBuildLayerItem?.kind === 'spine-prop'
                    ? selectedBuildLayerItem.target
                    : null;
                const isBush = !!prop?.windAnimations;
                bushSkinControl.hidden = !isBush;
                if (!isBush) {
                    bushSkinSelect.innerHTML = '';
                    return;
                }
                const skinNames = getPlacedBushSkinNames(prop);
                bushSkinSelect.innerHTML = '';
                if (!skinNames.length) {
                    const option = document.createElement('option');
                    option.textContent = prop.loadError ? 'Unable to load skins' : 'Loading skins…';
                    option.value = '';
                    bushSkinSelect.appendChild(option);
                    bushSkinSelect.disabled = true;
                    return;
                }
                skinNames.forEach((skinName) => {
                    const option = document.createElement('option');
                    option.value = skinName;
                    option.textContent = skinName;
                    bushSkinSelect.appendChild(option);
                });
                bushSkinSelect.disabled = false;
                bushSkinSelect.value = skinNames.includes(prop.skinName)
                    ? prop.skinName
                    : skinNames[0];
            }

            function applyPlacedBushSkin(prop, requestedSkinName, options = {}) {
                const skeleton = prop?.spinePlayer?.skeleton;
                if (!prop?.windAnimations || !skeleton?.data) return false;
                const skinNames = getPlacedBushSkinNames(prop);
                const skinName = skinNames.includes(requestedSkinName)
                    ? requestedSkinName
                    : skinNames.includes(DEFAULT_BUSH_SKIN) ? DEFAULT_BUSH_SKIN : skinNames[0];
                const skin = skinName ? skeleton.data.findSkin?.(skinName) : null;
                if (!skin) return false;
                skeleton.setSkin(skin);
                resetSpineSlotsToSetupPose(skeleton);
                if (spine.Physics?.pose !== undefined) skeleton.updateWorldTransform?.(spine.Physics.pose);
                prop.skinName = skinName;
                const currentAnimation = prop.spinePlayer.animationState?.getCurrent?.(0)?.animation;
                if (currentAnimation) prop.spinePlayer.setViewport?.(currentAnimation);
                if (selectedPlacedSpineProp === prop) updateBushSkinControl();
                if (options.persist !== false) savePlacedSpinePropsForCurrentBackground();
                return true;
            }

            if (bushSkinSelect) {
                bushSkinSelect.addEventListener('change', () => {
                    const prop = selectedPlacedSpineProp;
                    if (!applyPlacedBushSkin(prop, bushSkinSelect.value)) return;
                    setBuildAddFeedback(`${prop.label} skin changed to ${prop.skinName}.`);
                });
            }

            function persistBuildDrawOrderSelection(selection) {
                if (!selection) return;
                if (selection.kind === 'spine-prop') savePlacedSpinePropsForCurrentBackground();
                else if (selection.kind === 'text-box') saveTextBoxesForCurrentBackground();
                else if (selection.kind === 'balloon') saveBalloonForCurrentBackground(selection.target);
                else if (selection.kind === 'butterfly-spawn') saveButterflySpawnsForCurrentBackground();
            }

            function adjustSelectedBuildDrawOrder(delta) {
                if (!buildModeEnabled || !isBuildLayerSelectionValid()) {
                    setSelectedBuildLayerItem(null, null);
                    updateBuildLayerControls('Select a balloon, fan, bush, butterfly spawn, or text box first.');
                    return false;
                }
                const selection = selectedBuildLayerItem;
                const fallback = getDefaultBuildDrawOrder(selection.kind);
                const current = normalizeBuildDrawOrder(selection.target.drawOrder, fallback);
                const currentIndex = BUILD_DRAW_ORDER_STEPS.indexOf(current);
                const nextIndex = Math.max(
                    0,
                    Math.min(BUILD_DRAW_ORDER_STEPS.length - 1, currentIndex + Math.sign(delta))
                );
                const next = BUILD_DRAW_ORDER_STEPS[nextIndex];
                if (next === current) {
                    updateBuildLayerControls(current === BUILD_DRAW_ORDER_MIN
                        ? 'Already at the back limit between Sky and Clouds.'
                        : 'Already at the front limit.');
                    return false;
                }
                selection.target.drawOrder = next;
                applyBuildDrawOrder(selection.target, fallback);
                persistBuildDrawOrderSelection(selection);
                updateBuildLayerControls();
                return true;
            }

            function normalizeChairEntry(entry) {
                if (!entry || typeof entry !== 'object') return null;
                const fallbackWidth = chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                const fallbackHeight = chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                const width = Number.isFinite(entry.width) && entry.width > 0 ? entry.width : fallbackWidth;
                const height = Number.isFinite(entry.height) && entry.height > 0 ? entry.height : fallbackHeight;
                let x = Number(entry.x);
                let y = Number(entry.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                const maxX = Math.max(0, WORLD_WIDTH - width);
                const maxY = Math.max(0, WORLD_HEIGHT - height);
                x = Math.max(0, Math.min(x, maxX));
                y = Math.max(0, Math.min(y, maxY));
                return { x, y, width, height };
            }
            function normalizeDoorEntry(entry) {
                if (!entry || typeof entry !== 'object') return null;
                const scale = (Number.isFinite(entry.scale) && entry.scale > 0) ? entry.scale : DOOR_DEFAULT_SCALE;
                const size = getDoorWorldSize(scale);
                let x = Number(entry.x);
                let y = Number(entry.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                const maxX = Math.max(0, WORLD_WIDTH - size.width);
                const maxY = Math.max(0, WORLD_HEIGHT - size.height); // allow vertical offsets; clamp to world, not floor
                x = Math.max(0, Math.min(x, maxX));
                y = Math.max(0, Math.min(y, maxY));
                return { id: entry.id || '', x, y, scale };
            }
            function saveChairsForCurrentBackground() {
                if (!currentBackground) return;
                ensureChairSizes();
                cachedChairData[currentBackground] = chairPlacements.map(chair => ({
                    x: chair.x,
                    y: chair.y,
                    width: chair.width,
                    height: chair.height
                }));
                persistChairData();
            }
            function saveDoorsForCurrentBackground() {
                if (!currentBackground) return;
                cachedDoorData[currentBackground] = doorPlacements.map(door => ({
                    id: door.id,
                    x: door.x,
                    y: door.y,
                    scale: door.scale
                }));
                persistDoorData();
            }
            function saveBalloonForCurrentBackground(targetBalloon) {
                if (!currentBackground || !targetBalloon) return;
                if (!targetBalloon.ready) {
                    const placement = balloonPlacements[targetBalloon.id];
                    if (!placement) return;
                    placement.drawOrder = normalizeBuildDrawOrder(targetBalloon.drawOrder);
                    cachedBalloonData[currentBackground] = Object.fromEntries(
                        Object.entries(balloonPlacements).map(([id, value]) => [id, { ...value }])
                    );
                    persistBalloonData();
                    return;
                }
                const rootPoint = getBalloonBoneWorldPosition(targetBalloon, targetBalloon.rootBone);
                if (!rootPoint) return;
                balloonPlacements[targetBalloon.id] = {
                    rootX: rootPoint.x,
                    rootY: rootPoint.y,
                    drawOrder: normalizeBuildDrawOrder(targetBalloon.drawOrder)
                };
                cachedBalloonData[currentBackground] = Object.fromEntries(
                    BALLOON_VARIANTS
                        .map(({ id }) => [id, balloonPlacements[id]])
                        .filter(([, placement]) => placement)
                        .map(([id, placement]) => [id, { ...placement }])
                );
                persistBalloonData();
            }
            function saveMoneyTreeForCurrentBackground() {
                if (!currentBackground || !moneyTree) return;
                if (!moneyTree.ready) {
                    if (!moneyTreePlacement) return;
                    moneyTreePlacement.drawOrder = normalizeBuildDrawOrder(moneyTree.drawOrder);
                    cachedMoneyTreeData[currentBackground] = { ...moneyTreePlacement };
                    persistMoneyTreeData();
                    return;
                }
                const rootPoint = getMoneyTreeBoneWorldPosition(moneyTree.rootBone);
                if (!rootPoint) return;
                moneyTreePlacement = {
                    rootX: rootPoint.x,
                    rootY: rootPoint.y,
                    drawOrder: normalizeBuildDrawOrder(moneyTree.drawOrder)
                };
                cachedMoneyTreeData[currentBackground] = { ...moneyTreePlacement };
                persistMoneyTreeData();
            }
            function serializePlacedSpineProp(prop) {
                return {
                    id: prop.id,
                    type: prop.type,
                    x: prop.x,
                    y: prop.y,
                    scale: prop.scale,
                    skinName: prop.windAnimations ? (prop.skinName || DEFAULT_BUSH_SKIN) : undefined,
                    drawOrder: normalizeBuildDrawOrder(prop.drawOrder)
                };
            }
            function savePlacedSpinePropsForCurrentBackground() {
                if (!currentBackground) return;
                cachedSpinePropData[currentBackground] = placedSpineProps.map(serializePlacedSpineProp);
                persistSpinePropData();
            }
            function normalizePlacedSpinePropEntry(entry) {
                if (!entry || typeof entry !== 'object') return null;
                const type = String(entry.type || '');
                const definition = Object.prototype.hasOwnProperty.call(PLACED_SPINE_PROP_DEFS, type)
                    ? PLACED_SPINE_PROP_DEFS[type]
                    : null;
                if (!definition) return null;
                const scaleValue = Number(entry.scale);
                const scale = Number.isFinite(scaleValue) && scaleValue > 0
                    ? Math.max(0.25, Math.min(4, scaleValue))
                    : definition.scale;
                const size = getPlacedSpinePropWorldSize(type, scale);
                const xValue = Number(entry.x);
                const yValue = Number(entry.y);
                if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) return null;
                return {
                    id: String(entry.id || createPlacedSpinePropId(type)),
                    type,
                    scale,
                    skinName: definition.windAnimations
                        ? String(entry.skinName || DEFAULT_BUSH_SKIN)
                        : '',
                    drawOrder: normalizeBuildDrawOrder(entry.drawOrder),
                    x: Math.max(0, Math.min(xValue, Math.max(0, WORLD_WIDTH - size.width))),
                    y: Math.max(0, Math.min(yValue, Math.max(0, WORLD_HEIGHT - size.height)))
                };
            }
            function loadChairsForBackground(bgPath) {
                const entries = cachedChairData[bgPath];
                const fallbackWidth = chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                const fallbackHeight = chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                if (Array.isArray(entries)) {
                    chairPlacements = entries.map(entry => normalizeChairEntry({
                        x: Number(entry?.x),
                        y: Number(entry?.y),
                        width: Number.isFinite(entry?.width) ? Number(entry.width) : fallbackWidth,
                        height: Number.isFinite(entry?.height) ? Number(entry.height) : fallbackHeight
                    })).filter(Boolean);
                } else {
                    chairPlacements = [];
                }
                ensureChairSizes();
            }
            function loadDoorsForBackground(bgPath) {
                const entries = cachedDoorData[bgPath];
                if (Array.isArray(entries)) {
                    doorPlacements = entries.map(entry => normalizeDoorEntry({
                        id: entry?.id,
                        x: Number(entry?.x),
                        y: Number(entry?.y),
                        scale: Number(entry?.scale)
                    })).filter(Boolean);
                    // Auto-upgrade old saved scales to the new default.
                    const migrated = doorPlacements.map(entry => {
                        const scale = Number(entry.scale);
                        if (Number.isFinite(scale) && Math.abs(scale - DOOR_PREV_DEFAULT_SCALE) < 1e-6) {
                            return { ...entry, scale: DOOR_DEFAULT_SCALE };
                        }
                        return entry;
                    });
                    doorPlacements = migrated;
                } else {
                    doorPlacements = [];
                }
                if (!doorPlacements.length) {
                    doorPlacements = createDefaultDoorPlacements();
                    saveDoorsForCurrentBackground();
                }
                rebuildDoorsFromPlacements();
            }
            function loadBalloonForBackground(bgPath) {
                const entry = cachedBalloonData[bgPath];
                balloonPlacements = {};
                BALLOON_VARIANTS.forEach(({ id }) => {
                    // Migrate the original single-balloon save into the standard variant.
                    const saved = id === 'standard' && Number.isFinite(Number(entry?.rootX))
                        ? entry
                        : entry?.[id];
                    const rootX = Number(saved?.rootX);
                    const rootY = Number(saved?.rootY);
                    if (Number.isFinite(rootX) && Number.isFinite(rootY)) {
                        balloonPlacements[id] = {
                            rootX,
                            rootY,
                            drawOrder: normalizeBuildDrawOrder(saved?.drawOrder)
                        };
                    }
                });
                balloons.forEach((targetBalloon) => {
                    targetBalloon.drawOrder = normalizeBuildDrawOrder(
                        balloonPlacements[targetBalloon.id]?.drawOrder,
                        BUILD_DRAW_ORDER_DEFAULT
                    );
                });
                layoutBalloonsInWorld();
            }
            function loadMoneyTreeForBackground(bgPath) {
                const entry = cachedMoneyTreeData[bgPath];
                const rootX = Number(entry?.rootX);
                const rootY = Number(entry?.rootY);
                const drawOrder = normalizeBuildDrawOrder(entry?.drawOrder);
                moneyTreePlacement = Number.isFinite(rootX) && Number.isFinite(rootY)
                    ? { rootX, rootY, drawOrder }
                    : { drawOrder };
                if (moneyTree) moneyTree.drawOrder = drawOrder;
                layoutMoneyTreeInWorld();
            }
            function loadPlacedSpinePropsForBackground(bgPath) {
                const loadGeneration = ++placedSpinePropLoadGeneration;
                const releasedExistingPlayers = clearPlacedSpinePropInstances();
                placedSpinePropRestorePending = releasedExistingPlayers;
                const entries = Array.isArray(cachedSpinePropData[bgPath])
                    ? cachedSpinePropData[bgPath]
                    : [];
                const restorePlayers = () => {
                    if (loadGeneration !== placedSpinePropLoadGeneration || currentBackground !== bgPath) return;
                    const usedIds = new Set();
                    entries.slice(0, MAX_PLACED_SPINE_PROPS).forEach((entry) => {
                        const normalized = normalizePlacedSpinePropEntry(entry);
                        if (!normalized || usedIds.has(normalized.id)) return;
                        usedIds.add(normalized.id);
                        createPlacedSpineProp(normalized, { persist: false });
                    });
                    setSelectedPlacedSpineProp(null);
                    placedSpinePropRestorePending = false;
                };
                if (releasedExistingPlayers) requestAnimationFrame(restorePlayers);
                else restorePlayers();
            }
            function normalizeTextBoxEntry(entry) {
                if (!entry || typeof entry !== 'object') return null;
                const width = Math.max(
                    TEXT_BOX_MIN_SIZE.width,
                    Number.isFinite(Number(entry.width)) ? Number(entry.width) : TEXT_BOX_DEFAULT_SIZE.width
                );
                const height = Math.max(
                    TEXT_BOX_MIN_SIZE.height,
                    Number.isFinite(Number(entry.height)) ? Number(entry.height) : TEXT_BOX_DEFAULT_SIZE.height
                );
                let x = Number(entry.x);
                let y = Number(entry.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                const maxX = Math.max(0, WORLD_WIDTH - width);
                const maxY = Math.max(0, WORLD_HEIGHT - height);
                x = Math.max(0, Math.min(x, maxX));
                y = Math.max(0, Math.min(y, maxY));
                const fontSize = Math.max(8, Number.isFinite(Number(entry.fontSize)) ? Number(entry.fontSize) : TEXT_BOX_DEFAULT_FONT_SIZE);
                return {
                    id: String(entry.id || `text-${Date.now()}-${Math.floor(Math.random() * 100000)}`),
                    x,
                    y,
                    width,
                    height,
                    text: String(entry.text ?? ''),
                    fontSize,
                    drawOrder: normalizeBuildDrawOrder(entry.drawOrder, TEXT_BOX_DRAW_ORDER_DEFAULT)
                };
            }
            function serializeTextBox(textBox) {
                return {
                    id: textBox.id,
                    x: textBox.x,
                    y: textBox.y,
                    width: textBox.width,
                    height: textBox.height,
                    text: textBox.text,
                    fontSize: textBox.fontSize,
                    drawOrder: normalizeBuildDrawOrder(textBox.drawOrder, TEXT_BOX_DRAW_ORDER_DEFAULT)
                };
            }
            function saveTextBoxesForCurrentBackground() {
                if (!currentBackground) return;
                cachedTextBoxData[currentBackground] = textBoxes.map(serializeTextBox);
                persistTextBoxData();
            }
            function clearTextBoxElements() {
                textBoxes.forEach((textBox) => {
                    if (textBox.element?.parentNode) textBox.element.parentNode.removeChild(textBox.element);
                });
                textBoxes = [];
                setSelectedTextBox(null);
            }
            function loadTextBoxesForBackground(bgPath) {
                const entries = cachedTextBoxData[bgPath];
                clearTextBoxElements();
                if (!Array.isArray(entries)) return;
                textBoxes = entries.map(normalizeTextBoxEntry).filter(Boolean);
                textBoxes.forEach(createTextBoxElement);
                updateTextBoxContainers();
            }
            function setSelectedTextBox(textBox) {
                selectedTextBox = textBox || null;
                textBoxes.forEach((item) => {
                    item.element?.classList.toggle('selected', item === selectedTextBox);
                });
                if (selectedTextBox) {
                    setSelectedPlacedSpineProp(null);
                    setSelectedBuildLayerItem('text-box', selectedTextBox);
                } else if (selectedBuildLayerItem?.kind === 'text-box') {
                    setSelectedBuildLayerItem(null, null);
                }
            }
            function removeTextBox(textBox) {
                if (!textBox) return false;
                const index = textBoxes.indexOf(textBox);
                if (index === -1) return false;
                if (textBoxDragState.textBox === textBox) {
                    textBoxDragState.active = false;
                    textBoxDragState.pointerId = null;
                    textBoxDragState.textBox = null;
                    textBoxDragState.mode = '';
                }
                if (textBox.element?.parentNode) textBox.element.parentNode.removeChild(textBox.element);
                textBoxes.splice(index, 1);
                if (selectedTextBox === textBox) setSelectedTextBox(null);
                saveTextBoxesForCurrentBackground();
                return true;
            }
            function setTextBoxesEditable(editable) {
                textBoxes.forEach((textBox) => {
                    textBox.element?.classList.toggle('editable', editable);
                    if (textBox.textarea) {
                        textBox.textarea.readOnly = !editable;
                        textBox.textarea.tabIndex = editable ? 0 : -1;
                    }
                });
                if (!editable) setSelectedTextBox(null);
            }
            function updateTextBoxContainer(textBox) {
                if (!textBox?.element) return;
                const zoomScale = zoomLevel;
                textBox.element.style.left = `${(textBox.x - camera.x) * zoomScale}px`;
                textBox.element.style.top = `${(textBox.y - camera.y) * zoomScale}px`;
                textBox.element.style.width = `${textBox.width * zoomScale}px`;
                textBox.element.style.height = `${textBox.height * zoomScale}px`;
                textBox.element.style.fontSize = `${textBox.fontSize * zoomScale}px`;
                applyBuildDrawOrder(textBox, TEXT_BOX_DRAW_ORDER_DEFAULT);
            }
            function updateTextBoxContainers() {
                textBoxes.forEach(updateTextBoxContainer);
            }
            function clampTextBoxesToWorld() {
                textBoxes.forEach((textBox) => {
                    textBox.width = Math.max(TEXT_BOX_MIN_SIZE.width, Math.min(textBox.width, WORLD_WIDTH));
                    textBox.height = Math.max(TEXT_BOX_MIN_SIZE.height, Math.min(textBox.height, WORLD_HEIGHT));
                    textBox.x = Math.max(0, Math.min(textBox.x, Math.max(0, WORLD_WIDTH - textBox.width)));
                    textBox.y = Math.max(0, Math.min(textBox.y, Math.max(0, WORLD_HEIGHT - textBox.height)));
                });
                updateTextBoxContainers();
            }
            function createTextBoxElement(textBox) {
                if (!gameBoardElement || !textBox || textBox.element) return;
                const element = document.createElement('div');
                element.className = 'world-text-box';
                element.dataset.textBoxId = textBox.id;

                const dragHandle = document.createElement('div');
                dragHandle.className = 'world-text-drag-handle';
                dragHandle.textContent = 'Move';

                const textarea = document.createElement('textarea');
                textarea.className = 'world-text-input';
                textarea.value = textBox.text;
                textarea.readOnly = !buildModeEnabled;
                textarea.tabIndex = buildModeEnabled ? 0 : -1;
                textarea.setAttribute('aria-label', 'Scene text');

                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'world-text-resize-handle';

                element.append(dragHandle, textarea, resizeHandle);
                gameBoardElement.appendChild(element);

                textBox.element = element;
                textBox.textarea = textarea;
                textBox.dragHandle = dragHandle;
                textBox.resizeHandle = resizeHandle;

                element.classList.toggle('editable', buildModeEnabled);

                dragHandle.addEventListener('pointerdown', (event) => {
                    if (!buildModeEnabled) return;
                    event.preventDefault();
                    event.stopPropagation();
                    textarea.blur();
                    setSelectedTextBox(textBox);
                });
                resizeHandle.addEventListener('pointerdown', (event) => {
                    beginTextBoxResize(event, textBox);
                });
                textarea.addEventListener('pointerdown', (event) => {
                    if (!buildModeEnabled) return;
                    setSelectedTextBox(textBox);
                    event.stopPropagation();
                });
                textarea.addEventListener('input', () => {
                    textBox.text = textarea.value;
                    saveTextBoxesForCurrentBackground();
                });
                textarea.addEventListener('blur', () => {
                    textBox.text = textarea.value;
                    saveTextBoxesForCurrentBackground();
                });
                textarea.addEventListener('keydown', (event) => {
                    if (buildModeEnabled
                        && selectedTextBox === textBox
                        && (event.key === 'Delete' || event.key === 'Backspace')
                        && (event.ctrlKey || event.metaKey || event.shiftKey)) {
                        event.preventDefault();
                        event.stopPropagation();
                        removeTextBox(textBox);
                        return;
                    }
                    event.stopPropagation();
                });
                ['keyup', 'keypress'].forEach((eventName) => {
                    textarea.addEventListener(eventName, (event) => event.stopPropagation());
                });

                updateTextBoxContainer(textBox);
            }
            function addTextBoxAtVisibleCenter() {
                if (!buildModeEnabled) return;
                const visibleCenterX = camera.x + (CANVAS_WIDTH / zoomLevel) * 0.5;
                const visibleCenterY = camera.y + (CANVAS_HEIGHT / zoomLevel) * 0.5;
                const entry = normalizeTextBoxEntry({
                    id: `text-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                    x: visibleCenterX - TEXT_BOX_DEFAULT_SIZE.width * 0.5,
                    y: visibleCenterY - TEXT_BOX_DEFAULT_SIZE.height * 0.5,
                    width: TEXT_BOX_DEFAULT_SIZE.width,
                    height: TEXT_BOX_DEFAULT_SIZE.height,
                    text: TEXT_BOX_DEFAULT_TEXT,
                    fontSize: TEXT_BOX_DEFAULT_FONT_SIZE
                });
                if (!entry) return;
                textBoxes.push(entry);
                createTextBoxElement(entry);
                setSelectedTextBox(entry);
                saveTextBoxesForCurrentBackground();
                setTimeout(() => {
                    entry.textarea?.focus({ preventScroll: true });
                    entry.textarea?.select();
                }, 0);
            }
            function beginTextBoxMove(event, textBox) {
                if (!buildModeEnabled || !textBox) return;
                event.preventDefault();
                event.stopPropagation();
                const { worldX, worldY } = worldCoordsFromEvent(event);
                textBoxDragState.active = true;
                textBoxDragState.pointerId = event.pointerId;
                textBoxDragState.textBox = textBox;
                textBoxDragState.mode = 'move';
                textBoxDragState.offsetX = worldX - textBox.x;
                textBoxDragState.offsetY = worldY - textBox.y;
                setSelectedTextBox(textBox);
                try { textBox.element?.setPointerCapture?.(event.pointerId); } catch (err) { /* pointer capture is optional */ }
            }
            function beginTextBoxResize(event, textBox) {
                if (!buildModeEnabled || !textBox) return;
                event.preventDefault();
                event.stopPropagation();
                const { worldX, worldY } = worldCoordsFromEvent(event);
                textBoxDragState.active = true;
                textBoxDragState.pointerId = event.pointerId;
                textBoxDragState.textBox = textBox;
                textBoxDragState.mode = 'resize';
                textBoxDragState.startWorldX = worldX;
                textBoxDragState.startWorldY = worldY;
                textBoxDragState.startWidth = textBox.width;
                textBoxDragState.startHeight = textBox.height;
                setSelectedTextBox(textBox);
                try { textBox.element?.setPointerCapture?.(event.pointerId); } catch (err) { /* pointer capture is optional */ }
            }
            function updateTextBoxDrag(event) {
                if (!textBoxDragState.active || !textBoxDragState.textBox) return;
                event.preventDefault();
                const textBox = textBoxDragState.textBox;
                const { worldX, worldY } = worldCoordsFromEvent(event);
                if (textBoxDragState.mode === 'move') {
                    textBox.x = Math.max(0, Math.min(
                        WORLD_WIDTH - textBox.width,
                        worldX - textBoxDragState.offsetX
                    ));
                    textBox.y = Math.max(0, Math.min(
                        WORLD_HEIGHT - textBox.height,
                        worldY - textBoxDragState.offsetY
                    ));
                } else if (textBoxDragState.mode === 'resize') {
                    textBox.width = Math.max(
                        TEXT_BOX_MIN_SIZE.width,
                        Math.min(WORLD_WIDTH - textBox.x, textBoxDragState.startWidth + (worldX - textBoxDragState.startWorldX))
                    );
                    textBox.height = Math.max(
                        TEXT_BOX_MIN_SIZE.height,
                        Math.min(WORLD_HEIGHT - textBox.y, textBoxDragState.startHeight + (worldY - textBoxDragState.startWorldY))
                    );
                }
                updateTextBoxContainer(textBox);
            }
            function endTextBoxDrag(event = null) {
                if (!textBoxDragState.active) return;
                const pointerId = textBoxDragState.pointerId;
                const textBox = textBoxDragState.textBox;
                textBoxDragState.active = false;
                textBoxDragState.pointerId = null;
                textBoxDragState.textBox = null;
                textBoxDragState.mode = '';
                if (event && pointerId !== null) {
                    try { textBox?.element?.releasePointerCapture?.(pointerId); } catch (err) { /* pointer capture is optional */ }
                }
                if (textBox?.textarea) textBox.text = textBox.textarea.value;
                saveTextBoxesForCurrentBackground();
            }

            function butterflyRandom(min, max) {
                return min + Math.random() * (max - min);
            }

            function createButterflySpawnId() {
                butterflySpawnIdCounter += 1;
                return `butterflies-${Date.now().toString(36)}-${butterflySpawnIdCounter.toString(36)}`;
            }

            function normalizeButterflySpawnEntry(entry) {
                if (!entry || typeof entry !== 'object') return null;
                const x = Number(entry.x);
                const y = Number(entry.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return {
                    id: String(entry.id || createButterflySpawnId()),
                    x: Math.max(0, Math.min(WORLD_WIDTH, x)),
                    y: Math.max(0, Math.min(WORLD_HEIGHT, y)),
                    drawOrder: normalizeBuildDrawOrder(entry.drawOrder)
                };
            }

            function serializeButterflySpawn(spawn) {
                return {
                    id: spawn.id,
                    x: spawn.x,
                    y: spawn.y,
                    drawOrder: normalizeBuildDrawOrder(spawn.drawOrder)
                };
            }

            function saveButterflySpawnsForCurrentBackground() {
                if (!currentBackground) return;
                cachedButterflySpawnData[currentBackground] = butterflySpawns.map(serializeButterflySpawn);
                persistButterflySpawnData();
            }

            function createButterflyAgent(spawn, index) {
                const phase = butterflyRandom(0, Math.PI * 2);
                const image = document.createElement('img');
                image.className = 'butterfly-sprite';
                image.alt = '';
                image.draggable = false;
                Object.assign(image.style, {
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    willChange: 'left, top, transform',
                    transformOrigin: '50% 50%'
                });
                spawn.container.appendChild(image);
                return {
                    image,
                    x: spawn.x + Math.cos(phase) * butterflyRandom(40, BUTTERFLY_FLIGHT_RADIUS.x),
                    y: spawn.y + Math.sin(phase * 1.7) * butterflyRandom(30, BUTTERFLY_FLIGHT_RADIUS.y),
                    previousX: spawn.x,
                    previousY: spawn.y,
                    phase,
                    secondaryPhase: butterflyRandom(0, Math.PI * 2),
                    orbitSpeed: butterflyRandom(0.55, 1.05) * (Math.random() < 0.5 ? -1 : 1),
                    radiusX: butterflyRandom(BUTTERFLY_FLIGHT_RADIUS.x * 0.38, BUTTERFLY_FLIGHT_RADIUS.x),
                    radiusY: butterflyRandom(BUTTERFLY_FLIGHT_RADIUS.y * 0.35, BUTTERFLY_FLIGHT_RADIUS.y),
                    scale: BUTTERFLY_BASE_SCALE * butterflyRandom(0.72, 1.12),
                    mode: 'flying',
                    stateTimer: index < 2 ? butterflyRandom(0.8, 3.2) : butterflyRandom(4, 10),
                    landingChance: index === 0 ? 1 : index === 1 ? 0.72 : 0.34,
                    animTime: butterflyRandom(0, 2),
                    lastFrameKey: '',
                    landingX: spawn.x,
                    landingY: spawn.y,
                    facingRight: Math.random() < 0.5,
                    scatterVelocityX: 0,
                    scatterVelocityY: 0,
                    scatterQueued: false,
                    scatterDelay: 0
                };
            }

            function createButterflySpawn(entry = {}, options = {}) {
                if (!gameBoardElement) return null;
                if (butterflySpawns.length >= MAX_BUTTERFLY_SPAWNS) {
                    setBuildAddFeedback(`Maximum of ${MAX_BUTTERFLY_SPAWNS} butterfly spawn points reached.`);
                    return null;
                }
                const center = getVisibleWorldCenter();
                const normalized = normalizeButterflySpawnEntry({
                    id: entry.id,
                    x: Number.isFinite(Number(entry.x)) ? Number(entry.x) : center.x,
                    y: Number.isFinite(Number(entry.y)) ? Number(entry.y) : center.y,
                    drawOrder: entry.drawOrder
                });
                if (!normalized) return null;

                const container = document.createElement('div');
                container.className = 'butterfly-spawn-container';
                container.dataset.butterflySpawnId = normalized.id;
                Object.assign(container.style, {
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    overflow: 'hidden'
                });

                const marker = document.createElement('div');
                marker.className = 'butterfly-spawn-marker';
                marker.textContent = 'BUTTERFLIES';
                Object.assign(marker.style, {
                    position: 'absolute',
                    display: 'none',
                    boxSizing: 'border-box',
                    width: '92px',
                    height: '32px',
                    border: '2px dashed #80e7ff',
                    borderRadius: '16px',
                    background: 'rgba(14, 42, 64, 0.75)',
                    color: '#dffaff',
                    font: 'bold 9px monospace',
                    lineHeight: '28px',
                    textAlign: 'center',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 10px rgba(72, 206, 255, 0.65)'
                });
                container.appendChild(marker);
                gameBoardElement.appendChild(container);

                const spawn = {
                    ...normalized,
                    label: 'Butterfly spawn',
                    container,
                    marker,
                    butterflies: [],
                    scareLatched: false
                };
                butterflySpawns.push(spawn);
                for (let index = 0; index < BUTTERFLIES_PER_SPAWN; index += 1) {
                    spawn.butterflies.push(createButterflyAgent(spawn, index));
                }
                applyBuildDrawOrder(spawn);
                updateButterflySpawnContainer(spawn);
                if (options.select !== false) {
                    setSelectedTextBox(null);
                    setSelectedPlacedSpineProp(null);
                    setSelectedBuildLayerItem('butterfly-spawn', spawn);
                }
                if (options.persist !== false) {
                    saveButterflySpawnsForCurrentBackground();
                    setBuildAddFeedback('Butterfly spawn added. Drag its marker near a lamp post.');
                }
                return spawn;
            }

            function disposeButterflySpawn(spawn) {
                if (spawn?.container?.parentNode) spawn.container.parentNode.removeChild(spawn.container);
                if (spawn) {
                    spawn.container = null;
                    spawn.marker = null;
                    spawn.butterflies = [];
                }
            }

            function clearButterflySpawns() {
                butterflySpawns.forEach(disposeButterflySpawn);
                butterflySpawns = [];
                butterflyMotionAccumulator = 0;
                butterflySpawnDragState.active = false;
                butterflySpawnDragState.pointerId = null;
                butterflySpawnDragState.spawn = null;
                if (selectedBuildLayerItem?.kind === 'butterfly-spawn') setSelectedBuildLayerItem(null, null);
            }

            function loadButterflySpawnsForBackground(bgPath) {
                clearButterflySpawns();
                const entries = Array.isArray(cachedButterflySpawnData[bgPath])
                    ? cachedButterflySpawnData[bgPath]
                    : [];
                entries.slice(0, MAX_BUTTERFLY_SPAWNS).forEach((entry) => {
                    const normalized = normalizeButterflySpawnEntry(entry);
                    if (normalized) createButterflySpawn(normalized, { persist: false, select: false });
                });
            }

            function removeButterflySpawn(spawn) {
                const index = butterflySpawns.indexOf(spawn);
                if (index < 0) return false;
                if (butterflySpawnDragState.spawn === spawn) endButterflySpawnDrag();
                butterflySpawns.splice(index, 1);
                if (selectedBuildLayerItem?.target === spawn) setSelectedBuildLayerItem(null, null);
                disposeButterflySpawn(spawn);
                saveButterflySpawnsForCurrentBackground();
                setBuildAddFeedback('Butterfly spawn removed.');
                return true;
            }

            function findButterflySpawnAtPoint(worldX, worldY) {
                for (let index = butterflySpawns.length - 1; index >= 0; index -= 1) {
                    const spawn = butterflySpawns[index];
                    if (Math.hypot(worldX - spawn.x, worldY - spawn.y) <= BUTTERFLY_SPAWN_HIT_RADIUS) return spawn;
                }
                return null;
            }

            function getButterflyLandingSurfaceY(spawn, worldX) {
                let closestY = Infinity;
                platforms.forEach((platform) => {
                    let surfaceY = null;
                    if (platform.isSlope) {
                        const minX = Math.min(platform.x1, platform.x2);
                        const maxX = Math.max(platform.x1, platform.x2);
                        if (worldX < minX || worldX > maxX || maxX - minX < 1e-6) return;
                        const t = (worldX - platform.x1) / (platform.x2 - platform.x1);
                        surfaceY = platform.y1 + (platform.y2 - platform.y1) * t;
                    } else if (worldX >= platform.x && worldX <= platform.x + platform.width) {
                        surfaceY = platform.y;
                    }
                    if (Number.isFinite(surfaceY) && surfaceY > spawn.y + 35 && surfaceY < closestY) closestY = surfaceY;
                });
                if (Number.isFinite(closestY)) return closestY;
                return Math.max(spawn.y + 220, WORLD_HEIGHT - FLOOR_HEIGHT);
            }

            function beginButterflyLanding(spawn, butterfly) {
                butterfly.mode = 'descending';
                butterfly.landingX = Math.max(0, Math.min(
                    WORLD_WIDTH,
                    spawn.x + butterflyRandom(-95, 95)
                ));
                const surfaceY = getButterflyLandingSurfaceY(spawn, butterfly.landingX);
                butterfly.landingY = Math.min(
                    WORLD_HEIGHT,
                    surfaceY - BUTTERFLY_LANDED_FRAME_SIZE.height * butterfly.scale * 0.42
                );
                butterfly.stateTimer = 0;
            }

            function moveButterflyToward(butterfly, targetX, targetY, speed, dt) {
                const dx = targetX - butterfly.x;
                const dy = targetY - butterfly.y;
                const distance = Math.hypot(dx, dy);
                if (distance <= 0.001) return distance;
                const step = Math.min(distance, speed * dt);
                butterfly.x += dx / distance * step;
                butterfly.y += dy / distance * step;
                return distance;
            }

            function scatterButterflySpawn(spawn, playerCenterX) {
                spawn.butterflies.forEach((butterfly) => {
                    const side = butterfly.x < playerCenterX ? -1 : butterfly.x > playerCenterX ? 1 : (Math.random() < 0.5 ? -1 : 1);
                    butterfly.scatterQueued = true;
                    butterfly.scatterDelay = butterflyRandom(0.02, BUTTERFLY_SCATTER_DELAY_MAX);
                    butterfly.scatterVelocityX = side * butterflyRandom(
                        BUTTERFLY_SCATTER_SPEED * 0.65,
                        BUTTERFLY_SCATTER_SPEED * 1.15
                    ) + butterflyRandom(-80, 80);
                    butterfly.scatterVelocityY = -butterflyRandom(
                        BUTTERFLY_SCATTER_SPEED * 0.58,
                        BUTTERFLY_SCATTER_SPEED * 1.35
                    ) + butterflyRandom(-55, 35);
                });
            }

            function updateButterflyAgent(spawn, butterfly, dt) {
                butterfly.previousX = butterfly.x;
                butterfly.previousY = butterfly.y;
                butterfly.animTime += dt;
                butterfly.secondaryPhase += dt * 3.1;

                if (butterfly.scatterQueued) {
                    butterfly.scatterDelay -= dt;
                    if (butterfly.scatterDelay <= 0) {
                        butterfly.scatterQueued = false;
                        butterfly.mode = 'scattering';
                        butterfly.stateTimer = BUTTERFLY_SCATTER_DURATION * butterflyRandom(0.82, 1.18);
                        butterfly.animTime = butterflyRandom(0, 0.5);
                    }
                }

                if (butterfly.mode === 'scattering') {
                    butterfly.x += butterfly.scatterVelocityX * dt;
                    butterfly.y += butterfly.scatterVelocityY * dt;
                    butterfly.scatterVelocityX *= Math.pow(0.9, dt * 10);
                    butterfly.scatterVelocityY *= Math.pow(0.92, dt * 10);
                    butterfly.stateTimer -= dt;
                    if (butterfly.stateTimer <= 0) {
                        butterfly.mode = 'scattered';
                        butterfly.stateTimer = Math.max(0, BUTTERFLY_SCATTER_HOLD_SECONDS - BUTTERFLY_SCATTER_DURATION);
                    }
                } else if (butterfly.mode === 'scattered') {
                    butterfly.x += butterfly.scatterVelocityX * dt * 0.35;
                    butterfly.y += butterfly.scatterVelocityY * dt * 0.2;
                    butterfly.scatterVelocityX *= Math.pow(0.82, dt * 10);
                    butterfly.scatterVelocityY *= Math.pow(0.8, dt * 10);
                    butterfly.stateTimer -= dt;
                    if (butterfly.stateTimer <= 0) butterfly.mode = 'returning';
                } else if (butterfly.mode === 'returning') {
                    const targetX = spawn.x + Math.cos(butterfly.phase) * butterfly.radiusX * 0.45;
                    const targetY = spawn.y + Math.sin(butterfly.phase * 1.65) * butterfly.radiusY * 0.4;
                    const distance = moveButterflyToward(butterfly, targetX, targetY, 125, dt);
                    if (distance < 38) {
                        butterfly.mode = 'flying';
                        butterfly.stateTimer = butterflyRandom(3.5, 9);
                    }
                } else if (butterfly.mode === 'flying') {
                    butterfly.phase += butterfly.orbitSpeed * dt;
                    const targetX = spawn.x
                        + Math.cos(butterfly.phase) * butterfly.radiusX
                        + Math.sin(butterfly.secondaryPhase * 1.7) * 26;
                    const targetY = spawn.y
                        + Math.sin(butterfly.phase * 1.65) * butterfly.radiusY
                        + Math.cos(butterfly.secondaryPhase * 2.2) * 22;
                    const follow = Math.min(1, dt * 2.7);
                    butterfly.x += (targetX - butterfly.x) * follow;
                    butterfly.y += (targetY - butterfly.y) * follow;
                    butterfly.stateTimer -= dt;
                    if (butterfly.stateTimer <= 0) {
                        if (Math.random() < butterfly.landingChance) {
                            beginButterflyLanding(spawn, butterfly);
                            butterfly.landingChance = 0.42;
                        }
                        else butterfly.stateTimer = butterflyRandom(3.5, 9);
                    }
                } else if (butterfly.mode === 'descending') {
                    const flutterX = Math.sin(butterfly.secondaryPhase * 2.4) * 22;
                    const distance = moveButterflyToward(
                        butterfly,
                        butterfly.landingX + flutterX,
                        butterfly.landingY,
                        185,
                        dt
                    );
                    if (distance < 10) {
                        butterfly.x = butterfly.landingX;
                        butterfly.y = butterfly.landingY;
                        butterfly.mode = 'landed';
                        butterfly.stateTimer = butterflyRandom(2.5, 7);
                        butterfly.animTime = butterflyRandom(0, 1);
                    }
                } else if (butterfly.mode === 'landed') {
                    butterfly.stateTimer -= dt;
                    if (butterfly.stateTimer <= 0) {
                        butterfly.mode = 'ascending';
                        butterfly.stateTimer = butterflyRandom(3.5, 8);
                    }
                } else if (butterfly.mode === 'ascending') {
                    const targetX = spawn.x + Math.sin(butterfly.secondaryPhase) * 55;
                    const targetY = spawn.y + Math.cos(butterfly.secondaryPhase * 1.4) * 45;
                    const distance = moveButterflyToward(butterfly, targetX, targetY, 220, dt);
                    if (distance < 45) {
                        butterfly.mode = 'flying';
                        butterfly.phase = butterflyRandom(0, Math.PI * 2);
                        butterfly.stateTimer = butterflyRandom(4, 10);
                    }
                }

                const horizontalVelocity = butterfly.x - butterfly.previousX;
                if (Math.abs(horizontalVelocity) > 0.05) butterfly.facingRight = horizontalVelocity > 0;
            }

            function stepButterflySpawns(dt) {
                butterflySpawns.forEach((spawn) => {
                    const playerCenterX = player.x + player.width * 0.5;
                    const playerCenterY = player.y + player.height * 0.5;
                    const normalizedX = (playerCenterX - spawn.x) / BUTTERFLY_PLAYER_SCARE_RADIUS.x;
                    const normalizedY = (playerCenterY - spawn.y) / BUTTERFLY_PLAYER_SCARE_RADIUS.y;
                    const proximity = normalizedX * normalizedX + normalizedY * normalizedY;
                    const nearAnyButterfly = spawn.butterflies.some((butterfly) => {
                        const dx = (playerCenterX - butterfly.x) / BUTTERFLY_INDIVIDUAL_SCARE_RADIUS.x;
                        const dy = (playerCenterY - butterfly.y) / BUTTERFLY_INDIVIDUAL_SCARE_RADIUS.y;
                        return dx * dx + dy * dy <= 1;
                    });
                    if (nearAnyButterfly && !spawn.scareLatched && !butterflySpawnDragState.active) {
                        spawn.scareLatched = true;
                        scatterButterflySpawn(spawn, playerCenterX);
                    } else if (proximity > 1.7) {
                        spawn.scareLatched = false;
                    }
                    spawn.butterflies.forEach((butterfly) => updateButterflyAgent(spawn, butterfly, dt));
                });
            }

            function updateButterflySpawns(dt) {
                butterflyMotionAccumulator += Math.min(0.4, Math.max(0, dt));
                let steps = 0;
                while (butterflyMotionAccumulator >= BUTTERFLY_MOTION_STEP && steps < 4) {
                    stepButterflySpawns(BUTTERFLY_MOTION_STEP);
                    butterflyMotionAccumulator -= BUTTERFLY_MOTION_STEP;
                    steps += 1;
                }
                if (steps >= 4) butterflyMotionAccumulator = 0;
            }

            function updateButterflySpawnContainer(spawn) {
                if (!spawn?.container) return;
                applyBuildDrawOrder(spawn);
                spawn.container.style.width = `${CANVAS_WIDTH}px`;
                spawn.container.style.height = `${CANVAS_HEIGHT}px`;
                const markerX = (spawn.x - camera.x) * zoomLevel;
                const markerY = (spawn.y - camera.y) * zoomLevel;
                if (spawn.marker) {
                    spawn.marker.style.display = buildModeEnabled ? 'block' : 'none';
                    spawn.marker.style.left = `${markerX}px`;
                    spawn.marker.style.top = `${markerY}px`;
                    const selected = selectedBuildLayerItem?.target === spawn;
                    spawn.marker.style.borderColor = selected ? '#ffe66d' : '#80e7ff';
                    spawn.marker.style.boxShadow = selected
                        ? '0 0 14px rgba(255, 230, 109, 0.9)'
                        : '0 0 10px rgba(72, 206, 255, 0.65)';
                }

                spawn.butterflies.forEach((butterfly) => {
                    const landed = butterfly.mode === 'landed';
                    const frameSet = landed ? butterflyFrames.landed : butterflyFrames.flying;
                    const fps = landed ? BUTTERFLY_IDLE_FPS : BUTTERFLY_FLY_FPS;
                    const frameIndex = Math.floor(butterfly.animTime * fps) % BUTTERFLY_FRAME_COUNT;
                    const frameKey = `${landed ? 'landed' : 'flying'}-${frameIndex}`;
                    if (frameKey !== butterfly.lastFrameKey) {
                        butterfly.image.src = frameSet[frameIndex].src;
                        butterfly.lastFrameKey = frameKey;
                    }
                    const frameSize = landed ? BUTTERFLY_LANDED_FRAME_SIZE : BUTTERFLY_FLY_FRAME_SIZE;
                    const width = frameSize.width * butterfly.scale * zoomLevel;
                    const height = frameSize.height * butterfly.scale * zoomLevel;
                    const screenX = (butterfly.x - camera.x) * zoomLevel;
                    const screenY = (butterfly.y - camera.y) * zoomLevel;
                    const visible = screenX > -width * 2 && screenX < CANVAS_WIDTH + width * 2
                        && screenY > -height * 2 && screenY < CANVAS_HEIGHT + height * 2;
                    butterfly.image.style.display = visible ? 'block' : 'none';
                    if (!visible) return;
                    butterfly.image.style.left = `${screenX - width * 0.5}px`;
                    butterfly.image.style.top = `${screenY - height * 0.5}px`;
                    butterfly.image.style.width = `${width}px`;
                    butterfly.image.style.height = `${height}px`;
                    const verticalVelocity = butterfly.y - butterfly.previousY;
                    const rotation = landed ? 0 : Math.max(-18, Math.min(18, verticalVelocity * 0.8));
                    butterfly.image.style.transform = `scaleX(${butterfly.facingRight ? -1 : 1}) rotate(${rotation}deg)`;
                });
            }

            function updateButterflySpawnContainers() {
                butterflySpawns.forEach(updateButterflySpawnContainer);
            }

            function beginButterflySpawnDrag(event, worldX, worldY) {
                const spawn = buildModeEnabled ? findButterflySpawnAtPoint(worldX, worldY) : null;
                if (!spawn) return false;
                setSelectedTextBox(null);
                setSelectedPlacedSpineProp(null);
                setSelectedBuildLayerItem('butterfly-spawn', spawn);
                butterflySpawnDragState.active = true;
                butterflySpawnDragState.pointerId = event.pointerId;
                butterflySpawnDragState.spawn = spawn;
                butterflySpawnDragState.offsetX = worldX - spawn.x;
                butterflySpawnDragState.offsetY = worldY - spawn.y;
                gameBoardElement.style.cursor = 'grabbing';
                try { gameBoardElement.setPointerCapture?.(event.pointerId); } catch (err) { /* optional */ }
                return true;
            }

            function updateButterflySpawnDrag(worldX, worldY) {
                const spawn = butterflySpawnDragState.spawn;
                if (!butterflySpawnDragState.active || !spawn) return;
                const nextX = Math.max(0, Math.min(WORLD_WIDTH, worldX - butterflySpawnDragState.offsetX));
                const nextY = Math.max(0, Math.min(WORLD_HEIGHT, worldY - butterflySpawnDragState.offsetY));
                const dx = nextX - spawn.x;
                const dy = nextY - spawn.y;
                spawn.x = nextX;
                spawn.y = nextY;
                spawn.butterflies.forEach((butterfly) => {
                    butterfly.x += dx;
                    butterfly.y += dy;
                    butterfly.landingX += dx;
                    butterfly.landingY += dy;
                });
                updateButterflySpawnContainer(spawn);
            }

            function endButterflySpawnDrag(event = null) {
                if (!butterflySpawnDragState.active) return;
                const pointerId = butterflySpawnDragState.pointerId;
                const spawn = butterflySpawnDragState.spawn;
                butterflySpawnDragState.active = false;
                butterflySpawnDragState.pointerId = null;
                butterflySpawnDragState.spawn = null;
                if (gameBoardElement) gameBoardElement.style.cursor = '';
                if (event && pointerId !== null) {
                    try { gameBoardElement.releasePointerCapture?.(pointerId); } catch (err) { /* optional */ }
                }
                spawn?.butterflies.forEach((butterfly) => {
                    butterfly.scatterQueued = false;
                    if (butterfly.mode !== 'flying') {
                        butterfly.mode = 'flying';
                        butterfly.stateTimer = butterflyRandom(2, 7);
                    }
                });
                saveButterflySpawnsForCurrentBackground();
            }

            function setChairPlacementMode(enabled) {
                chairPlacementMode = !!enabled && buildModeEnabled;
                if (chairPlacementMode && doorPlacementMode) {
                    setDoorPlacementMode(false);
                }
                if (chairToolButton) {
                    chairToolButton.disabled = !buildModeEnabled;
                    chairToolButton.classList.toggle('active', chairPlacementMode);
                    chairToolButton.textContent = chairPlacementMode ? 'Chair Tool (On)' : 'Chair Tool (Off)';
                }
            }
            function setDoorPlacementMode(enabled) {
                doorPlacementMode = !!enabled && buildModeEnabled;
                if (doorToolButton) {
                    doorToolButton.disabled = !buildModeEnabled;
                    doorToolButton.classList.toggle('active', doorPlacementMode);
                    doorToolButton.textContent = doorPlacementMode ? 'Door Tool (On)' : 'Door Tool (Off)';
                }
                if (doorPlacementMode) setChairPlacementMode(false);
            }
            function placeChairAt(worldX, worldY) {
                const width = chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                const height = chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                const entry = normalizeChairEntry({ x: worldX - width / 2, y: worldY - height, width, height });
                if (!entry) return;
                chairPlacements.push(entry);
                saveChairsForCurrentBackground();
            }
            function placeDoorAt(worldX, worldY) {
                if (!hasManagedSpinePlayerCapacity()) {
                    console.warn('Door was not added because the scene has reached its Spine graphics capacity.');
                    setBuildAddFeedback('Graphics capacity reached. Remove a fan, bush, or door before adding another door.');
                    return;
                }
                const size = getDoorWorldSize(DOOR_DEFAULT_SCALE);
                const entry = normalizeDoorEntry({
                    id: `door-${Date.now()}`,
                    // Drop the door's top-left at the exact click point (plus any optional offset)
                    x: worldX + (DOOR_PLACE_OFFSET?.x || 0),
                    y: worldY + (DOOR_PLACE_OFFSET?.y || 0),
                    scale: DOOR_DEFAULT_SCALE
                });
                if (!entry) return;
                doorPlacements.push(entry);
                rebuildDoorsFromPlacements();
                saveDoorsForCurrentBackground();
            }

            function removeChairAt(worldX, worldY) {
                if (!chairPlacements.length) return;
                const index = chairPlacements.findIndex(chair =>
                    worldX >= chair.x - CHAIR_REMOVE_RADIUS &&
                    worldX <= chair.x + chair.width + CHAIR_REMOVE_RADIUS &&
                    worldY >= chair.y - CHAIR_REMOVE_RADIUS &&
                    worldY <= chair.y + chair.height + CHAIR_REMOVE_RADIUS
                );
                if (index !== -1) {
                    chairPlacements.splice(index, 1);
                    saveChairsForCurrentBackground();
                }
            }
            function removeDoorAt(worldX, worldY) {
                if (!doorPlacements.length) return;
                const index = doorPlacements.findIndex(doorEntry => {
                    const size = getDoorWorldSize(doorEntry.scale);
                    return (
                        worldX >= doorEntry.x - DOOR_REMOVE_RADIUS &&
                        worldX <= doorEntry.x + size.width + DOOR_REMOVE_RADIUS &&
                        worldY >= doorEntry.y - DOOR_REMOVE_RADIUS &&
                        worldY <= doorEntry.y + size.height + DOOR_REMOVE_RADIUS
                    );
                });
                if (index !== -1) {
                    doorPlacements.splice(index, 1);
                    rebuildDoorsFromPlacements();
                    saveDoorsForCurrentBackground();
                }
            }



            function findOverlappingChair(hitbox) {
                if (!hitbox || !chairPlacements.length) return null;
                const left = hitbox.x, right = hitbox.x + hitbox.width;
                const top = hitbox.y, bottom = hitbox.y + hitbox.height;
                for (const chair of chairPlacements) {
                    const overlap =
                        left < chair.x + chair.width &&
                        right > chair.x &&
                        top < chair.y + chair.height &&
                        bottom > chair.y;
                    if (overlap) return chair;
                }
                return null;
            }

            function beginSittingOnChair(chair) {
                if (!chair || player.sitState !== 'none') return;
                const chairWidth = chair.width || chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                const chairHeight = chair.height || chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                const targetX = Math.max(0, Math.min(chair.x + chairWidth / 2 - player.width / 2 + SITTING_POSITION.x, WORLD_WIDTH - player.width));
                const targetY = Math.max(0, Math.min(chair.y + chairHeight / 2 - player.height / 2 + SITTING_POSITION.y, WORLD_HEIGHT - player.height));
                player.sitState = 'moving';
                player.sittingChair = chair;
                player.sitTimer = 0;
                player.sitStartX = player.x;
                player.sitStartY = player.y;
                player.sitTargetX = targetX;
                player.sitTargetY = targetY;
                player.sitExitMoveDone = false;
                player.sitExitAnimDone = false;
                player.vx = 0; player.vy = 0; player.isJumping = false; player.jumpHoldTime = 0; player.isRunning = false;
                slopeSlideState.active = false; playerTiltAngleDeg = 0;
                playSpineAnimationOnce(ANIM_SIT_BEGIN, 0, () => {
                    if (player.sitState !== 'none') {
                        setSpineAnimation(ANIM_SIT_LOOP, true);
                    }
                });
            }

            function updateSitting(dt) {
                if (player.sitState === 'none') return;
                player.vx = 0; player.vy = 0;
                player.onGround = true;
                player.currentPlatform = null;
                if (player.sitState === 'moving') {
                    player.sitTimer += dt;
                    const rawT = Math.max(0, Math.min(1, player.sitTimer / SITTING_MOVE_DURATION));
                    const eased = applySittingEase(rawT);
                    player.x = player.sitStartX + (player.sitTargetX - player.sitStartX) * eased;
                    player.y = player.sitStartY + (player.sitTargetY - player.sitStartY) * eased;
                    if (rawT >= 1) {
                        player.sitState = 'seated';
                        setSpineAnimation(ANIM_SIT_LOOP, true);
                    }
                } else if (player.sitState === 'seated') {
                    player.x = player.sitTargetX;
                    player.y = player.sitTargetY;
                } else if (player.sitState === 'exiting') {
                    player.sitTimer += dt;
                    const rawT = Math.max(0, Math.min(1, player.sitTimer / SITTING_MOVE_DURATION));
                    const eased = applySittingEase(rawT);
                    player.x = player.sitTargetX + (player.sitStartX - player.sitTargetX) * eased;
                    player.y = player.sitTargetY + (player.sitStartY - player.sitTargetY) * eased;
                    if (rawT >= 1) {
                        player.x = player.sitStartX;
                        player.y = player.sitStartY;
                        player.sitExitMoveDone = true;
                    }
                    if (player.sitExitMoveDone && player.sitExitAnimDone) {
                        completeSitExit();
                    }
                }
            }

            function completeSitExit() {
                player.sitState = 'none';
                player.sitExitMoveDone = false;
                player.sitExitAnimDone = false;
                player.x = player.sitStartX;
                player.y = player.sitStartY;
                setSpineAnimation(ANIM_IDLE, true);
            }

            function stopSitting() {
                if (player.sitState === 'none' || player.sitState === 'exiting') return;
                const wasSitting = player.sitState;
                sitPromptChair = null;
                if (sitPromptElement) sitPromptElement.style.display = 'none';
                player.sittingChair = null;
                player.sitTimer = 0;
                player.sitExitMoveDone = false;
                player.sitExitAnimDone = false;
                if (wasSitting === 'moving') {
                    player.sitState = 'none';
                    setSpineAnimation(ANIM_IDLE, true);
                    return;
                }
                player.sitState = 'exiting';
                const markAnimDone = () => {
                    player.sitExitAnimDone = true;
                    if (player.sitExitMoveDone) completeSitExit();
                };
                if (spinePlayer?.animationState && spinePlayer.skeleton.data.findAnimation(ANIM_SIT_END)) {
                    playSpineAnimationOnce(ANIM_SIT_END, 0, markAnimDone);
                } else {
                    markAnimDone();
                }
            }



            function getDoorWorldSize(scale = DOOR_DEFAULT_SCALE) {
                const clamped = Number.isFinite(scale) && scale > 0 ? scale : DOOR_DEFAULT_SCALE;
                return {
                    width: DOOR_SKELETON_SIZE.width * clamped,
                    height: DOOR_SKELETON_SIZE.height * clamped
                };
            }
            //door offset bongos 
            const DOOR_PLACE_OFFSET = { x: -50, y: -598 }; // optional nudge from the click point

            function createDefaultDoorPlacements() {
                const size = getDoorWorldSize(DOOR_DEFAULT_SCALE);
                const centerX = Math.max(0, (WORLD_WIDTH - size.width) / 2);
                const groundY = Math.max(0, WORLD_HEIGHT - FLOOR_HEIGHT - size.height);
                return [
                    {
                        id: 'door-main',
                        x: centerX + DOOR_PLACE_OFFSET.x,
                        y: groundY + DOOR_PLACE_OFFSET.y,
                        scale: DOOR_DEFAULT_SCALE
                    }
                ];
            }

            function createDoorInstance(config, index = 0) {
                if (!gameBoardElement || !spine?.SpinePlayer || !hasManagedSpinePlayerCapacity()) return null;
                const { width, height } = getDoorWorldSize(config.scale);
                const door = {
                    id: config.id || `door-${index}`,
                    x: Number.isFinite(config.x) ? config.x : 0,
                    y: Number.isFinite(config.y) ? config.y : 0,
                    width,
                    height,
                    scale: Number.isFinite(config.scale) ? config.scale : DOOR_DEFAULT_SCALE,
                    container: null,
                    spinePlayer: null,
                    ready: false,
                    state: 'idle'
                };
                const maxX = Math.max(0, WORLD_WIDTH - door.width);
                const maxY = Math.max(0, WORLD_HEIGHT - door.height); // allow vertical offsets; clamp to world bounds
                door.x = Math.max(0, Math.min(door.x, maxX));
                door.y = Math.max(0, Math.min(door.y, maxY));

                const container = document.createElement('div');
                container.className = 'door-container';
                container.dataset.doorId = door.id;
                container.style.position = 'absolute';
                container.style.pointerEvents = 'none';
                container.style.overflow = 'visible';
                container.style.zIndex = String(BUILD_DRAW_ORDER_DEFAULT);
                gameBoardElement.appendChild(container);
                door.container = container;

                let doorPlayer = null;
                try {
                    doorPlayer = new spine.SpinePlayer(container, {
                        skeleton: DOOR_ASSET_PATHS.json,
                        atlasUrl: DOOR_ASSET_PATHS.atlas,
                        showControls: false,
                        alpha: true,
                        backgroundAlpha: 0,
                        fitToCanvas: true,
                        animation: DOOR_IDLE_ANIMATION,
                        loop: true,
                        success: (instance) => {
                            if (!door.container?.isConnected) {
                                const canvases = getSpinePlayerCanvases(container);
                                instance.dispose?.();
                                forceLoseSpinePlayerContexts(canvases, `discarded door "${door.id}"`);
                                return;
                            }
                            door.spinePlayer = instance;
                            door.ready = true;
                            playDoorIdle(door);
                            const data = instance.animationState?.data;
                            if (data?.setMix) {
                                data.setMix(DOOR_IDLE_ANIMATION, DOOR_OPEN_ANIMATION, 0.05);
                                data.setMix(DOOR_OPEN_ANIMATION, DOOR_IDLE_ANIMATION, 0.12);
                                data.setMix(DOOR_IDLE_ANIMATION, DOOR_SECONDARY_ANIMATIONS.begin, 0.05);
                                data.setMix(DOOR_SECONDARY_ANIMATIONS.begin, DOOR_SECONDARY_ANIMATIONS.cycle, 0.05);
                                data.setMix(DOOR_SECONDARY_ANIMATIONS.cycle, DOOR_SECONDARY_ANIMATIONS.end, 0.08);
                                data.setMix(DOOR_SECONDARY_ANIMATIONS.end, DOOR_IDLE_ANIMATION, 0.12);
                            }
                        },
                        error: (err) => {
                            console.error('Door spine error:', err);
                        }
                    });
                } catch (error) {
                    const canvases = getSpinePlayerCanvases(container);
                    forceLoseSpinePlayerContexts(canvases, `failed door "${door.id}"`);
                    if (container.parentNode) container.parentNode.removeChild(container);
                    console.error(`Door "${door.id}" could not be created:`, error);
                    return null;
                }
                door.spinePlayer = doorPlayer;

                return door;
            }

            function playDoorIdle(door) {
                const state = door?.spinePlayer?.animationState;
                const skeletonData = door?.spinePlayer?.skeleton?.data;
                if (!state || !skeletonData?.findAnimation(DOOR_IDLE_ANIMATION)) return;
                state.setAnimation(0, DOOR_IDLE_ANIMATION, true);
                door.state = 'idle';
            }

            function clearDoorInstances() {
                doors.forEach((door) => {
                    const canvases = getSpinePlayerCanvases(door.container);
                    try { door.spinePlayer?.dispose?.(); } catch (err) { /* noop dispose failures */ }
                    forceLoseSpinePlayerContexts(canvases, `door "${door.id}"`);
                    if (door.container?.parentNode) door.container.parentNode.removeChild(door.container);
                });
                doors = [];
            }

            function clearAllDoors() {
                doorPlacements = [];
                clearDoorInstances();
                saveDoorsForCurrentBackground();
                doorPromptDoor = null;
                if (sitPromptElement) sitPromptElement.style.display = 'none';
            }

            function rebuildDoorsFromPlacements() {
                clearDoorInstances();
                if (!doorPlacements.length) return;
                doorPlacements.forEach((cfg, index) => {
                    const door = createDoorInstance({ ...cfg, id: cfg.id || `door-${index}` }, index);
                    if (door) doors.push(door);
                });
                refreshDoorLayout();
            }

            function ensureDoorsInitialized() {
                if (!doorPlacements.length) {
                    doorPlacements = createDefaultDoorPlacements();
                    saveDoorsForCurrentBackground();
                }
                rebuildDoorsFromPlacements();
            }

            function refreshDoorLayout() {
                if (!doors.length) return;
                doors.forEach((door) => {
                    const size = getDoorWorldSize(door.scale);
                    door.width = size.width;
                    door.height = size.height;
                    const maxX = Math.max(0, WORLD_WIDTH - door.width);
                    const maxY = Math.max(0, WORLD_HEIGHT - door.height);
                    if (!Number.isFinite(door.x)) door.x = 0;
                    if (!Number.isFinite(door.y)) door.y = maxY;
                    door.x = Math.max(0, Math.min(door.x, maxX));
                    door.y = Math.max(0, Math.min(door.y, maxY));
                });
                updateDoorContainers();
            }

            function updateDoorContainers() {
                if (!doors.length) return;
                const zoomScale = zoomLevel;
                doors.forEach((door) => {
                    if (!door?.container) return;
                    const screenLeft = (door.x - camera.x) * zoomScale;
                    const screenTop = (door.y - camera.y) * zoomScale;
                    door.container.style.left = `${screenLeft}px`;
                    door.container.style.top = `${screenTop}px`;
                    door.container.style.width = `${door.width * zoomScale}px`;
                    door.container.style.height = `${door.height * zoomScale}px`;
                    updateSpineRenderSurface(door.container, door.width, door.height);
                });
            }

            function getBalloonSkeletonBounds(targetBalloon) {
                const skeletonData = targetBalloon?.spinePlayer?.skeleton?.data;
                const hasRuntimeBounds = skeletonData
                    && Number.isFinite(skeletonData.x)
                    && Number.isFinite(skeletonData.y)
                    && Number.isFinite(skeletonData.width)
                    && skeletonData.width > 0
                    && Number.isFinite(skeletonData.height)
                    && skeletonData.height > 0;
                return hasRuntimeBounds
                    ? {
                        x: skeletonData.x,
                        y: skeletonData.y,
                        width: skeletonData.width,
                        height: skeletonData.height
                    }
                    : BALLOON_SKELETON_BOUNDS;
            }

            function getBalloonWorldSize(targetBalloon) {
                const bounds = targetBalloon?.renderBounds || getBalloonSkeletonBounds(targetBalloon);
                return {
                    width: bounds.width * BALLOON_DEFAULT_SCALE,
                    height: bounds.height * BALLOON_DEFAULT_SCALE
                };
            }

            function configureBalloonViewport(targetBalloon, instance) {
                if (!targetBalloon || !instance?.calculateAnimationViewport) return;
                const animationNames = [
                    targetBalloon.idleAnimation,
                    ...Object.values(targetBalloon.windAnimations)
                ];
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;

                animationNames.forEach((animationName) => {
                    const animation = instance.skeleton?.data?.findAnimation?.(animationName);
                    if (!animation) return;
                    const animationBounds = {};
                    instance.calculateAnimationViewport(animation, animationBounds);
                    if (!Number.isFinite(animationBounds.x)
                        || !Number.isFinite(animationBounds.y)
                        || !Number.isFinite(animationBounds.width)
                        || !Number.isFinite(animationBounds.height)
                        || animationBounds.width <= 0
                        || animationBounds.height <= 0) return;
                    minX = Math.min(minX, animationBounds.x);
                    minY = Math.min(minY, animationBounds.y);
                    maxX = Math.max(maxX, animationBounds.x + animationBounds.width);
                    maxY = Math.max(maxY, animationBounds.y + animationBounds.height);
                });

                if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
                    return;
                }
                const contentWidth = maxX - minX;
                const contentHeight = maxY - minY;
                const padX = contentWidth * BALLOON_VIEWPORT_PADDING_RATIO;
                const padY = contentHeight * BALLOON_VIEWPORT_PADDING_RATIO;
                targetBalloon.renderBounds = {
                    x: minX - padX,
                    y: minY - padY,
                    width: contentWidth + padX * 2,
                    height: contentHeight + padY * 2
                };
                Object.assign(instance.config.viewport, {
                    ...targetBalloon.renderBounds,
                    padLeft: 0,
                    padRight: 0,
                    padTop: 0,
                    padBottom: 0,
                    transitionTime: 0
                });
                instance.skeleton.setToSetupPose();
            }

            function layoutBalloonInWorld(targetBalloon) {
                if (!targetBalloon) return;
                const size = getBalloonWorldSize(targetBalloon);
                const groundY = Math.max(0, WORLD_HEIGHT - FLOOR_HEIGHT);
                targetBalloon.width = size.width;
                targetBalloon.height = size.height;
                const rootCanvasPosition = getBalloonBoneCanvasPosition(targetBalloon, targetBalloon.rootBone);
                const rootOffsetX = rootCanvasPosition
                    ? rootCanvasPosition.x * targetBalloon.width
                    : targetBalloon.width * 0.5;
                const rootOffsetY = rootCanvasPosition
                    ? rootCanvasPosition.y * targetBalloon.height
                    : targetBalloon.height;
                const placement = balloonPlacements[targetBalloon.id];
                targetBalloon.drawOrder = normalizeBuildDrawOrder(
                    placement?.drawOrder ?? targetBalloon.drawOrder,
                    BUILD_DRAW_ORDER_DEFAULT
                );
                const targetRootX = placement?.rootX
                    ?? (WORLD_WIDTH * 0.5 + targetBalloon.startOffsetX);
                const targetRootY = placement?.rootY ?? groundY;
                targetBalloon.x = Math.max(0, Math.min(
                    WORLD_WIDTH - targetBalloon.width,
                    targetRootX - rootOffsetX
                ));
                targetBalloon.y = Math.max(0, Math.min(
                    WORLD_HEIGHT - targetBalloon.height,
                    targetRootY - rootOffsetY
                ));
                targetBalloon.proximityLatched = false;
                updateBalloonContainer(targetBalloon);
            }

            function layoutBalloonsInWorld() {
                balloons.forEach(layoutBalloonInWorld);
            }

            function createBalloon(variant) {
                if (!variant || balloons.some((item) => item.id === variant.id) || !gameBoardElement || !spine?.SpinePlayer) return;
                const size = getBalloonWorldSize(null);
                const container = document.createElement('div');
                container.className = 'balloon-container';
                container.dataset.balloonVariant = variant.id;
                Object.assign(container.style, {
                    position: 'absolute',
                    pointerEvents: 'none',
                    overflow: 'visible',
                    zIndex: '1'
                });
                gameBoardElement.appendChild(container);

                const targetBalloon = {
                    ...variant,
                    x: 0,
                    y: 0,
                    width: size.width,
                    height: size.height,
                    drawOrder: BUILD_DRAW_ORDER_DEFAULT,
                    container,
                    spinePlayer: null,
                    rootBone: null,
                    hitBone: null,
                    renderBounds: null,
                    ready: false,
                    proximityLatched: false,
                    cooldown: 0,
                    currentWind: ''
                };
                balloons.push(targetBalloon);
                layoutBalloonInWorld(targetBalloon);

                new spine.SpinePlayer(container, {
                    skeleton: BALLOON_ASSET_PATHS.json,
                    atlasUrl: BALLOON_ASSET_PATHS.atlas,
                    showControls: false,
                    alpha: true,
                    backgroundAlpha: 0,
                    fitToCanvas: true,
                    defaultMix: targetBalloon.allowMixing ? 0.25 : 0,
                    animation: targetBalloon.idleAnimation,
                    loop: true,
                    success: (instance) => {
                        if (!balloons.includes(targetBalloon)) return;
                        const rootBone = instance.skeleton?.findBone?.('root');
                        const hitBone = instance.skeleton?.findBone?.(BALLOON_HIT_BONE_NAME);
                        const idleAnimation = instance.skeleton?.data?.findAnimation?.(targetBalloon.idleAnimation);
                        if (!rootBone) {
                            console.error(`Balloon "${targetBalloon.id}" spine root bone was not found.`);
                            return;
                        }
                        if (!hitBone) {
                            console.error(`Balloon "${targetBalloon.id}" spine bone "${BALLOON_HIT_BONE_NAME}" was not found.`);
                            return;
                        }
                        if (!idleAnimation) {
                            console.error(`Balloon "${targetBalloon.id}" spine animation "${targetBalloon.idleAnimation}" was not found.`);
                            return;
                        }
                        const missingWindAnimation = Object.values(targetBalloon.windAnimations)
                            .find((name) => !instance.skeleton?.data?.findAnimation?.(name));
                        if (missingWindAnimation) {
                            console.error(`Balloon "${targetBalloon.id}" spine animation "${missingWindAnimation}" was not found.`);
                            return;
                        }
                        targetBalloon.spinePlayer = instance;
                        targetBalloon.rootBone = rootBone;
                        targetBalloon.hitBone = hitBone;
                        targetBalloon.ready = true;
                        configureBalloonViewport(targetBalloon, instance);
                        if (!targetBalloon.allowMixing && instance.animationState?.data) {
                            instance.animationState.data.defaultMix = 0;
                        }
                        instance.setAnimation(targetBalloon.idleAnimation, true);
                        layoutBalloonInWorld(targetBalloon);
                    },
                    error: (instance, error) => {
                        console.error(`Balloon "${targetBalloon.id}" spine error:`, error || instance);
                    }
                });
            }

            function createBalloons() {
                BALLOON_VARIANTS.forEach(createBalloon);
            }

            function updateBalloonContainer(targetBalloon) {
                if (!targetBalloon?.container) return;
                const zoomScale = zoomLevel;
                targetBalloon.container.style.left = `${(targetBalloon.x - camera.x) * zoomScale}px`;
                targetBalloon.container.style.top = `${(targetBalloon.y - camera.y) * zoomScale}px`;
                targetBalloon.container.style.width = `${targetBalloon.width * zoomScale}px`;
                targetBalloon.container.style.height = `${targetBalloon.height * zoomScale}px`;
                applyBuildDrawOrder(targetBalloon);
                updateSpineRenderSurface(targetBalloon.container, targetBalloon.width, targetBalloon.height);
            }

            function updateBalloonContainers() {
                balloons.forEach(updateBalloonContainer);
            }

            function findBalloonAtPoint(worldX, worldY) {
                for (let index = balloons.length - 1; index >= 0; index -= 1) {
                    const targetBalloon = balloons[index];
                    if (targetBalloon.ready
                        && worldX >= targetBalloon.x
                        && worldX <= targetBalloon.x + targetBalloon.width
                        && worldY >= targetBalloon.y
                        && worldY <= targetBalloon.y + targetBalloon.height) {
                        return targetBalloon;
                    }
                }
                return null;
            }

            function beginBalloonDrag(event, worldX, worldY) {
                const targetBalloon = buildModeEnabled ? findBalloonAtPoint(worldX, worldY) : null;
                if (!targetBalloon) return false;
                setSelectedTextBox(null);
                setSelectedPlacedSpineProp(null);
                setSelectedBuildLayerItem('balloon', targetBalloon);
                balloonDragState.active = true;
                balloonDragState.pointerId = event.pointerId;
                balloonDragState.balloon = targetBalloon;
                balloonDragState.offsetX = worldX - targetBalloon.x;
                balloonDragState.offsetY = worldY - targetBalloon.y;
                gameBoardElement.style.cursor = 'grabbing';
                try { gameBoardElement.setPointerCapture?.(event.pointerId); } catch (err) { /* pointer capture is optional */ }
                return true;
            }

            function updateBalloonDrag(worldX, worldY) {
                const targetBalloon = balloonDragState.balloon;
                if (!balloonDragState.active || !targetBalloon) return;
                targetBalloon.x = Math.max(0, Math.min(
                    WORLD_WIDTH - targetBalloon.width,
                    worldX - balloonDragState.offsetX
                ));
                targetBalloon.y = Math.max(0, Math.min(
                    WORLD_HEIGHT - targetBalloon.height,
                    worldY - balloonDragState.offsetY
                ));
                targetBalloon.proximityLatched = false;
                updateBalloonContainer(targetBalloon);
            }

            function endBalloonDrag(event = null) {
                if (!balloonDragState.active) return;
                const pointerId = balloonDragState.pointerId;
                const targetBalloon = balloonDragState.balloon;
                balloonDragState.active = false;
                balloonDragState.pointerId = null;
                balloonDragState.balloon = null;
                gameBoardElement.style.cursor = '';
                if (event && pointerId !== null) {
                    try { gameBoardElement.releasePointerCapture?.(pointerId); } catch (err) { /* pointer capture is optional */ }
                }
                saveBalloonForCurrentBackground(targetBalloon);
            }

            function getBalloonBoneCanvasPosition(targetBalloon, bone) {
                if (!targetBalloon?.spinePlayer || !bone) return null;
                const viewport = targetBalloon.spinePlayer?.currentViewport;
                const hasRuntimeViewport = viewport
                    && Number.isFinite(viewport.x)
                    && Number.isFinite(viewport.y)
                    && Number.isFinite(viewport.width)
                    && Number.isFinite(viewport.height);
                const bounds = hasRuntimeViewport
                    ? {
                        x: viewport.x - (Number(viewport.padLeft) || 0),
                        y: viewport.y - (Number(viewport.padBottom) || 0),
                        width: viewport.width + (Number(viewport.padLeft) || 0) + (Number(viewport.padRight) || 0),
                        height: viewport.height + (Number(viewport.padBottom) || 0) + (Number(viewport.padTop) || 0)
                    }
                    : getBalloonSkeletonBounds(targetBalloon);
                const normalizedX = (bone.worldX - bounds.x) / bounds.width;
                const normalizedY = 1 - ((bone.worldY - bounds.y) / bounds.height);
                if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;
                return { x: normalizedX, y: normalizedY };
            }

            function getBalloonBoneWorldPosition(targetBalloon, bone) {
                if (!targetBalloon?.ready || !bone) return null;
                const canvasPosition = getBalloonBoneCanvasPosition(targetBalloon, bone);
                if (!canvasPosition) return null;
                return {
                    x: targetBalloon.x + canvasPosition.x * targetBalloon.width,
                    y: targetBalloon.y + canvasPosition.y * targetBalloon.height
                };
            }

            function getBalloonHitBoneWorldPosition(targetBalloon) {
                return getBalloonBoneWorldPosition(targetBalloon, targetBalloon?.hitBone);
            }

            function playBalloonWind(targetBalloon, direction) {
                if (!targetBalloon?.ready) return;
                const animationName = targetBalloon.windAnimations[direction];
                const state = targetBalloon.spinePlayer?.animationState;
                const skeletonData = targetBalloon.spinePlayer?.skeleton?.data;
                if (!animationName || !state || !skeletonData?.findAnimation(animationName)) return;
                if (targetBalloon.allowMixing) {
                    state.setAnimation(1, animationName, false);
                    state.addEmptyAnimation(1, BALLOON_WIND_MIX_OUT, 0);
                } else {
                    state.clearTrack(1);
                    state.clearTrack(0);
                    const windEntry = state.setAnimation(0, animationName, false);
                    windEntry.mixDuration = 0;
                    windEntry.alpha = 1;
                    windEntry.listener = {
                        complete: () => {
                            if (state.getCurrent(0) !== windEntry) return;
                            state.clearTrack(0);
                            const idleEntry = state.setAnimation(0, targetBalloon.idleAnimation, true);
                            idleEntry.mixDuration = 0;
                            idleEntry.alpha = 1;
                            targetBalloon.currentWind = '';
                        }
                    };
                }
                targetBalloon.currentWind = animationName;
                targetBalloon.cooldown = BALLOON_RETRIGGER_COOLDOWN;
            }

            function updateBalloon(targetBalloon, dt) {
                if (!targetBalloon?.ready) return;
                targetBalloon.cooldown = Math.max(0, targetBalloon.cooldown - dt);
                const hitPoint = getBalloonHitBoneWorldPosition(targetBalloon);
                if (!hitPoint) return;

                const playerCenterX = player.x + player.width * 0.5;
                const playerCenterY = player.y + player.height * 0.5;
                const normalizedDx = (playerCenterX - hitPoint.x) / BALLOON_TRIGGER_RADIUS.x;
                const normalizedDy = (playerCenterY - hitPoint.y) / BALLOON_TRIGGER_RADIUS.y;
                const isNearHitBone = normalizedDx * normalizedDx + normalizedDy * normalizedDy <= 1;

                if (isNearHitBone && !targetBalloon.proximityLatched && !player.onGround && targetBalloon.cooldown <= 0) {
                    if (player.vx > BALLOON_MIN_HORIZONTAL_SPEED) {
                        playBalloonWind(targetBalloon, 'right');
                    } else if (player.vx < -BALLOON_MIN_HORIZONTAL_SPEED) {
                        playBalloonWind(targetBalloon, 'left');
                    }
                }
                targetBalloon.proximityLatched = isNearHitBone;
            }

            function updateBalloons(dt) {
                balloons.forEach((targetBalloon) => updateBalloon(targetBalloon, dt));
            }

            function drawBalloonDebug(context, targetBalloon) {
                if ((!DEBUG_DRAW && !buildModeEnabled) || !targetBalloon?.ready) return;
                const hitPoint = getBalloonHitBoneWorldPosition(targetBalloon);
                const rootPoint = getBalloonBoneWorldPosition(targetBalloon, targetBalloon.rootBone);
                if (!hitPoint || !rootPoint) return;
                context.save();
                context.lineWidth = Math.max(1, 2 / zoomLevel);
                if (buildModeEnabled) {
                    context.strokeStyle = selectedBuildLayerItem?.target === targetBalloon ? '#ffd54f' : '#66ccff';
                    context.fillStyle = context.strokeStyle;
                    context.setLineDash([12 / zoomLevel, 8 / zoomLevel]);
                    context.strokeRect(targetBalloon.x, targetBalloon.y, targetBalloon.width, targetBalloon.height);
                    context.setLineDash([]);
                    context.beginPath();
                    context.arc(rootPoint.x, rootPoint.y, 9 / zoomLevel, 0, Math.PI * 2);
                    context.fill();
                    context.font = `${18 / zoomLevel}px monospace`;
                    context.textAlign = 'center';
                    context.textBaseline = 'bottom';
                    context.fillText(
                        'Standard balloons',
                        targetBalloon.x + targetBalloon.width * 0.5,
                        targetBalloon.y - 6 / zoomLevel
                    );
                }
                if (DEBUG_DRAW) {
                    context.strokeStyle = '#ff4fd8';
                    context.fillStyle = '#ff4fd8';
                    context.beginPath();
                    context.ellipse(
                        hitPoint.x,
                        hitPoint.y,
                        BALLOON_TRIGGER_RADIUS.x,
                        BALLOON_TRIGGER_RADIUS.y,
                        0,
                        0,
                        Math.PI * 2
                    );
                    context.stroke();
                    context.beginPath();
                    context.arc(hitPoint.x, hitPoint.y, 8 / zoomLevel, 0, Math.PI * 2);
                    context.fill();
                }
                context.restore();
            }

            function drawBalloonsDebug(context) {
                balloons.forEach((targetBalloon) => drawBalloonDebug(context, targetBalloon));
            }

            function getMoneyTreeSkeletonBounds(targetTree = moneyTree) {
                const skeletonData = targetTree?.spinePlayer?.skeleton?.data;
                const hasRuntimeBounds = skeletonData
                    && Number.isFinite(skeletonData.x)
                    && Number.isFinite(skeletonData.y)
                    && skeletonData.width > 0
                    && Number.isFinite(skeletonData.width)
                    && Number.isFinite(skeletonData.height)
                    && skeletonData.height > 0;
                return hasRuntimeBounds
                    ? {
                        x: skeletonData.x,
                        y: skeletonData.y,
                        width: skeletonData.width,
                        height: skeletonData.height
                    }
                    : MONEY_TREE_SKELETON_BOUNDS;
            }

            function getMoneyTreeWorldSize(targetTree = moneyTree) {
                const bounds = targetTree?.renderBounds || getMoneyTreeSkeletonBounds(targetTree);
                return {
                    width: bounds.width * MONEY_TREE_DEFAULT_SCALE,
                    height: bounds.height * MONEY_TREE_DEFAULT_SCALE
                };
            }

            function configureMoneyTreeViewport(targetTree, instance) {
                if (!targetTree || !instance?.calculateAnimationViewport) return;
                const animationNames = [MONEY_TREE_IDLE_ANIMATION, ...MONEY_TREE_TAP_ANIMATIONS];
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;

                animationNames.forEach((animationName) => {
                    const animation = instance.skeleton?.data?.findAnimation?.(animationName);
                    if (!animation) return;
                    const animationBounds = {};
                    instance.calculateAnimationViewport(animation, animationBounds);
                    if (!Number.isFinite(animationBounds.x)
                        || !Number.isFinite(animationBounds.y)
                        || !Number.isFinite(animationBounds.width)
                        || !Number.isFinite(animationBounds.height)
                        || animationBounds.width <= 0
                        || animationBounds.height <= 0) return;
                    minX = Math.min(minX, animationBounds.x);
                    minY = Math.min(minY, animationBounds.y);
                    maxX = Math.max(maxX, animationBounds.x + animationBounds.width);
                    maxY = Math.max(maxY, animationBounds.y + animationBounds.height);
                });

                if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
                    return;
                }
                const contentWidth = maxX - minX;
                const contentHeight = maxY - minY;
                const padX = contentWidth * MONEY_TREE_VIEWPORT_PADDING_RATIO;
                const padY = contentHeight * MONEY_TREE_VIEWPORT_PADDING_RATIO;
                targetTree.renderBounds = {
                    x: minX - padX,
                    y: minY - padY,
                    width: contentWidth + padX * 2,
                    height: contentHeight + padY * 2
                };
                instance.config.viewport = instance.config.viewport || {};
                Object.assign(instance.config.viewport, {
                    ...targetTree.renderBounds,
                    padLeft: 0,
                    padRight: 0,
                    padTop: 0,
                    padBottom: 0,
                    transitionTime: 0
                });
                instance.skeleton.setToSetupPose();
            }

            function getMoneyTreeBoneCanvasPosition(bone, targetTree = moneyTree) {
                if (!targetTree?.spinePlayer || !bone) return null;
                const viewport = targetTree.spinePlayer?.currentViewport;
                const hasRuntimeViewport = viewport
                    && Number.isFinite(viewport.x)
                    && Number.isFinite(viewport.y)
                    && Number.isFinite(viewport.width)
                    && Number.isFinite(viewport.height);
                const bounds = hasRuntimeViewport
                    ? {
                        x: viewport.x - (Number(viewport.padLeft) || 0),
                        y: viewport.y - (Number(viewport.padBottom) || 0),
                        width: viewport.width + (Number(viewport.padLeft) || 0) + (Number(viewport.padRight) || 0),
                        height: viewport.height + (Number(viewport.padBottom) || 0) + (Number(viewport.padTop) || 0)
                    }
                    : getMoneyTreeSkeletonBounds(targetTree);
                const normalizedX = (bone.worldX - bounds.x) / bounds.width;
                const normalizedY = 1 - ((bone.worldY - bounds.y) / bounds.height);
                if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;
                return { x: normalizedX, y: normalizedY };
            }

            function getMoneyTreeBoneWorldPosition(bone, targetTree = moneyTree) {
                if (!targetTree?.ready || !bone) return null;
                const canvasPosition = getMoneyTreeBoneCanvasPosition(bone, targetTree);
                if (!canvasPosition) return null;
                return {
                    x: targetTree.x + canvasPosition.x * targetTree.width,
                    y: targetTree.y + canvasPosition.y * targetTree.height
                };
            }

            function layoutMoneyTreeInWorld() {
                if (!moneyTree) return;
                const size = getMoneyTreeWorldSize(moneyTree);
                const groundY = Math.max(0, WORLD_HEIGHT - FLOOR_HEIGHT);
                moneyTree.width = size.width;
                moneyTree.height = size.height;
                const rootCanvasPosition = getMoneyTreeBoneCanvasPosition(moneyTree.rootBone, moneyTree);
                const rootOffsetX = rootCanvasPosition
                    ? rootCanvasPosition.x * moneyTree.width
                    : moneyTree.width * 0.5;
                const rootOffsetY = rootCanvasPosition
                    ? rootCanvasPosition.y * moneyTree.height
                    : moneyTree.height;
                const targetRootX = moneyTreePlacement?.rootX
                    ?? (WORLD_WIDTH * 0.5 + MONEY_TREE_DEFAULT_OFFSET_X);
                const targetRootY = moneyTreePlacement?.rootY ?? groundY;
                moneyTree.x = Math.max(0, Math.min(
                    WORLD_WIDTH - moneyTree.width,
                    targetRootX - rootOffsetX
                ));
                moneyTree.y = Math.max(0, Math.min(
                    WORLD_HEIGHT - moneyTree.height,
                    targetRootY - rootOffsetY
                ));
                moneyTree.drawOrder = normalizeBuildDrawOrder(
                    moneyTreePlacement?.drawOrder ?? moneyTree.drawOrder,
                    BUILD_DRAW_ORDER_DEFAULT
                );
                updateMoneyTreeContainer();
            }

            function updateMoneyTreeContainer() {
                if (!moneyTree?.container) return;
                const zoomScale = zoomLevel;
                moneyTree.container.style.left = `${(moneyTree.x - camera.x) * zoomScale}px`;
                moneyTree.container.style.top = `${(moneyTree.y - camera.y) * zoomScale}px`;
                moneyTree.container.style.width = `${moneyTree.width * zoomScale}px`;
                moneyTree.container.style.height = `${moneyTree.height * zoomScale}px`;
                applyBuildDrawOrder(moneyTree);
                updateSpineRenderSurface(moneyTree.container, moneyTree.width, moneyTree.height);
            }

            function createMoneyTree() {
                if (moneyTree || !gameBoardElement || !spine?.SpinePlayer) return;
                const size = getMoneyTreeWorldSize(null);
                const container = document.createElement('div');
                container.className = 'money-tree-container';
                Object.assign(container.style, {
                    position: 'absolute',
                    pointerEvents: 'none',
                    overflow: 'visible',
                    zIndex: '1'
                });
                gameBoardElement.appendChild(container);

                moneyTree = {
                    x: 0,
                    y: 0,
                    width: size.width,
                    height: size.height,
                    drawOrder: BUILD_DRAW_ORDER_DEFAULT,
                    container,
                    spinePlayer: null,
                    rootBone: null,
                    renderBounds: null,
                    ready: false,
                    lastTapAnimation: ''
                };
                layoutMoneyTreeInWorld();

                new spine.SpinePlayer(container, {
                    skeleton: MONEY_TREE_ASSET_PATHS.json,
                    atlasUrl: MONEY_TREE_ASSET_PATHS.atlas,
                    showControls: false,
                    alpha: true,
                    backgroundAlpha: 0,
                    fitToCanvas: true,
                    defaultMix: 0.08,
                    animation: MONEY_TREE_IDLE_ANIMATION,
                    loop: true,
                    success: (instance) => {
                        if (!moneyTree || moneyTree.container !== container) return;
                        const rootBone = instance.skeleton?.findBone?.('root');
                        const skeletonData = instance.skeleton?.data;
                        if (!rootBone) {
                            console.error('Money tree spine root bone was not found.');
                            return;
                        }
                        if (!skeletonData?.findAnimation?.(MONEY_TREE_IDLE_ANIMATION)) {
                            console.error(`Money tree spine animation "${MONEY_TREE_IDLE_ANIMATION}" was not found.`);
                            return;
                        }
                        const missingTapAnimation = MONEY_TREE_TAP_ANIMATIONS
                            .find((name) => !skeletonData.findAnimation?.(name));
                        if (missingTapAnimation) {
                            console.error(`Money tree spine animation "${missingTapAnimation}" was not found.`);
                            return;
                        }
                        moneyTree.spinePlayer = instance;
                        moneyTree.rootBone = rootBone;
                        moneyTree.ready = true;
                        configureMoneyTreeViewport(moneyTree, instance);
                        const data = instance.animationState?.data;
                        if (data?.setMix) {
                            MONEY_TREE_TAP_ANIMATIONS.forEach((animationName) => {
                                data.setMix(MONEY_TREE_IDLE_ANIMATION, animationName, 0.04);
                                data.setMix(animationName, MONEY_TREE_IDLE_ANIMATION, MONEY_TREE_TAP_MIX_OUT);
                            });
                        }
                        instance.setAnimation(MONEY_TREE_IDLE_ANIMATION, true);
                        layoutMoneyTreeInWorld();
                    },
                    error: (instance, error) => {
                        console.error('Money tree spine error:', error || instance);
                    }
                });
            }

            function findMoneyTreeAtPoint(worldX, worldY) {
                if (!moneyTree?.ready) return null;
                return worldX >= moneyTree.x
                    && worldX <= moneyTree.x + moneyTree.width
                    && worldY >= moneyTree.y
                    && worldY <= moneyTree.y + moneyTree.height
                    ? moneyTree
                    : null;
            }

            function chooseMoneyTreeTapAnimation() {
                const skeletonData = moneyTree?.spinePlayer?.skeleton?.data;
                const availableAnimations = MONEY_TREE_TAP_ANIMATIONS
                    .filter((animationName) => skeletonData?.findAnimation?.(animationName));
                if (!availableAnimations.length) return '';
                if (availableAnimations.length === 1) return availableAnimations[0];
                const choices = availableAnimations.filter((name) => name !== moneyTree.lastTapAnimation);
                return choices[Math.floor(Math.random() * choices.length)];
            }

            function playMoneyTreeTap() {
                if (!moneyTree?.ready) return false;
                const state = moneyTree.spinePlayer?.animationState;
                const skeletonData = moneyTree.spinePlayer?.skeleton?.data;
                if (!state || !skeletonData?.findAnimation?.(MONEY_TREE_IDLE_ANIMATION)) return false;
                const animationName = chooseMoneyTreeTapAnimation();
                if (!animationName) return false;
                const tapEntry = state.setAnimation(0, animationName, false);
                if (!tapEntry) return false;
                tapEntry.mixDuration = 0.04;
                moneyTree.lastTapAnimation = animationName;
                const idleEntry = state.addAnimation(0, MONEY_TREE_IDLE_ANIMATION, true, 0);
                if (idleEntry) idleEntry.mixDuration = MONEY_TREE_TAP_MIX_OUT;
                return true;
            }

            function playMoneyTreeTapAtPoint(worldX, worldY) {
                if (!findMoneyTreeAtPoint(worldX, worldY)) return false;
                return playMoneyTreeTap();
            }

            function beginMoneyTreeDrag(event, worldX, worldY) {
                const targetTree = buildModeEnabled ? findMoneyTreeAtPoint(worldX, worldY) : null;
                if (!targetTree) return false;
                setSelectedTextBox(null);
                setSelectedPlacedSpineProp(null);
                setSelectedBuildLayerItem('money-tree', targetTree);
                moneyTreeDragState.active = true;
                moneyTreeDragState.pointerId = event.pointerId;
                moneyTreeDragState.offsetX = worldX - targetTree.x;
                moneyTreeDragState.offsetY = worldY - targetTree.y;
                gameBoardElement.style.cursor = 'grabbing';
                try { gameBoardElement.setPointerCapture?.(event.pointerId); } catch (err) { /* pointer capture is optional */ }
                return true;
            }

            function updateMoneyTreeDrag(worldX, worldY) {
                if (!moneyTreeDragState.active || !moneyTree) return;
                moneyTree.x = Math.max(0, Math.min(
                    WORLD_WIDTH - moneyTree.width,
                    worldX - moneyTreeDragState.offsetX
                ));
                moneyTree.y = Math.max(0, Math.min(
                    WORLD_HEIGHT - moneyTree.height,
                    worldY - moneyTreeDragState.offsetY
                ));
                updateMoneyTreeContainer();
            }

            function endMoneyTreeDrag(event = null) {
                if (!moneyTreeDragState.active) return;
                const pointerId = moneyTreeDragState.pointerId;
                moneyTreeDragState.active = false;
                moneyTreeDragState.pointerId = null;
                gameBoardElement.style.cursor = '';
                if (event && pointerId !== null) {
                    try { gameBoardElement.releasePointerCapture?.(pointerId); } catch (err) { /* pointer capture is optional */ }
                }
                saveMoneyTreeForCurrentBackground();
            }

            function drawMoneyTreeDebug(context) {
                if (!buildModeEnabled || !moneyTree?.ready) return;
                const rootPoint = getMoneyTreeBoneWorldPosition(moneyTree.rootBone);
                context.save();
                context.lineWidth = Math.max(1, 2 / zoomLevel);
                context.strokeStyle = selectedBuildLayerItem?.target === moneyTree ? '#ffd54f' : '#9fe870';
                context.fillStyle = context.strokeStyle;
                context.setLineDash([12 / zoomLevel, 8 / zoomLevel]);
                context.strokeRect(moneyTree.x, moneyTree.y, moneyTree.width, moneyTree.height);
                context.setLineDash([]);
                if (rootPoint) {
                    context.beginPath();
                    context.arc(rootPoint.x, rootPoint.y, 9 / zoomLevel, 0, Math.PI * 2);
                    context.fill();
                }
                context.font = `${18 / zoomLevel}px monospace`;
                context.textAlign = 'center';
                context.textBaseline = 'bottom';
                context.fillText('Money tree', moneyTree.x + moneyTree.width * 0.5, moneyTree.y - 6 / zoomLevel);
                context.restore();
            }

            function getPlacedSpinePropWorldSize(type, scaleOverride = null) {
                const definition = Object.prototype.hasOwnProperty.call(PLACED_SPINE_PROP_DEFS, type)
                    ? PLACED_SPINE_PROP_DEFS[type]
                    : null;
                if (!definition) return { width: 1, height: 1 };
                const scale = Number.isFinite(scaleOverride) && scaleOverride > 0
                    ? scaleOverride
                    : definition.scale;
                return {
                    width: Math.max(1, definition.bounds.width * scale),
                    height: Math.max(1, definition.bounds.height * scale)
                };
            }

            function getBuildPropDebugSnapshot() {
                return {
                    buildModeEnabled,
                    menuOpen: !!buildAddMenu && !buildAddMenu.hidden,
                    currentBackground,
                    maxPlacedSpineProps: MAX_PLACED_SPINE_PROPS,
                    maxManagedSpinePlayers: MAX_MANAGED_SPINE_PLAYERS,
                    managedSpinePlayers: getManagedSpinePlayerCount(),
                    selectedId: selectedPlacedSpineProp?.id || null,
                    selectedLayerKind: selectedBuildLayerItem?.kind || null,
                    selectedLayerOrder: selectedBuildLayerItem
                        ? normalizeBuildDrawOrder(
                            selectedBuildLayerItem.target?.drawOrder,
                            getDefaultBuildDrawOrder(selectedBuildLayerItem.kind)
                        )
                        : null,
                    balloonReady: balloons.some(item => item.ready),
                    balloonDrawOrders: Object.fromEntries(
                        balloons.map(item => [item.id, normalizeBuildDrawOrder(item.drawOrder)])
                    ),
                    player: {
                        x: player.x,
                        y: player.y,
                        vx: player.vx,
                        vy: player.vy,
                        onGround: player.onGround,
                        skeletonScaleX: spinePlayer?.skeleton?.scaleX ?? null,
                        skeletonScaleY: spinePlayer?.skeleton?.scaleY ?? null
                    },
                    floor: {
                        floorHeight: FLOOR_HEIGHT,
                        top: WORLD_HEIGHT - FLOOR_HEIGHT,
                        platformTop: basePlatforms[0]?.y ?? null,
                        blockHeight
                    },
                    props: placedSpineProps.map(prop => ({
                        id: prop.id,
                        type: prop.type,
                        animation: PLACED_SPINE_PROP_DEFS[prop.type]?.animation || '',
                        currentAnimation: prop.spinePlayer?.animationState?.getCurrent?.(0)?.animation?.name || '',
                        currentWind: prop.currentWind,
                        x: prop.x,
                        y: prop.y,
                        drawOrder: normalizeBuildDrawOrder(prop.drawOrder),
                        width: prop.width,
                        height: prop.height,
                        ready: prop.ready,
                        loadError: prop.loadError
                    }))
                };
            }

            function createPlacedSpinePropId(type) {
                placedSpinePropIdCounter += 1;
                return `${type}-${Date.now().toString(36)}-${placedSpinePropIdCounter.toString(36)}`;
            }

            function getVisibleWorldCenter() {
                return {
                    x: camera.x + CANVAS_WIDTH / (2 * zoomLevel),
                    y: camera.y + CANVAS_HEIGHT / (2 * zoomLevel)
                };
            }

            function getManagedSpinePlayerCount() {
                return (spinePlayer ? 1 : 0)
                    + doors.length
                    + balloons.length
                    + placedSpineProps.length
                    + (beaverNpcController?.getManagedPlayerCount?.() || 0)
                    + (chatBotController ? 1 : 0);
            }

            function hasManagedSpinePlayerCapacity(additionalPlayers = 1) {
                return getManagedSpinePlayerCount() + Math.max(0, additionalPlayers) <= MAX_MANAGED_SPINE_PLAYERS;
            }

            function initializeBeaverNpc() {
                if (beaverNpcController) return;
                const sharedBeaverOptions = {
                    spine,
                    gameBoardElement,
                    hasSpineCapacity: () => hasManagedSpinePlayerCapacity(),
                    getPlayerState: () => ({
                        x: player.x + player.width * 0.5,
                        y: player.y + player.height
                    }),
                    hasActivePlayerInput: () => (
                        joystickState.active
                        || ['left', 'right', 'jump', 'run', 'descend', 'chat'].some(isActionActive)
                    ),
                    onConversationChange: (active, detail = {}) => {
                        beaverConversationState.active = Boolean(active);
                        playerContainerElement.dataset.beaverConversationActive = String(beaverConversationState.active);
                        if (active) {
                            player.vx = 0;
                            player.isMoving = false;
                            player.isRunning = false;
                            player.previousMoveType = 'idle';
                            player.lastMoveType = 'idle';
                            const playerCenterX = player.x + player.width * 0.5;
                            player.facingRight = Number(detail.beaverX) < playerCenterX;
                            playerContainerElement.dataset.beaverConversationFacing = player.facingRight ? 'left' : 'right';
                            syncPlayerSkeletonScale();
                        } else {
                            stopTalkOverlay();
                        }
                    },
                    getSceneState: () => ({
                        worldWidth: WORLD_WIDTH,
                        worldHeight: WORLD_HEIGHT,
                        floorHeight: FLOOR_HEIGHT,
                        camera,
                        zoomLevel,
                        spineCanvasRenderZoom: SPINE_CANVAS_RENDER_ZOOM
                    })
                };
                const beaverControllers = [
                    createBeaverNpcController({
                        ...sharedBeaverOptions,
                        debugName: 'trunk',
                        spawnProgress: 0.08,
                        initialPhase: 'walk-carry',
                        ownsScenery: true,
                        logSlotOffset: 0,
                        movementMode: 'run'
                    }),
                    createBeaverNpcController({
                        ...sharedBeaverOptions,
                        debugName: 'middle',
                        spawnProgress: 0.5,
                        initialPhase: 'walk-empty',
                        ownsScenery: false,
                        logSlotOffset: 4,
                        movementMode: 'walk'
                    }),
                    createBeaverNpcController({
                        ...sharedBeaverOptions,
                        debugName: 'pile',
                        spawnProgress: 0.92,
                        initialPhase: 'idle-pile',
                        ownsScenery: false,
                        logSlotOffset: 8
                    })
                ];
                const getBeaverGroupSnapshot = () => {
                    const beavers = beaverControllers.map(controller => controller.getSnapshot());
                    return {
                        ready: beavers.every(snapshot => snapshot.ready),
                        phase: beavers.map(snapshot => snapshot.phase).join(', '),
                        deliveredCount: beavers.reduce((total, snapshot) => total + snapshot.deliveredCount, 0),
                        beavers
                    };
                };
                beaverNpcController = Object.freeze({
                    create: () => {
                        let created = false;
                        beaverControllers.forEach((controller) => {
                            created = controller.create() || created;
                        });
                        return created;
                    },
                    dispose: () => beaverControllers.forEach(controller => controller.dispose()),
                    draw: context => beaverControllers.forEach(controller => controller.draw(context)),
                    getManagedPlayerCount: () => beaverControllers.reduce(
                        (total, controller) => total + controller.getManagedPlayerCount(),
                        0
                    ),
                    getSnapshot: getBeaverGroupSnapshot,
                    layout: options => beaverControllers.forEach(controller => controller.layout(options)),
                    resize: () => beaverControllers.forEach(controller => controller.resize()),
                    update: dt => beaverControllers.forEach(controller => controller.update(dt))
                });
                Object.defineProperty(window, '__beaverNpcDebug', {
                    configurable: true,
                    value: Object.freeze({ getSnapshot: getBeaverGroupSnapshot })
                });
                beaverNpcController.create();
            }

            function getSpinePlayerCanvases(container) {
                return Array.from(container?.querySelectorAll('canvas') || []);
            }

            function forceLoseSpinePlayerContexts(canvases, label = 'Spine player') {
                canvases.forEach((canvas) => {
                    let gl = null;
                    for (const contextType of ['webgl2', 'webgl', 'experimental-webgl']) {
                        try { gl = canvas.getContext(contextType); } catch (error) { gl = null; }
                        if (gl) break;
                    }
                    try { gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch (error) {
                        console.warn(`Failed to release WebGL context for ${label}.`, error);
                    }
                });
            }

            function setBuildAddFeedback(message) {
                if (!buildAddNote || !message) return;
                if (!buildAddNote.dataset.defaultText) buildAddNote.dataset.defaultText = buildAddNote.textContent;
                buildAddNote.textContent = message;
                if (buildAddFeedbackTimer) clearTimeout(buildAddFeedbackTimer);
                buildAddFeedbackTimer = setTimeout(() => {
                    buildAddFeedbackTimer = 0;
                    buildAddNote.textContent = buildAddNote.dataset.defaultText || '';
                }, 3200);
            }

            function getBuildPlacementLabel(itemType) {
                if (itemType === 'balloon') return 'Balloon';
                if (itemType === 'butterfly-spawn') return 'Butterfly spawn';
                return PLACED_SPINE_PROP_DEFS[itemType]?.label || 'Object';
            }

            function showBuildPlacementStatus(message, duration = 0) {
                if (!buildPlacementStatus) return;
                if (buildPlacementStatusTimer) clearTimeout(buildPlacementStatusTimer);
                buildPlacementStatusTimer = 0;
                buildPlacementStatus.textContent = message;
                buildPlacementStatus.hidden = false;
                if (duration > 0) {
                    buildPlacementStatusTimer = setTimeout(() => {
                        buildPlacementStatusTimer = 0;
                        buildPlacementStatus.hidden = true;
                    }, duration);
                }
            }

            function clearPendingBuildPlacement(options = {}) {
                pendingBuildPlacementType = '';
                if (gameBoardElement && gameBoardElement.style.cursor === 'crosshair') {
                    gameBoardElement.style.cursor = '';
                }
                if (!options.keepStatus && buildPlacementStatus) buildPlacementStatus.hidden = true;
            }

            function beginBuildItemPlacement(itemType) {
                if (!itemType) return false;
                setPlatformPlacementMode(false);
                pendingBuildPlacementType = itemType;
                if (gameBoardElement) gameBoardElement.style.cursor = 'crosshair';
                const label = getBuildPlacementLabel(itemType);
                showBuildPlacementStatus(`Tap the world to place ${label}`);
                setBuildAddFeedback(`Tap the world to place ${label}. It will start in front of the player.`);
                return true;
            }

            function updatePlacedSpinePropContainer(prop) {
                if (!prop?.container) return;
                prop.container.style.left = `${(prop.x - camera.x) * zoomLevel}px`;
                prop.container.style.top = `${(prop.y - camera.y) * zoomLevel}px`;
                prop.container.style.width = `${prop.width * zoomLevel}px`;
                prop.container.style.height = `${prop.height * zoomLevel}px`;
                applyBuildDrawOrder(prop);
                updateSpineRenderSurface(prop.container, prop.width, prop.height);
            }

            function updatePlacedSpinePropContainers() {
                placedSpineProps.forEach(updatePlacedSpinePropContainer);
            }

            function clampPlacedSpinePropsToWorld() {
                placedSpineProps.forEach((prop) => {
                    prop.x = Math.max(0, Math.min(prop.x, Math.max(0, WORLD_WIDTH - prop.width)));
                    prop.y = Math.max(0, Math.min(prop.y, Math.max(0, WORLD_HEIGHT - prop.height)));
                    updatePlacedSpinePropContainer(prop);
                });
            }

            function createPlacedSpineProp(entry, options = {}) {
                const type = String(entry?.type || entry || '');
                const definition = Object.prototype.hasOwnProperty.call(PLACED_SPINE_PROP_DEFS, type)
                    ? PLACED_SPINE_PROP_DEFS[type]
                    : null;
                if (!definition || !gameBoardElement || !spine?.SpinePlayer) return null;
                if (placedSpineProps.length >= MAX_PLACED_SPINE_PROPS) {
                    setBuildAddFeedback(`Maximum of ${MAX_PLACED_SPINE_PROPS} fan/bush items reached. Delete one to add another.`);
                    return null;
                }
                if (!hasManagedSpinePlayerCapacity()) {
                    setBuildAddFeedback('Graphics capacity reached. Remove a fan, bush, or door before adding another animated item.');
                    return null;
                }

                const scaleValue = Number(entry?.scale);
                const scale = Number.isFinite(scaleValue) && scaleValue > 0
                    ? Math.max(0.25, Math.min(4, scaleValue))
                    : definition.scale;
                const size = getPlacedSpinePropWorldSize(type, scale);
                const fallbackOffset = placedSpineProps.length * 24;
                const requestedX = Number(entry?.x);
                const requestedY = Number(entry?.y);
                const center = Number.isFinite(requestedX) && Number.isFinite(requestedY)
                    ? null
                    : getVisibleWorldCenter();
                const x = Number.isFinite(requestedX)
                    ? requestedX
                    : center.x - size.width * 0.5 + fallbackOffset;
                const y = Number.isFinite(requestedY)
                    ? requestedY
                    : center.y - size.height * 0.5 + fallbackOffset;
                const container = document.createElement('div');
                container.className = 'placed-spine-prop-container';
                container.dataset.spinePropId = String(entry?.id || '');
                container.dataset.spinePropType = type;
                Object.assign(container.style, {
                    position: 'absolute',
                    pointerEvents: 'none',
                    overflow: 'visible',
                    zIndex: '1'
                });
                gameBoardElement.appendChild(container);

                const prop = {
                    id: String(entry?.id || createPlacedSpinePropId(type)),
                    type,
                    label: definition.label,
                    scale,
                    skinName: definition.windAnimations
                        ? String(entry?.skinName || DEFAULT_BUSH_SKIN)
                        : '',
                    drawOrder: normalizeBuildDrawOrder(entry?.drawOrder),
                    x: Math.max(0, Math.min(x, Math.max(0, WORLD_WIDTH - size.width))),
                    y: Math.max(0, Math.min(y, Math.max(0, WORLD_HEIGHT - size.height))),
                    width: size.width,
                    height: size.height,
                    container,
                    spinePlayer: null,
                    ready: false,
                    loadError: false,
                    idleAnimation: definition.animation,
                    windAnimations: definition.windAnimations || null,
                    windCooldown: 0,
                    proximityLatched: false,
                    currentWind: ''
                };
                container.dataset.spinePropId = prop.id;
                placedSpineProps.push(prop);
                setSelectedPlacedSpineProp(prop);
                updatePlacedSpinePropContainer(prop);

                let player = null;
                try {
                    player = new spine.SpinePlayer(container, {
                        skeleton: definition.skeleton,
                        atlasUrl: definition.atlas,
                        showControls: false,
                        interactive: false,
                        alpha: true,
                        backgroundAlpha: 0,
                        fitToCanvas: true,
                        defaultMix: 0,
                        animation: definition.animation,
                        loop: true,
                        viewport: {
                            ...(definition.dynamicViewport ? {} : definition.bounds),
                            padLeft: definition.viewportPadding || '5%',
                            padRight: definition.viewportPadding || '5%',
                            padTop: definition.viewportPadding || '5%',
                            padBottom: definition.viewportPadding || '5%',
                            transitionTime: 0
                        },
                        success: (instance) => {
                            if (!placedSpineProps.includes(prop)) {
                                instance.dispose?.();
                                return;
                            }
                            const requiredAnimations = [
                                definition.animation,
                                ...Object.values(definition.windAnimations || {})
                            ];
                            const missingAnimation = requiredAnimations.find(
                                animationName => !instance.skeleton?.data?.findAnimation?.(animationName)
                            );
                            if (missingAnimation) {
                                prop.loadError = true;
                                console.error(`Placed Spine prop animation "${missingAnimation}" was not found.`);
                                return;
                            }
                            prop.spinePlayer = instance;
                            prop.ready = true;
                            prop.currentWind = '';
                            instance.setAnimation(definition.animation, true);
                            if (prop.windAnimations) applyPlacedBushSkin(prop, prop.skinName, { persist: false });
                            updatePlacedSpinePropContainer(prop);
                            if (selectedPlacedSpineProp === prop) updateBushSkinControl();
                        },
                        error: (instance, error) => {
                            prop.loadError = true;
                            if (selectedPlacedSpineProp === prop) updateBushSkinControl();
                            console.error(`Placed Spine prop "${definition.label}" failed to load:`, error || instance);
                        }
                    });
                } catch (error) {
                    const failedPropIndex = placedSpineProps.indexOf(prop);
                    if (failedPropIndex >= 0) placedSpineProps.splice(failedPropIndex, 1);
                    if (selectedPlacedSpineProp === prop) setSelectedPlacedSpineProp(null);
                    disposePlacedSpineProp(prop);
                    console.error(`Placed Spine prop "${definition.label}" could not be created:`, error);
                    setBuildAddFeedback(`${definition.label} could not be created. The browser may be out of graphics capacity.`);
                    return null;
                }
                prop.spinePlayer = player;
                if (options.persist !== false) savePlacedSpinePropsForCurrentBackground();
                if (options.persist !== false) setBuildAddFeedback(`${definition.label} added. Drag it into position.`);
                return prop;
            }

            function playPlacedBushWind(prop, direction) {
                if (!prop?.ready || !prop.windAnimations) return false;
                const animationName = prop.windAnimations[direction];
                const state = prop.spinePlayer?.animationState;
                const skeletonData = prop.spinePlayer?.skeleton?.data;
                if (!animationName || !state || !skeletonData?.findAnimation?.(animationName)) return false;

                state.clearTrack(0);
                const windEntry = state.setAnimation(0, animationName, false);
                windEntry.mixDuration = 0;
                windEntry.mixTime = 0;
                windEntry.alpha = 1;
                windEntry.listener = {
                    complete: () => {
                        if (!placedSpineProps.includes(prop) || state.getCurrent(0) !== windEntry) return;
                        const idleEntry = state.setAnimation(0, prop.idleAnimation, true);
                        idleEntry.mixDuration = 0;
                        idleEntry.mixTime = 0;
                        idleEntry.alpha = 1;
                        prop.currentWind = '';
                    }
                };
                prop.currentWind = animationName;
                prop.windCooldown = BUSH_WIND_RETRIGGER_COOLDOWN;
                return true;
            }

            function updatePlacedBushWind(prop, dt) {
                if (!prop?.ready || !prop.windAnimations) return;
                prop.windCooldown = Math.max(0, prop.windCooldown - dt);

                const propCenterX = prop.x + prop.width * 0.5;
                const propCenterY = prop.y + prop.height * 0.5;
                const playerCenterX = player.x + player.width * 0.5;
                const playerCenterY = player.y + player.height * 0.5;
                const radiusX = (prop.width * 0.5 + BUSH_WIND_TRIGGER_PADDING.x) * BUSH_WIND_TRIGGER_SCALE;
                const radiusY = (prop.height * 0.5 + BUSH_WIND_TRIGGER_PADDING.y) * BUSH_WIND_TRIGGER_SCALE;
                const normalizedDx = (playerCenterX - propCenterX) / radiusX;
                const normalizedDy = (playerCenterY - propCenterY) / radiusY;
                const isNearBush = normalizedDx * normalizedDx + normalizedDy * normalizedDy <= 1;

                if (!isNearBush) {
                    prop.proximityLatched = false;
                    return;
                }
                if (prop.proximityLatched || prop.windCooldown > 0) return;

                let direction = '';
                if (player.vx > BUSH_WIND_MIN_HORIZONTAL_SPEED) direction = 'right';
                else if (player.vx < -BUSH_WIND_MIN_HORIZONTAL_SPEED) direction = 'left';
                if (direction && playPlacedBushWind(prop, direction)) prop.proximityLatched = true;
            }

            function updatePlacedSpineProps(dt) {
                placedSpineProps.forEach(prop => updatePlacedBushWind(prop, dt));
            }

            function disposePlacedSpineProp(prop) {
                if (!prop) return;
                const canvases = getSpinePlayerCanvases(prop.container);
                try { prop.spinePlayer?.dispose?.(); } catch (error) {
                    console.warn(`Failed to dispose placed Spine prop "${prop.id}".`, error);
                }
                forceLoseSpinePlayerContexts(canvases, `placed Spine prop "${prop.id}"`);
                if (prop.container?.parentNode) prop.container.parentNode.removeChild(prop.container);
                prop.container = null;
                prop.spinePlayer = null;
                prop.ready = false;
            }

            function clearPlacedSpinePropInstances() {
                const releasedExistingPlayers = placedSpineProps.length > 0;
                placedSpineProps.forEach(disposePlacedSpineProp);
                placedSpineProps = [];
                setSelectedPlacedSpineProp(null);
                placedSpinePropDragState.active = false;
                placedSpinePropDragState.pointerId = null;
                placedSpinePropDragState.prop = null;
                return releasedExistingPlayers;
            }

            function removePlacedSpineProp(prop) {
                const index = placedSpineProps.indexOf(prop);
                if (index < 0) return false;
                if (placedSpinePropDragState.prop === prop) endPlacedSpinePropDrag();
                placedSpineProps.splice(index, 1);
                if (selectedPlacedSpineProp === prop) setSelectedPlacedSpineProp(null);
                disposePlacedSpineProp(prop);
                savePlacedSpinePropsForCurrentBackground();
                setBuildAddFeedback(`${prop.label || 'Item'} removed.`);
                return true;
            }

            function findPlacedSpinePropAtPoint(worldX, worldY) {
                for (let index = placedSpineProps.length - 1; index >= 0; index -= 1) {
                    const prop = placedSpineProps[index];
                    if (worldX >= prop.x && worldX <= prop.x + prop.width
                        && worldY >= prop.y && worldY <= prop.y + prop.height) {
                        return prop;
                    }
                }
                return null;
            }

            function beginPlacedSpinePropDrag(event, worldX, worldY) {
                const prop = buildModeEnabled ? findPlacedSpinePropAtPoint(worldX, worldY) : null;
                if (!prop) return false;
                setSelectedPlacedSpineProp(prop);
                placedSpinePropDragState.active = true;
                placedSpinePropDragState.pointerId = event.pointerId;
                placedSpinePropDragState.prop = prop;
                placedSpinePropDragState.offsetX = worldX - prop.x;
                placedSpinePropDragState.offsetY = worldY - prop.y;
                gameBoardElement.style.cursor = 'grabbing';
                try { gameBoardElement.setPointerCapture?.(event.pointerId); } catch (err) { /* optional */ }
                return true;
            }

            function updatePlacedSpinePropDrag(worldX, worldY) {
                const prop = placedSpinePropDragState.prop;
                if (!placedSpinePropDragState.active || !prop) return;
                prop.x = Math.max(0, Math.min(
                    worldX - placedSpinePropDragState.offsetX,
                    Math.max(0, WORLD_WIDTH - prop.width)
                ));
                prop.y = Math.max(0, Math.min(
                    worldY - placedSpinePropDragState.offsetY,
                    Math.max(0, WORLD_HEIGHT - prop.height)
                ));
                updatePlacedSpinePropContainer(prop);
            }

            function endPlacedSpinePropDrag(event = null) {
                if (!placedSpinePropDragState.active) return;
                const pointerId = placedSpinePropDragState.pointerId;
                placedSpinePropDragState.active = false;
                placedSpinePropDragState.pointerId = null;
                placedSpinePropDragState.prop = null;
                if (gameBoardElement) gameBoardElement.style.cursor = '';
                if (event && pointerId !== null) {
                    try { gameBoardElement.releasePointerCapture?.(pointerId); } catch (err) { /* optional */ }
                }
                savePlacedSpinePropsForCurrentBackground();
            }

            function drawPlacedSpinePropsDebug(context) {
                if (!buildModeEnabled) return;
                placedSpineProps.forEach((prop) => {
                    context.save();
                    context.lineWidth = Math.max(1, 2 / zoomLevel);
                    context.strokeStyle = selectedPlacedSpineProp === prop ? '#ffe66d' : '#df9bff';
                    context.fillStyle = context.strokeStyle;
                    context.setLineDash([12 / zoomLevel, 8 / zoomLevel]);
                    context.strokeRect(prop.x, prop.y, prop.width, prop.height);
                    context.setLineDash([]);
                    context.font = `${18 / zoomLevel}px monospace`;
                    context.textAlign = 'center';
                    context.textBaseline = 'bottom';
                    context.fillText(prop.label, prop.x + prop.width * 0.5, prop.y - 6 / zoomLevel);
                    context.restore();
                });
            }

            function placeExistingBalloonAtVisibleCenter(worldX = NaN, worldY = NaN, drawOrder = BUILD_DRAW_ORDER_DEFAULT) {
                createBalloons();
                const targetBalloon = balloons[0];
                if (!targetBalloon) return false;
                const center = Number.isFinite(worldX) && Number.isFinite(worldY)
                    ? { x: worldX, y: worldY }
                    : getVisibleWorldCenter();
                targetBalloon.drawOrder = normalizeBuildDrawOrder(drawOrder);
                if (targetBalloon.ready) {
                    targetBalloon.x = Math.max(0, Math.min(center.x - targetBalloon.width * 0.5, WORLD_WIDTH - targetBalloon.width));
                    targetBalloon.y = Math.max(0, Math.min(center.y - targetBalloon.height * 0.5, WORLD_HEIGHT - targetBalloon.height));
                    updateBalloonContainer(targetBalloon);
                    saveBalloonForCurrentBackground(targetBalloon);
                } else {
                    balloonPlacements[targetBalloon.id] = {
                        rootX: center.x,
                        rootY: center.y + targetBalloon.height * 0.5,
                        drawOrder: normalizeBuildDrawOrder(targetBalloon.drawOrder)
                    };
                    cachedBalloonData[currentBackground] = { [targetBalloon.id]: { ...balloonPlacements[targetBalloon.id] } };
                    persistBalloonData();
                    layoutBalloonInWorld(targetBalloon);
                }
                setSelectedTextBox(null);
                setSelectedPlacedSpineProp(null);
                setSelectedBuildLayerItem('balloon', targetBalloon);
                setBuildAddFeedback(`Balloon placed ${getBuildDrawOrderLabel(targetBalloon.drawOrder)}.`);
                return true;
            }

            function placeBuildItemAt(itemType, worldX, worldY) {
                const frontDrawOrder = BUILD_DRAW_ORDER_MAX;
                let placedItem = null;
                if (itemType === 'balloon') {
                    setSelectedPlacedSpineProp(null);
                    placedItem = placeExistingBalloonAtVisibleCenter(worldX, worldY, frontDrawOrder);
                } else if (itemType === 'butterfly-spawn') {
                    placedItem = createButterflySpawn({ x: worldX, y: worldY, drawOrder: frontDrawOrder });
                } else {
                    const definition = PLACED_SPINE_PROP_DEFS[itemType];
                    if (definition) {
                        const size = getPlacedSpinePropWorldSize(itemType, definition.scale);
                        placedItem = createPlacedSpineProp({
                            type: itemType,
                            x: worldX - size.width * 0.5,
                            y: worldY - size.height * 0.5,
                            drawOrder: frontDrawOrder
                        });
                    }
                }

                const label = getBuildPlacementLabel(itemType);
                clearPendingBuildPlacement({ keepStatus: true });
                if (placedItem) {
                    showBuildPlacementStatus(`${label} placed in front of the player`, 1800);
                    return true;
                }
                showBuildPlacementStatus(`${label} could not be placed`, 2400);
                return false;
            }

            function addBuildItem(itemType) {
                if (!buildModeEnabled) return false;
                setChairPlacementMode(false);
                setDoorPlacementMode(false);
                cancelSegmentDrawing();
                const isPlacedSpineProp = Object.prototype.hasOwnProperty.call(PLACED_SPINE_PROP_DEFS, itemType);
                if (isPlacedSpineProp && placedSpinePropRestorePending) {
                    setBuildAddFeedback('Finishing scene item loading. Try adding that item again in a moment.');
                    return false;
                }
                if (!['balloon', 'butterfly-spawn'].includes(itemType) && !isPlacedSpineProp) return false;
                return beginBuildItemPlacement(itemType);
            }

            function removeSelectedBuildItem() {
                if (selectedPlacedSpineProp && placedSpineProps.includes(selectedPlacedSpineProp)) {
                    return removePlacedSpineProp(selectedPlacedSpineProp);
                }
                if (selectedBuildLayerItem?.kind === 'butterfly-spawn') {
                    return removeButterflySpawn(selectedBuildLayerItem.target);
                }
                setBuildAddFeedback('Select a fan, bush, or butterfly spawn first, then choose Remove again.');
                return false;
            }

            function findNearbyDoor(hitbox) {
                if (!hitbox || !doors.length) return null;
                const left = hitbox.x, right = hitbox.x + hitbox.width;
                const top = hitbox.y, bottom = hitbox.y + hitbox.height;
                for (const door of doors) {
                    if (!door.ready) continue;
                    const doorLeft = door.x - DOOR_INTERACT_PADDING.x;
                    const doorRight = door.x + door.width + DOOR_INTERACT_PADDING.x;
                    const doorTop = door.y - DOOR_INTERACT_PADDING.y;
                    const doorBottom = door.y + door.height + DOOR_INTERACT_PADDING.y;
                    const overlap =
                        right > doorLeft &&
                        left < doorRight &&
                        bottom > doorTop &&
                        top < doorBottom;
                    if (overlap) return door;
                }
                return null;
            }

            function startDoorInteraction(door) {
                if (!door || player.doorState !== 'none') return;
                if (!door.ready) return;
                if (door.state === 'opening') return;
                player.doorState = 'entering';
                activeDoorInteraction = { door, doorFinished: false, playerFinished: false };
                if (sitPromptElement) sitPromptElement.style.display = 'none';
                sitPromptChair = null;
                doorPromptDoor = null;
                player.vx = 0; player.vy = 0; player.isRunning = false; player.isJumping = false; player.jumpHoldTime = 0;
                player.onGround = true;
                stopSlopeSlide();
                playerTiltAngleDeg = 0;

                const finishIfReady = () => {
                    if (activeDoorInteraction &&
                        activeDoorInteraction.doorFinished &&
                        activeDoorInteraction.playerFinished) {
                        player.doorState = 'none';
                        activeDoorInteraction = null;
                        if (player.onGround) applyGroundAnimation(); else updateAirAnimation(player.vy);
                    }
                };

                const startDoorAnim = () => {
                    door.state = 'opening';
                    const state = door.spinePlayer?.animationState;
                    if (state) {
                        const entry = state.setAnimation(0, DOOR_OPEN_ANIMATION, false);
                        if (entry) {
                            entry.listener = {
                                complete: () => {
                                    state.setAnimation(0, DOOR_IDLE_ANIMATION, true);
                                    door.state = 'idle';
                                    if (activeDoorInteraction) activeDoorInteraction.doorFinished = true;
                                    finishIfReady();
                                },
                                end: () => {
                                    state.setAnimation(0, DOOR_IDLE_ANIMATION, true);
                                    door.state = 'idle';
                                    if (activeDoorInteraction) activeDoorInteraction.doorFinished = true;
                                    finishIfReady();
                                }
                            };
                        } else {
                            state.setAnimation(0, DOOR_IDLE_ANIMATION, true);
                            door.state = 'idle';
                            if (activeDoorInteraction) activeDoorInteraction.doorFinished = true;
                            finishIfReady();
                        }
                    } else {
                        if (activeDoorInteraction) activeDoorInteraction.doorFinished = true;
                        finishIfReady();
                    }
                };

                const startPlayerAnim = () => {
                    const hasAnim = spinePlayer?.skeleton?.data?.findAnimation(ANIM_ENTER_DOOR);
                    if (hasAnim) {
                        playSpineAnimationOnce(ANIM_ENTER_DOOR, 0, () => {
                            if (activeDoorInteraction) activeDoorInteraction.playerFinished = true;
                            finishIfReady();
                        });
                    } else {
                        if (activeDoorInteraction) activeDoorInteraction.playerFinished = true;
                        finishIfReady();
                    }
                };

                const playerDelayMs = Math.max(0, DOOR_ANIMATION_SYNC_OFFSET * 1000);
                const doorDelayMs = DOOR_ANIMATION_SYNC_OFFSET < 0 ? Math.abs(DOOR_ANIMATION_SYNC_OFFSET) * 1000 : 0;

                if (doorDelayMs > 0) setTimeout(startDoorAnim, doorDelayMs); else startDoorAnim();
                if (playerDelayMs > 0) setTimeout(startPlayerAnim, playerDelayMs); else startPlayerAnim();
            }

            function resetDoorRushState() {
                doorRushState = { ...DEFAULT_DOOR_RUSH_STATE };
                clearDoorMaskClip();
                clearDoorFadeSequence();
                setPlayerDoorRushHidden(false);
            }

            function shouldDrawDoorMaskDebug() {
                return DOOR_MASK_DEBUG_ALWAYS || doorRushState.active || DEBUG_DRAW;
            }

            function getDoorMaskRect(door, side = 'right') {
                if (!door) return null;
                const scale = Number.isFinite(door.scale) ? door.scale : 1;
                const maskScale = Number.isFinite(DOOR_MASK_CONFIG.scale) && DOOR_MASK_CONFIG.scale > 0 ? DOOR_MASK_CONFIG.scale : 1;
                const baseWidth = (DOOR_MASK_CONFIG.width || 0) * scale * maskScale;
                const width = Math.max(8, baseWidth);
                const pad = (DOOR_MASK_CONFIG.heightPad || 0) * scale * maskScale;
                const yOffset = (DOOR_MASK_CONFIG.yOffset || 0) * scale * maskScale;
                const edgeX = side === 'right' ? (door.x + door.width) : door.x;
                const offset = (DOOR_MASK_CONFIG.inset || 0) * scale * maskScale * (side === 'right' ? 1 : -1);
                const centerX = edgeX + offset;
                return {
                    x: centerX - width * 0.5,
                    y: door.y - pad * 0.5 + yOffset,
                    width,
                    height: door.height + pad
                };
            }

            function computeDoorRushTargetX(door, direction) {
                if (!door) return 0;
                const rawTargetX = direction === 1
                    ? door.x + door.width + DOOR_RUSH_EXIT_PADDING
                    : door.x - player.width - DOOR_RUSH_EXIT_PADDING;
                return Math.max(0, Math.min(rawTargetX, WORLD_WIDTH - player.width));
            }

            function setFacingForDirection(direction) {
                const faceRightFlag = direction < 0; // existing movement logic treats facingRight=true as facing left
                player.facingRight = faceRightFlag;
                syncPlayerSkeletonScale();
            }

            function setDoorRushCameraCenter() {
                const visibleWidth = CANVAS_WIDTH / zoomLevel;
                const visibleHeight = CANVAS_HEIGHT / zoomLevel;
                const focusX = doorRushState.active
                    ? (doorRushState.targetX + player.width * 0.5)
                    : (player.x + player.width * 0.5);
                const desiredX = focusX - visibleWidth * 0.5 + camera.offsetX;
                const desiredY = player.y + player.height / 2 - visibleHeight / 2 - 50 + camera.offsetY;
                const maxCamX = Math.max(0, WORLD_WIDTH - visibleWidth);
                const maxCamY = Math.max(0, WORLD_HEIGHT - visibleHeight);
                const clampedX = Math.max(0, Math.min(desiredX, maxCamX));
                const clampedY = Math.max(0, Math.min(desiredY, maxCamY));
                camera.x = clampedX; camera.y = clampedY;
                camera.targetX = clampedX; camera.targetY = clampedY;
                if (doorRushCameraState) {
                    doorRushCameraState.frozenX = clampedX;
                    doorRushCameraState.frozenY = clampedY;
                }
            }

            function startDoorRushCamera() {
                if (doorRushCameraState.active) return;
                setDoorRushCameraCenter();
                doorRushCameraState.active = true;
                doorRushCameraState.phase = 'out';
                doorRushCameraState.timer = 0;
                doorRushCameraState.duration = Math.max(0.01, DOOR_RUSH_CAMERA_EASE_DURATION);
                doorRushCameraState.startZoom = zoomLevel;
                doorRushCameraState.targetZoom = clampZoom(zoomLevel - DOOR_RUSH_CAMERA_ZOOM_DELTA);
                doorRushCameraState.baseZoom = zoomLevel;
                doorRushCameraState.frozenX = camera.x;
                doorRushCameraState.frozenY = camera.y;
            }

            function startDoorRushCameraReturn() {
                if (!doorRushCameraState.active) return;
                doorRushCameraState.phase = 'in';
                doorRushCameraState.timer = 0;
                doorRushCameraState.duration = Math.max(0.01, DOOR_RUSH_CAMERA_EASE_DURATION);
                doorRushCameraState.startZoom = zoomLevel;
                doorRushCameraState.targetZoom = clampZoom(doorRushCameraState.baseZoom);
            }

            function updateDoorRushCamera(dt) {
                if (!doorRushCameraState.active) return;
                const state = doorRushCameraState;
                if (state.phase === 'hold') {
                    camera.x = state.frozenX; camera.y = state.frozenY;
                    camera.targetX = state.frozenX; camera.targetY = state.frozenY;
                    return;
                }
                state.timer += dt;
                const t = state.duration > 0 ? Math.max(0, Math.min(1, state.timer / state.duration)) : 1;
                const eased = applySittingEase(t);
                const newZoom = state.startZoom + (state.targetZoom - state.startZoom) * eased;
                zoomLevel = clampZoom(newZoom);
                camera.x = state.frozenX; camera.y = state.frozenY;
                camera.targetX = state.frozenX; camera.targetY = state.frozenY;
                if (t >= 1) {
                    if (state.phase === 'out') {
                        state.phase = 'hold';
                    } else if (state.phase === 'in') {
                        state.active = false;
                        state.phase = 'none';
                    }
                }
            }

            function ensureDoorFadeOverlay() {
                if (doorFadeOverlay || !gameWrapper) return;
                const overlay = document.createElement('div');
                overlay.style.position = 'absolute';
                overlay.style.inset = '0';
                overlay.style.background = '#000';
                overlay.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
                overlay.style.transition = `opacity ${DOOR_RUSH_FADE_IN_MS}ms ease`;
                overlay.style.zIndex = '200';
                gameWrapper.appendChild(overlay);
                doorFadeOverlay = overlay;
            }

            function clearDoorFadeTimers() {
                if (doorFadeTimers?.length) doorFadeTimers.forEach(id => clearTimeout(id));
                doorFadeTimers = [];
            }

            function setDoorFadeOpacity(target, durationMs) {
                if (!doorFadeOverlay) return;
                const ms = Math.max(0, Number(durationMs) || 0);
                doorFadeOverlay.style.transition = `opacity ${ms}ms ease`;
                doorFadeOverlay.style.opacity = String(Math.max(0, Math.min(1, target)));
            }

            function setPlayerDoorRushHidden(hidden) {
                doorRushState.playerHidden = !!hidden;
                if (playerContainerElement) {
                    playerContainerElement.style.visibility = hidden ? 'hidden' : '';
                }
            }

            function startDoorFadeSequence() {
                if (doorRushState.fadeStarted) return;
                doorRushState.fadeStarted = true;
                ensureDoorFadeOverlay();
                clearDoorFadeTimers();
                setPlayerDoorRushHidden(false);
                doorRushState.runStarted = false;
                player.vx = 0;
                let backgroundSwapPromise = Promise.resolve();
                const startFade = () => {
                    const now = (performance?.now?.() ?? Date.now());
                    const totalHideMs = Math.max(0, DOOR_RUSH_FADE_START_DELAY_MS + DOOR_RUSH_FADE_IN_MS + DOOR_RUSH_FADE_HOLD_MS + DOOR_RUSH_HIDE_EXTRA_MS);
                    doorRushState.fadeUnlockAt = now + totalHideMs;
                    doorRushState.finishScheduled = false;
                    // Fade to black
                    setDoorFadeOpacity(1, DOOR_RUSH_FADE_IN_MS);
                    // Hide shortly after fade begins (once player visually gone)
                    doorFadeTimers.push(setTimeout(() => {
                        setPlayerDoorRushHidden(true);
                    }, Math.max(0, DOOR_RUSH_HIDE_DELAY_MS)));
                    // Swap background while fully black
                    const bgSwapMs = Math.max(0, DOOR_RUSH_FADE_IN_MS);
                    doorFadeTimers.push(setTimeout(() => {
                        backgroundSwapPromise = cycleBackgroundForDoorRush() || Promise.resolve();
                    }, bgSwapMs));
                    // Begin fading back in; trigger exit run immediately
                    const fadeOutStartMs = Math.max(0, DOOR_RUSH_FADE_IN_MS + DOOR_RUSH_FADE_HOLD_MS);
                    doorFadeTimers.push(setTimeout(() => {
                        const beginExitAfterLoad = async () => {
                            try {
                                await backgroundSwapPromise;
                            } catch (err) {
                                console.error('Background swap failed during door rush:', err);
                            }
                            if (!doorRushState.active) return;
                            setDoorFadeOpacity(0, DOOR_RUSH_FADE_OUT_MS);
                            doorRushState.phase = 'exit';
                            doorRushState.direction = doorRushState.exitDirection;
                            doorRushState.maskSide = doorRushState.entryMaskSide === 'right' ? 'left' : 'right';
                            rebindDoorRushDoor();
                            doorRushState.targetX = computeDoorRushTargetX(doorRushState.door, doorRushState.direction);
                            repositionPlayerInsideDoorForExit();
                            setDoorRushCameraCenter();
                            setFacingForDirection(doorRushState.direction);
                            doorRushState.runStarted = true;
                            doorRushState.playerFinished = false;
                            setPlayerDoorRushHidden(false);
                            const unhideTimer = setTimeout(() => {
                                setPlayerDoorRushHidden(false);
                            }, Math.max(0, DOOR_RUSH_HIDE_EXTRA_MS));
                            doorFadeTimers.push(unhideTimer);
                        };
                        beginExitAfterLoad();
                    }, fadeOutStartMs));
                };
                doorFadeTimers.push(setTimeout(startFade, Math.max(0, DOOR_RUSH_FADE_START_DELAY_MS)));
            }

            function clearDoorFadeSequence() {
                clearDoorFadeTimers();
                setDoorFadeOpacity(0, DOOR_RUSH_FADE_OUT_MS);
                setPlayerDoorRushHidden(false);
                doorRushState.fadeUnlockAt = 0;
                doorRushState.finishScheduled = false;
            }

            function startDoorRushInteraction(door) {
                if (!door || player.doorState !== 'none') return;
                if (!door.ready) return;
                if (door.state === 'opening') return;
                if (doorRushState.active) return;
                startDoorRushCamera();
                player.doorState = 'door-rush';
                activeDoorInteraction = null;
                door.state = 'opening';
                if (sitPromptElement) sitPromptElement.style.display = 'none';
                sitPromptChair = null;
                doorPromptDoor = null;
                player.vx = 0; player.vy = 0; player.isRunning = false; player.isJumping = false; player.jumpHoldTime = 0;
                player.onGround = true;
                stopSlopeSlide();
                playerTiltAngleDeg = 0;
                player.isSkidding = false;
                const doorCenter = door.x + door.width * 0.5;
                const playerCenter = player.x + player.width * 0.5;
                const direction = playerCenter <= doorCenter ? 1 : -1;
                const clampedTargetX = computeDoorRushTargetX(door, direction);
                const maskSide = direction === 1 ? 'right' : 'left';
                doorRushState = { ...DEFAULT_DOOR_RUSH_STATE, active: true, door, doorId: door.id, entryDoorId: door.id, direction, entryDirection: direction, exitDirection: direction, entryMaskSide: maskSide, maskSide, targetX: clampedTargetX, phase: 'entry' };
                alignPlayerForDoorRush(door, direction);
                const beginFinished = () => {
                    startDoorRushCycle();
                    startDoorRushRun();
                };
                startDoorRushBeginAnimation(beginFinished);
            }

            function alignPlayerForDoorRush(door, direction) {
                if (!door) return;
                const doorBottom = door.y + door.height;
                const targetY = Math.max(0, Math.min(doorBottom - player.height + DOOR_RUSH_FOOT_OFFSET, WORLD_HEIGHT - player.height));
                player.y = targetY;
                player.onGround = true;
                player.currentPlatform = null;
                setFacingForDirection(direction);
            }

            function repositionPlayerInsideDoorForExit() {
                const door = doorRushState.door;
                if (!door) return;
                const doorBottom = door.y + door.height;
                const targetY = Math.max(0, Math.min(doorBottom - player.height + DOOR_RUSH_FOOT_OFFSET, WORLD_HEIGHT - player.height));
                const spawnX = doorRushState.entryDirection === 1
                    ? door.x // opposite (left) edge when entering from left-to-right
                    : (door.x + door.width - player.width); // opposite (right) edge when entering from right-to-left
                const clampedX = Math.max(0, Math.min(spawnX, WORLD_WIDTH - player.width));
                player.x = clampedX;
                player.y = targetY;
                player.onGround = true;
                player.currentPlatform = null;
                setFacingForDirection(doorRushState.direction);
                setSpineAnimation(ANIM_RUN, true);
            }

            function startDoorRushBeginAnimation(onFinished) {
                const door = doorRushState.door;
                const state = door?.spinePlayer?.animationState;
                const skeletonData = door?.spinePlayer?.skeleton?.data;
                const hasBegin = skeletonData?.findAnimation(DOOR_SECONDARY_ANIMATIONS.begin);
                if (!state || !hasBegin) {
                    if (typeof onFinished === 'function') onFinished();
                    return;
                }
                const entry = state.setAnimation(0, DOOR_SECONDARY_ANIMATIONS.begin, false);
                if (entry) {
                    entry.listener = {
                        complete: () => { if (typeof onFinished === 'function') onFinished(); },
                        end: () => { if (typeof onFinished === 'function') onFinished(); }
                    };
                } else if (typeof onFinished === 'function') {
                    onFinished();
                }
            }

            function startDoorRushCycle() {
                const door = doorRushState.door;
                const state = door?.spinePlayer?.animationState;
                const skeletonData = door?.spinePlayer?.skeleton?.data;
                if (!state) return;
                door.state = 'opening';
                const hasCycle = skeletonData?.findAnimation(DOOR_SECONDARY_ANIMATIONS.cycle);
                const animName = hasCycle ? DOOR_SECONDARY_ANIMATIONS.cycle : DOOR_OPEN_ANIMATION;
                doorRushState.cycleEntry = state.setAnimation(0, animName, true);
            }

            function startDoorRushRun() {
                if (!doorRushState.active) return;
                doorRushState.runStarted = true;
                setFacingForDirection(doorRushState.direction);
                player.isRunning = true;
                player.isMoving = true;
                player.previousMoveType = 'run';
                player.lastMoveType = 'run';
                clearStopOverlay();
                setSpineAnimation(ANIM_RUN, true);
            }

            function startDoorRushClosing() {
                if (!doorRushState.active || doorRushState.closingStarted) return;
                doorRushState.closingStarted = true;
                const door = doorRushState.door;
                const state = door?.spinePlayer?.animationState;
                const skeletonData = door?.spinePlayer?.skeleton?.data;
                if (!state) {
                    markDoorRushDoorFinished();
                    finishDoorRushIfReady();
                    return;
                }
                const hasEnd = skeletonData?.findAnimation(DOOR_SECONDARY_ANIMATIONS.end);
                const animName = hasEnd ? DOOR_SECONDARY_ANIMATIONS.end : DOOR_IDLE_ANIMATION;
                const entry = state.setAnimation(0, animName, false);
                if (entry) {
                    entry.listener = {
                        complete: () => {
                            playDoorIdle(door);
                            markDoorRushDoorFinished();
                            finishDoorRushIfReady();
                        },
                        end: () => {
                            playDoorIdle(door);
                            markDoorRushDoorFinished();
                            finishDoorRushIfReady();
                        }
                    };
                } else {
                    playDoorIdle(door);
                    markDoorRushDoorFinished();
                    finishDoorRushIfReady();
                }
            }

            function markDoorRushDoorFinished() {
                doorRushState.doorFinished = true;
            }

            function finishDoorRushIfReady() {
                if (!doorRushState.active) return;
                if (doorRushState.playerFinished && doorRushState.doorFinished) {
                    const now = (performance?.now?.() ?? Date.now());
                    const waitMs = Math.max(0, doorRushState.fadeUnlockAt - now);
                    if (waitMs > 0) {
                        if (!doorRushState.finishScheduled) {
                            doorRushState.finishScheduled = true;
                            doorFadeTimers.push(setTimeout(() => finishDoorRushIfReady(), waitMs));
                        }
                        return;
                    }
                    if (doorRushState.door) {
                        doorRushState.door.state = 'idle';
                    }
                    startDoorRushCameraReturn();
                    resetDoorRushState();
                    player.doorState = 'none';
                    player.isRunning = false;
                    player.isMoving = false;
                    applyGroundAnimation();
                }
            }

            function updateDoorRush(dt) {
                if (!doorRushState.active) return;
                rebindDoorRushDoor();
                player.vy = 0;
                player.onGround = true;
                player.currentPlatform = null;
                if (!doorRushState.fadeStarted && doorRushState.runStarted) {
                    const door = doorRushState.door;
                    if (door) {
                        const cleared = doorRushState.direction === 1
                            ? (player.x >= door.x + door.width)
                            : (player.x + player.width <= door.x);
                        if (cleared) startDoorFadeSequence();
                    }
                }
                if (doorRushState.playerHidden) return;
                if (!doorRushState.runStarted) return;
                player.vx = doorRushState.direction * DOOR_RUSH_SPEED;
                player.x += player.vx * dt;
                clampPlayerToWorldBounds();
                const reachedTarget = doorRushState.direction === 1
                    ? player.x >= doorRushState.targetX
                    : player.x <= doorRushState.targetX;
                if (reachedTarget) {
                    player.x = doorRushState.targetX;
                    player.vx = 0;
                    doorRushState.runStarted = false;
                    if (doorRushState.phase === 'exit') {
                        doorRushState.playerFinished = true;
                        startDoorRushClosing();
                        finishDoorRushIfReady();
                    }
                }
            }

            function clearDoorMaskClip() {
                if (playerContainerElement) {
                    playerContainerElement.style.clipPath = '';
                }
            }

            function applyDoorMaskClip(side) {
                if (!playerContainerElement) return;
                rebindDoorRushDoor();
                if (!doorRushState?.door) return;
                const rect = getDoorMaskRect(doorRushState.door, side);
                if (!rect) { clearDoorMaskClip(); return; }
                const containerWidth = playerContainerScreen.width || (PLAYER_VISUAL_WIDTH * zoomLevel);
                const containerLeft = playerContainerWorldBounds.left ?? 0;
                if (!Number.isFinite(containerWidth) || containerWidth <= 0) { clearDoorMaskClip(); return; }
                const safeZoom = zoomLevel || 1;
                if (side === 'right') {
                    const visibleRightPx = (rect.x - containerLeft) * safeZoom;
                    const visiblePercent = Math.max(0, Math.min(100, (visibleRightPx / containerWidth) * 100));
                    const insetRight = Math.max(0, Math.min(100, 100 - visiblePercent));
                    playerContainerElement.style.clipPath = `inset(0 ${insetRight}% 0 0)`;
                } else {
                    const visibleLeftPx = ((rect.x + rect.width) - containerLeft) * safeZoom;
                    const leftInset = Math.max(0, Math.min(100, (visibleLeftPx / containerWidth) * 100));
                    playerContainerElement.style.clipPath = `inset(0 0 0 ${leftInset}%)`;
                }
            }

            function drawDoorsDebug(context) {
                const drawMask = shouldDrawDoorMaskDebug();
                if ((!DEBUG_DRAW && !drawMask) || !doors.length) return;
                context.save();
                if (DEBUG_DRAW) {
                    context.strokeStyle = '#ff66aa';
                    context.lineWidth = Math.max(1, 2 / zoomLevel);
                    doors.forEach((door) => context.strokeRect(door.x, door.y, door.width, door.height));
                }
                if (drawMask) {
                    context.lineWidth = Math.max(1, 2 / zoomLevel);
                    context.strokeStyle = DOOR_MASK_CONFIG.debugBorder || '#00c8ff';
                    context.fillStyle = DOOR_MASK_CONFIG.debugColor || 'rgba(0, 200, 255, 0.3)';
                    doors.forEach((door) => {
                        const leftMask = getDoorMaskRect(door, 'left');
                        const rightMask = getDoorMaskRect(door, 'right');
                        if (leftMask) {
                            context.fillRect(leftMask.x, leftMask.y, leftMask.width, leftMask.height);
                            context.strokeRect(leftMask.x, leftMask.y, leftMask.width, leftMask.height);
                        }
                        if (rightMask) {
                            context.fillRect(rightMask.x, rightMask.y, rightMask.width, rightMask.height);
                            context.strokeRect(rightMask.x, rightMask.y, rightMask.width, rightMask.height);
                        }
                    });
                }
                context.restore();
            }


            function createPlatformFromEndpoints(x1, y1, x2, y2, options = {}) {
                ensurePlatformThickness();
                const thickness = blockHeight || DEFAULT_PLATFORM_THICKNESS;
                let ax = x1, ay = y1, bx = x2, by = y2;
                if (bx < ax || (bx === ax && by < ay)) {
                    ax = x2; ay = y2; bx = x1; by = y1;
                }
                const dx = bx - ax, dy = by - ay;
                const length = Math.hypot(dx, dy) || 1;
                const angle = Math.atan2(dy, dx);
                const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
                const minY = Math.min(ay, by);
                const maxY = Math.max(ay, by);
                const isSlope = Math.abs(dy) > 1e-3;
                const slopeAbsAngleDeg = Math.atan2(Math.abs(dy), Math.abs(dx || 1e-6)) * RAD_TO_DEG;
                const boundingWidth = Math.max(1, maxX - minX);
                const boundingHeight = Math.abs(dy) + thickness;
                return {
                    x: minX,
                    y: minY,
                    width: boundingWidth,
                    height: boundingHeight,
                    thickness,
                    x1: ax, y1: ay, x2: bx, y2: by,
                    length,
                    angle,
                    slopeAbsAngleDeg,
                    isSlope,
                    isBuild: !!options.isBuild,
                    oneWay: options.oneWay === true,
                    renderArtwork: options.renderArtwork !== false,
                    spawnCoins: options.spawnCoins !== false,
                    segmentIndex: options.segmentIndex
                };
            }
            function segmentToPlatform(segment, index) {
                if (!segment) return null;
                ensurePlatformThickness();
                const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1;
                const len = Math.hypot(dx, dy);
                if (len < 1) return null;
                return createPlatformFromEndpoints(segment.x1, segment.y1, segment.x2, segment.y2, { isBuild: true, oneWay: true, segmentIndex: index });
            }

            function mergeConnectedPlatforms(list) {
                const distEq = (a, b, eps = 4) => Math.abs(a - b) <= eps;
                const angleClose = (a, b, epsDeg = 5) => Math.abs((a - b) * RAD_TO_DEG) <= epsDeg;
                const segments = [...list];
                const chains = [];

                const findNext = (endX, endY) => {
                    const idx = segments.findIndex(s =>
                        distEq(s.x1, endX) && distEq(s.y1, endY) ||
                        distEq(s.x2, endX) && distEq(s.y2, endY)
                    );
                    if (idx === -1) return null;
                    const seg = segments.splice(idx, 1)[0];
                    return distEq(seg.x1, endX) && distEq(seg.y1, endY)
                        ? seg
                        : { ...seg, x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1, angle: Math.atan2(seg.y1 - seg.y2, seg.x1 - seg.x2) };
                };

                while (segments.length) {
                    const start = segments.shift();
                    const chain = [start];
                    let cursorX = start.x2, cursorY = start.y2;
                    let next;
                    while ((next = findNext(cursorX, cursorY))) {
                        chain.push(next);
                        cursorX = next.x2; cursorY = next.y2;
                    }
                    chains.push(chain);
                }

                const mergedChains = [];
                for (const chain of chains) {
                    if (!chain.length) continue;
                    let current = chain[0];
                    const pieces = [];
                    for (let i = 1; i < chain.length; i++) {
                        const next = chain[i];
                        const sameType = current.isSlope === next.isSlope;
                        const anglesAligned = sameType
                            ? (current.isSlope ? angleClose(current.angle, next.angle) : distEq(current.y, next.y))
                            : false;
                        if (sameType && anglesAligned) {
                            current = createPlatformFromEndpoints(current.x1, current.y1, next.x2, next.y2, { isBuild: true, oneWay: current.oneWay && next.oneWay });
                        } else {
                            pieces.push(current);
                            current = next;
                        }
                    }
                    pieces.push(current);
                    mergedChains.push(...pieces);
                }
                return mergedChains;
            }

            function getPresetPlatformsFromScript() {
                ensurePlatformThickness();
                const rawPresets = Array.isArray(window.PLATFORM_PRESETS) ? window.PLATFORM_PRESETS : [];
                const sanitizeNumber = (value, fallback = 0) => {
                    const num = Number(value);
                    return Number.isFinite(num) ? num : fallback;
                };
                return rawPresets.map(entry => {
                    if (!entry || typeof entry !== 'object') return null;
                    const height = sanitizeNumber(entry.height, blockHeight || DEFAULT_PLATFORM_THICKNESS);
                    const x1 = sanitizeNumber(entry.x, 0);
                    const y1 = sanitizeNumber(entry.y, 0);
                    const hasEndpoints = Number.isFinite(entry.x2) && Number.isFinite(entry.y2);
                    const x2 = hasEndpoints ? sanitizeNumber(entry.x2, x1) : x1 + Math.max(1, sanitizeNumber(entry.width, blockHeight));
                    const y2 = hasEndpoints ? sanitizeNumber(entry.y2, y1) : y1;
                    return createPlatformFromEndpoints(x1, y1, x2, y2, {
                        isBuild: false,
                        oneWay: entry.oneWay === true,
                        renderArtwork: entry.renderArtwork !== false,
                        spawnCoins: entry.spawnCoins !== false
                    });
                }).filter(Boolean);
            }

            function rebuildBasePlatforms() {
                ensurePlatformThickness();
                const floorPlatform = { x: 0, y: WORLD_HEIGHT - FLOOR_HEIGHT, width: WORLD_WIDTH, height: blockHeight, isBuild: false, oneWay: false };
                const presetPlatforms = getPresetPlatformsFromScript();
                basePlatforms = [floorPlatform, ...presetPlatforms];
            }

            function recomputePlatforms() {
                rebuildBasePlatforms();
                buildPlatforms = buildSegments.map((segment, idx) => segmentToPlatform(segment, idx)).filter(Boolean);
                const mergedBuild = mergeConnectedPlatforms(buildPlatforms);
                finalPlatforms = [...basePlatforms, ...mergedBuild];
                platforms = finalPlatforms;
            }
            function saveSegmentsForCurrentBackground() {
                if (!currentBackground) return;
                cachedBuildData[currentBackground] = buildSegments.map(seg => [seg.x1, seg.y1, seg.x2, seg.y2]);
                persistBuildData();
            }
            function loadSegmentsForBackground(bgPath) {
                const entries = cachedBuildData[bgPath];
                if (Array.isArray(entries)) {
                    buildSegments = entries.map(entry => {
                        if (!Array.isArray(entry) || entry.length < 4) return null;
                        const [rawX1, rawY1, rawX2, rawY2] = entry.map(Number);
                        if (![rawX1, rawY1, rawX2, rawY2].every(isFinite)) return null;
                        const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
                        const x1 = clamp(rawX1, 0, WORLD_WIDTH);
                        const x2 = clamp(rawX2, 0, WORLD_WIDTH);
                        if (Math.abs(x2 - x1) < 1 && Math.abs(rawY2 - rawY1) < 1) return null;
                        ensurePlatformThickness();
                        const y1 = clamp(rawY1, 0, WORLD_HEIGHT - blockHeight);
                        const y2 = clamp(rawY2, 0, WORLD_HEIGHT - blockHeight);
                        return { x1, y1, x2, y2 };
                    }).filter(Boolean);
                } else {
                    buildSegments = [];
                }
                recomputePlatforms();
                spawnCoinsForCurrentPlatforms();
            }

            function spawnCoinsForCurrentPlatforms() {
                // Return existing coins to pool before clearing
                for (let i = 0; i < coins.length; i++) {
                    releaseCoin(coins[i]);
                }
                coins.length = 0;
                if (!ENABLE_COINS) return;
                if (!Array.isArray(platforms) || !platforms.length) return;
                const coinWidth = coinFrameSize.width || 48;
                const coinHeight = coinFrameSize.height || 48;
                const spacing = Math.max(COIN_SPAWN_SPACING, coinWidth * 1.5);
                platforms.forEach((platform) => {
                    if (!platform || platform.width <= 0 || platform.spawnCoins === false) return;
                    const usableLength = platform.isSlope ? platform.length : platform.width;
                    const count = Math.max(1, Math.round((usableLength / spacing) * COIN_SPAWN_DENSITY));
                    for (let i = 0; i < count; i++) {
                        const t = platform.isSlope ? (i + 1) / (count + 1) : null;
                        const centerX = platform.isSlope
                            ? (platform.x1 + (platform.x2 - platform.x1) * t)
                            : ((platform.width <= coinWidth)
                                ? platform.x + platform.width / 2
                                : randomFloat(platform.x + coinWidth / 2, platform.x + platform.width - coinWidth / 2));
                        const centerY = platform.isSlope
                            ? (() => {
                                const baseY = platform.y1 + (platform.y2 - platform.y1) * t;
                                const nx = platform.y1 - platform.y2;
                                const ny = platform.x1 - platform.x2;
                                const nLen = Math.hypot(nx, ny) || 1;
                                const offset = (COIN_HEIGHT_OFFSET + coinHeight / 2);
                                return baseY + (ny / nLen) * offset;
                            })()
                            : Math.max(0, platform.y - COIN_HEIGHT_OFFSET - coinHeight / 2);
                        const coin = acquireCoin();
                        coin.centerX = centerX;
                        coin.centerY = centerY;
                        coin.width = coinWidth;
                        coin.height = coinHeight;
                        coin.platformY = platform.isSlope ? (platform.y1 + platform.y2) * 0.5 : platform.y;
                        coin.frame = Math.floor(Math.random() * COIN_FRAME_COUNT);
                        coin.timer = Math.random() * COIN_FRAME_DURATION;
                        coins.push(coin);
                    }
                });
            }

            function updateCoins(dt) {
                if (!coins.length) return;
                for (let i = coins.length - 1; i >= 0; i--) {
                    const coin = coins[i];
                    coin.timer += dt;
                    while (coin.timer >= COIN_FRAME_DURATION) {
                        coin.timer -= COIN_FRAME_DURATION;
                        coin.frame = (coin.frame + COIN_FRAME_STEP) % COIN_FRAME_COUNT;
                    }
                    if (!player) continue;
                    // Use reusable bounds object to reduce allocations
                    _reusableCoinBounds.left = coin.centerX - coin.width / 2;
                    _reusableCoinBounds.right = coin.centerX + coin.width / 2;
                    _reusableCoinBounds.top = coin.centerY - coin.height / 2;
                    _reusableCoinBounds.bottom = coin.centerY + coin.height / 2;
                    const overlap = player.x < _reusableCoinBounds.right &&
                        player.x + player.width > _reusableCoinBounds.left &&
                        player.y < _reusableCoinBounds.bottom &&
                        player.y + player.height > _reusableCoinBounds.top;
                    if (overlap) {
                        playCoinCollectEffect(coin.centerX, coin.centerY);
                        releaseCoin(coins.splice(i, 1)[0]);
                        //coins collected needs to be 1 here for normal gamplay
                        coinsCollected += 100;
                        updateCoinCounterDisplay();
                    }
                }
            }

            // Reusable bounds for coin pile collectibles
            const _reusablePileBounds = { left: 0, right: 0, top: 0, bottom: 0 };

            function updateCoinPileCollectibles(dt) {
                for (let i = coinPileCollectibles.length - 1; i >= 0; i--) {
                    const pile = coinPileCollectibles[i];

                    // Update timer until animation completes
                    if (!pile.ready) {
                        pile.timer += dt;
                        if (pile.timer >= COIN_PILE_SETTINGS.animationDuration) {
                            pile.ready = true;
                        }
                        continue;  // Not collectible yet
                    }

                    // Check player collision (pile uses bottom-center anchor)
                    if (!player) continue;
                    _reusablePileBounds.left = pile.centerX - pile.width / 2;
                    _reusablePileBounds.right = pile.centerX + pile.width / 2;
                    _reusablePileBounds.top = pile.centerY - pile.height;
                    _reusablePileBounds.bottom = pile.centerY;

                    const overlap = player.x < _reusablePileBounds.right &&
                        player.x + player.width > _reusablePileBounds.left &&
                        player.y < _reusablePileBounds.bottom &&
                        player.y + player.height > _reusablePileBounds.top;

                    if (overlap) {
                        // Play multiple coin collect VFX with spread
                        for (let v = 0; v < COIN_PILE_SETTINGS.vfxMultiplier; v++) {
                            playCoinCollectEffect(pile.centerX, pile.centerY - pile.height / 2);
                        }
                        // Remove and recycle the pile
                        releaseCoinPileCollectible(coinPileCollectibles.splice(i, 1)[0]);
                        coinsCollected += 500;  // 5x coin value
                        updateCoinCounterDisplay();
                    }
                }
            }

            function drawCoinPileCollectibles(context) {
                for (const pile of coinPileCollectibles) {
                    if (!pile.ready) continue;  // Don't draw until VFX animation is done
                    const frame = coinPileFinalFrames[pile.variant];
                    if (frame && frame.complete && (frame.width || frame.naturalWidth)) {
                        // Draw with bottom-center anchor
                        const drawLeft = pile.centerX - pile.width / 2;
                        const drawTop = pile.centerY - pile.height;
                        context.drawImage(frame, drawLeft, drawTop, pile.width, pile.height);
                    }
                }
            }

            function drawChairs(context) {
                if (!chairPlacements.length) return;
                for (const chair of chairPlacements) {
                    const width = chair.width || chairRenderSize.width || CHAIR_DEFAULT_SIZE.width;
                    const height = chair.height || chairRenderSize.height || CHAIR_DEFAULT_SIZE.height;
                    if (chairImageLoaded && chairImage?.complete && (chairImage.width || chairImage.naturalWidth)) {
                        context.drawImage(chairImage, chair.x, chair.y, width, height);
                    } else {
                        context.save();
                        context.fillStyle = '#7d5a3c';
                        context.fillRect(chair.x, chair.y, width, height);
                        context.restore();
                    }
                    if (buildModeEnabled) {
                        context.save();
                        context.strokeStyle = '#8fb1ff';
                        context.lineWidth = Math.max(1, 2 / zoomLevel);
                        context.strokeRect(chair.x, chair.y, width, height);
                        context.restore();
                    }
                }
            }

            function drawCoins(context) {
                if (!coins.length) return;
                for (const coin of coins) {
                    const frame = coinFrames[coin.frame % coinFrames.length];
                    if (frame && frame.complete && (frame.width || frame.naturalWidth)) {
                        const drawWidth = frame.width || frame.naturalWidth || coinFrameSize.width;
                        const drawHeight = frame.height || frame.naturalHeight || coinFrameSize.height;
                        const drawLeft = coin.centerX - drawWidth / 2;
                        const drawTop = coin.centerY - drawHeight / 2;
                        context.drawImage(frame, drawLeft, drawTop, drawWidth, drawHeight);
                    } else {
                        const radiusX = coin.width * 0.5;
                        const radiusY = coin.height * 0.5;
                        context.save();
                        context.fillStyle = '#ffd700';
                        context.beginPath();
                        context.ellipse(coin.centerX, coin.centerY, Math.max(4, radiusX), Math.max(4, radiusY), 0, 0, Math.PI * 2);
                        context.fill();
                        context.restore();
                    }
                }
            }

            function getVisibleWorldRect(padding = 0) {
                const visibleWidth = CANVAS_WIDTH / zoomLevel;
                const visibleHeight = CANVAS_HEIGHT / zoomLevel;
                return {
                    left: Math.max(-padding, camera.x - padding),
                    top: Math.max(-padding, camera.y - padding),
                    right: Math.min(WORLD_WIDTH + padding, camera.x + visibleWidth + padding),
                    bottom: Math.min(WORLD_HEIGHT + padding, camera.y + visibleHeight + padding),
                    width: visibleWidth + padding * 2,
                    height: visibleHeight + padding * 2
                };
            }

            function getLoadedAmbientLeafImageIndexes() {
                const indexes = [];
                ambientLeafImages.forEach((image, index) => {
                    if (image?.complete && (image.naturalWidth || image.width)) indexes.push(index);
                });
                return indexes;
            }

            function pickAmbientLeafScreenPosition(layer, initial = false) {
                const parallax = layer?.parallax || 1;
                const padding = AMBIENT_LEAF_SPAWN_PADDING * zoomLevel;
                const clusterWidth = (CANVAS_WIDTH + padding * 2) / AMBIENT_LEAF_CLUSTER_COUNT;
                const clusterIndex = Math.floor(randomFloat(0, AMBIENT_LEAF_CLUSTER_COUNT));
                const clusterX = -padding + clusterWidth * (clusterIndex + 0.5) + randomFloat(-clusterWidth * 0.12, clusterWidth * 0.12);
                const clusterHeight = (CANVAS_HEIGHT + 260) / AMBIENT_LEAF_CLUSTER_ROW_COUNT;
                const clusterRowIndex = Math.floor(randomFloat(0, AMBIENT_LEAF_CLUSTER_ROW_COUNT));
                const clusterY = initial
                    ? -80 + clusterHeight * (clusterRowIndex + 0.5) + randomFloat(-clusterHeight * 0.14, clusterHeight * 0.14)
                    : randomFloat(-padding, -80);
                const screenX = Math.random() < AMBIENT_LEAF_CLUSTER_CHANCE
                    ? clusterX + randomFloat(-AMBIENT_LEAF_CLUSTER_RADIUS_X, AMBIENT_LEAF_CLUSTER_RADIUS_X) * zoomLevel
                    : randomFloat(-padding, CANVAS_WIDTH + padding);
                const screenY = Math.random() < AMBIENT_LEAF_CLUSTER_CHANCE
                    ? clusterY + randomFloat(-AMBIENT_LEAF_CLUSTER_RADIUS_Y, AMBIENT_LEAF_CLUSTER_RADIUS_Y) * zoomLevel
                    : (initial ? randomFloat(-80, CANVAS_HEIGHT + 180) : randomFloat(-padding, -80));

                return {
                    x: camera.x + screenX / (parallax * zoomLevel),
                    y: camera.y + screenY / (parallax * zoomLevel)
                };
            }

            function cacheAmbientLeafDrawState(leaf, swayValue = Math.sin(leaf.swayPhase || 0)) {
                const tumbleCos = Math.cos(leaf.tumblePhase || 0);
                const tumbleWidth = Math.max(AMBIENT_LEAF_TUMBLE_MIN_WIDTH, Math.abs(tumbleCos));
                leaf.drawX = leaf.x;
                leaf.drawY = leaf.y + Math.sin((leaf.tumblePhase || 0) * 1.7 + (leaf.swayPhase || 0)) * leaf.heightWobble;
                leaf.drawRotation = leaf.rotation + swayValue * 0.22;
                leaf.drawWidthScale = tumbleWidth;
                leaf.drawHeightScale = 1 + Math.sin((leaf.tumblePhase || 0) * 2.1) * 0.035;
                leaf.drawAlpha = leaf.opacity * (0.54 + tumbleWidth * 0.46);
                leaf.flipX = tumbleCos < 0;
            }

            function randomizeAmbientLeaf(leaf = {}, initial = false) {
                const loadedIndexes = getLoadedAmbientLeafImageIndexes();
                if (!loadedIndexes.length) return null;
                const sourceIndex = loadedIndexes[Math.floor(Math.random() * loadedIndexes.length)];
                const layer = AMBIENT_LEAF_LAYERS[Math.floor(Math.random() * AMBIENT_LEAF_LAYERS.length)] || AMBIENT_LEAF_LAYERS[1];
                const scale = randomFloat(layer.scale.min, layer.scale.max);
                const position = pickAmbientLeafScreenPosition(layer, initial);
                Object.assign(leaf, {
                    sourceIndex,
                    depth: layer.depth,
                    zOffset: randomFloat(-12, 12),
                    parallax: layer.parallax,
                    x: position.x,
                    y: position.y,
                    scale,
                    fallSpeed: randomFloat(54, 118) * layer.speed,
                    driftSpeed: randomFloat(-34, 34) * layer.speed,
                    swayAmplitude: randomFloat(22, 82) * layer.speed,
                    swayPhase: randomFloat(0, Math.PI * 2),
                    swaySpeed: randomFloat(0.9, 2.7) * layer.speed,
                    tumblePhase: randomFloat(0, Math.PI * 2),
                    tumbleSpeed: randomFloat(2.1, 5.5) * layer.speed * (Math.random() < 0.5 ? -1 : 1),
                    spin: randomFloat(-1.35, 1.35) * layer.speed,
                    opacity: randomFloat(layer.opacity.min, layer.opacity.max),
                    rotation: randomFloat(0, Math.PI * 2),
                    heightWobble: randomFloat(2, 10) * layer.speed,
                    drawX: position.x,
                    drawY: position.y,
                    drawRotation: 0,
                    drawWidthScale: 1,
                    drawHeightScale: 1,
                    drawAlpha: 1,
                    flipX: false
                });
                cacheAmbientLeafDrawState(leaf);
                return leaf;
            }

            function createAmbientLeaf(initial = false) {
                return randomizeAmbientLeaf({}, initial);
            }

            function isAmbientLeafOutsideView(leaf) {
                const parallax = leaf.parallax ?? 1;
                const screenX = ((leaf.drawX ?? leaf.x) - camera.x) * parallax * zoomLevel;
                const screenY = ((leaf.drawY ?? leaf.y) - camera.y) * parallax * zoomLevel;
                const padding = AMBIENT_LEAF_DESPAWN_PADDING * zoomLevel;
                return screenY > CANVAS_HEIGHT + padding
                    || screenX < -padding
                    || screenX > CANVAS_WIDTH + padding;
            }

            function resetAmbientLeaves() {
                ambientLeaves.length = 0;
                ambientLeafStepAccumulator = 0;
                ambientLeafSpawnAccumulator = 0;
                ambientLeafClock = 0;
                ambientLeafWarmStarted = false;
                ambientLeafWindDirection = Math.random() < 0.5 ? -1 : 1;
                ambientLeafWindTimer = randomFloat(AMBIENT_LEAF_WIND_CHANGE_MIN, AMBIENT_LEAF_WIND_CHANGE_MAX);
            }

            function warmAmbientLeaves() {
                if (ambientLeafWarmStarted) return;
                ambientLeafWarmStarted = true;
                for (let index = 0; index < AMBIENT_LEAF_INITIAL_COUNT && ambientLeaves.length < AMBIENT_LEAF_MAX_COUNT; index += 1) {
                    const leaf = createAmbientLeaf(true);
                    if (leaf) ambientLeaves.push(leaf);
                }
            }

            function stepAmbientLeaves(step) {
                warmAmbientLeaves();
                ambientLeafClock += step;
                ambientLeafWindTimer -= step;
                if (ambientLeafWindTimer <= 0) {
                    ambientLeafWindDirection = Math.random() < 0.5 ? -1 : 1;
                    ambientLeafWindTimer = randomFloat(AMBIENT_LEAF_WIND_CHANGE_MIN, AMBIENT_LEAF_WIND_CHANGE_MAX);
                }

                for (let index = ambientLeaves.length - 1; index >= 0; index -= 1) {
                    const leaf = ambientLeaves[index];
                    const previousSway = Math.sin(leaf.swayPhase);
                    leaf.swayPhase += leaf.swaySpeed * step;
                    const nextSway = Math.sin(leaf.swayPhase);
                    leaf.x += leaf.driftSpeed * step + (nextSway - previousSway) * leaf.swayAmplitude;
                    leaf.y += leaf.fallSpeed * step;
                    leaf.tumblePhase += leaf.tumbleSpeed * step;
                    leaf.rotation += leaf.spin * step;
                    cacheAmbientLeafDrawState(leaf, nextSway);

                    if (isAmbientLeafOutsideView(leaf)) {
                        randomizeAmbientLeaf(leaf, false);
                    }
                }
            }

            function updateAmbientLeaves(dt) {
                ambientLeafStepAccumulator += Math.min(0.35, Math.max(0, dt));
                let safety = 0;
                while (ambientLeafStepAccumulator >= AMBIENT_LEAF_STEP && safety < 4) {
                    stepAmbientLeaves(AMBIENT_LEAF_STEP);
                    ambientLeafStepAccumulator -= AMBIENT_LEAF_STEP;
                    safety += 1;
                }
                if (safety >= 4) ambientLeafStepAccumulator = 0;
            }

            function removeBackgroundLayerSurfaces() {
                backgroundLayerSurfaces.forEach(({ canvas: layerCanvas }) => layerCanvas.remove());
                backgroundLayerSurfaces.clear();
            }

            function syncBackgroundLayerSurfaces(scene) {
                const activeIds = new Set((scene?.layers || []).map(layer => layer.id));
                backgroundLayerSurfaces.forEach((surface, id) => {
                    if (activeIds.has(id)) return;
                    surface.canvas.remove();
                    backgroundLayerSurfaces.delete(id);
                });
                for (const layer of scene?.layers || []) {
                    let surface = backgroundLayerSurfaces.get(layer.id);
                    if (!surface) {
                        const layerCanvas = document.createElement('canvas');
                        layerCanvas.className = 'background-parallax-layer';
                        layerCanvas.dataset.backgroundLayer = layer.id;
                        layerCanvas.setAttribute('aria-hidden', 'true');
                        Object.assign(layerCanvas.style, {
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none'
                        });
                        canvas.insertAdjacentElement('afterend', layerCanvas);
                        surface = { canvas: layerCanvas, context: layerCanvas.getContext('2d') };
                        backgroundLayerSurfaces.set(layer.id, surface);
                    }
                    surface.canvas.style.zIndex = String(layer.zIndex);
                    surface.canvas.title = `${layer.label} · z ${layer.zIndex}`;
                }
                resizeBackgroundLayerSurfaces();
            }

            function resizeBackgroundLayerSurfaces() {
                backgroundLayerSurfaces.forEach(({ canvas: layerCanvas }) => {
                    if (layerCanvas.width !== CANVAS_WIDTH) layerCanvas.width = CANVAS_WIDTH;
                    if (layerCanvas.height !== CANVAS_HEIGHT) layerCanvas.height = CANVAS_HEIGHT;
                    layerCanvas.style.width = `${CANVAS_WIDTH}px`;
                    layerCanvas.style.height = `${CANVAS_HEIGHT}px`;
                });
            }

            function clearBackgroundLayerSurfaces() {
                backgroundLayerSurfaces.forEach(({ context }) => {
                    context.setTransform(1, 0, 0, 1, 0, 0);
                    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                });
            }

            function setupPlatformOverlay() {
                if (!gameBoardElement || platformOverlayCanvas.parentNode) return;
                platformOverlayCanvas.className = 'platform-overlay';
                platformOverlayCanvas.setAttribute('aria-hidden', 'true');
                Object.assign(platformOverlayCanvas.style, {
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: String(PLATFORM_DRAW_ORDER)
                });
                // Keeping this immediately after the background canvas makes z-index 0 props render
                // behind it, while dynamically-created z-index 1 props render in front of it.
                canvas.insertAdjacentElement('afterend', platformOverlayCanvas);
            }

            function resizePlatformOverlay() {
                platformOverlayCanvas.width = CANVAS_WIDTH;
                platformOverlayCanvas.height = CANVAS_HEIGHT;
                platformOverlayCanvas.style.width = `${CANVAS_WIDTH}px`;
                platformOverlayCanvas.style.height = `${CANVAS_HEIGHT}px`;
            }

            function setupAmbientLeafOverlay() {
                if (!gameBoardElement || !ambientLeafOverlayCanvas.parentNode) {
                    ambientLeafOverlayCanvas.className = 'ambient-leaf-overlay';
                    ambientLeafOverlayCanvas.setAttribute('aria-hidden', 'true');
                    Object.assign(ambientLeafOverlayCanvas.style, {
                        position: 'absolute',
                        left: '0',
                        top: '0',
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: '1000000'
                    });
                    gameBoardElement?.appendChild(ambientLeafOverlayCanvas);
                }
            }

            function resizeAmbientLeafOverlay() {
                if (!ambientLeafOverlayCanvas) return;
                ambientLeafOverlayCanvas.width = CANVAS_WIDTH;
                ambientLeafOverlayCanvas.height = CANVAS_HEIGHT;
                ambientLeafOverlayCanvas.style.width = `${CANVAS_WIDTH}px`;
                ambientLeafOverlayCanvas.style.height = `${CANVAS_HEIGHT}px`;
            }

            function drawAmbientLeaves(context) {
                if (!ambientLeaves.length) return;
                const sortedLeaves = ambientLeaves.slice().sort((a, b) => ((a.depth || 0) - (b.depth || 0)) || ((a.zOffset || 0) - (b.zOffset || 0)));
                for (const leaf of sortedLeaves) {
                    const image = ambientLeafImages[leaf.sourceIndex];
                    if (!image?.complete || !(image.naturalWidth || image.width)) continue;
                    const width = (image.naturalWidth || image.width) * leaf.scale;
                    const height = (image.naturalHeight || image.height) * leaf.scale;
                    const parallax = leaf.parallax ?? 1;
                    const screenX = ((leaf.drawX ?? leaf.x) - camera.x) * parallax * zoomLevel;
                    const screenY = ((leaf.drawY ?? leaf.y) - camera.y) * parallax * zoomLevel;
                    context.save();
                    context.globalAlpha = leaf.drawAlpha ?? leaf.opacity;
                    context.translate(screenX, screenY);
                    context.rotate(leaf.drawRotation ?? leaf.rotation);
                    context.scale(leaf.flipX ? -1 : 1, 1);
                    context.drawImage(
                        image,
                        -width * (leaf.drawWidthScale ?? 1) * zoomLevel * 0.5,
                        -height * (leaf.drawHeightScale ?? 1) * zoomLevel * 0.5,
                        width * (leaf.drawWidthScale ?? 1) * zoomLevel,
                        height * (leaf.drawHeightScale ?? 1) * zoomLevel
                    );
                    context.restore();
                }
            }

            function drawAmbientLeafOverlay() {
                if (!ambientLeafOverlayCtx) return;
                ambientLeafOverlayCtx.setTransform(1, 0, 0, 1, 0, 0);
                ambientLeafOverlayCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                ambientLeafOverlayCtx.save();
                drawAmbientLeaves(ambientLeafOverlayCtx);
                ambientLeafOverlayCtx.restore();
            }

            function setBuildAddMenuOpen(open, options = {}) {
                const shouldOpen = !!open && buildModeEnabled;
                if (buildAddMenu) buildAddMenu.hidden = !shouldOpen;
                if (buildAddButton) buildAddButton.setAttribute('aria-expanded', String(shouldOpen));
                if (shouldOpen) updateBuildLayerControls();
                if (shouldOpen && options.focus !== false) {
                    requestAnimationFrame(() => buildAddMenuButtons[0]?.focus());
                } else if (!shouldOpen && options.returnFocus) {
                    buildAddButton?.focus();
                }
            }

            function setBuildMode(enabled) {
                buildModeEnabled = enabled;
                if (enabled) resetJoystick();
                if (!enabled) {
                    endTextBoxDrag();
                    endBalloonDrag();
                    endPlacedSpinePropDrag();
                    endButterflySpawnDrag();
                    setSelectedPlacedSpineProp(null);
                    setSelectedBuildLayerItem(null, null);
                    setBuildAddMenuOpen(false);
                    clearPendingBuildPlacement();
                    setPlatformPlacementMode(false);
                    if (gameBoardElement) gameBoardElement.style.cursor = '';
                    setChairPlacementMode(false);
                    setDoorPlacementMode(false);
                }
                else { setChairPlacementMode(chairPlacementMode); setDoorPlacementMode(doorPlacementMode); }
                setTextBoxesEditable(enabled);
                if (buildModeButton) {
                    buildModeButton.textContent = enabled ? 'Exit Build Mode' : 'Enter Build Mode';
                    buildModeButton.classList.toggle('active', enabled);
                }
                if (addTextButton) {
                    addTextButton.disabled = !enabled;
                }
                if (buildLayerPanel) buildLayerPanel.hidden = !enabled;
                if (enabled) updateBuildLayerControls();
                if (buildAddTools) buildAddTools.hidden = !enabled;
                if (!enabled) cancelSegmentDrawing();
                updateButterflySpawnContainers();
            }
            function toggleBuildMode() { setBuildMode(!buildModeEnabled); }
            if (buildModeButton) {
                buildModeButton.addEventListener('click', () => {
                    toggleBuildMode();
                    const compactTools = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;
                    if (buildModeEnabled && compactTools && !uiHidden) toggleUiButton?.click();
                    buildModeButton.blur();
                });
            }
            if (chairToolButton) {
                chairToolButton.disabled = true;
                chairToolButton.addEventListener('click', () => {
                    setChairPlacementMode(!chairPlacementMode);
                    chairToolButton.blur();
                });
            }
            if (doorToolButton) {
                doorToolButton.disabled = true;
                doorToolButton.addEventListener('click', () => {
                    setDoorPlacementMode(!doorPlacementMode);
                    doorToolButton.blur();
                });
            }
            if (addTextButton) {
                addTextButton.disabled = true;
                addTextButton.addEventListener('click', () => {
                    if (!buildModeEnabled) return;
                    setChairPlacementMode(false);
                    setDoorPlacementMode(false);
                    cancelSegmentDrawing();
                    addTextBoxAtVisibleCenter();
                    addTextButton.blur();
                });
            }
            if (buildAddButton) {
                buildAddButton.addEventListener('click', () => {
                    const isOpen = buildAddMenu ? !buildAddMenu.hidden : false;
                    setBuildAddMenuOpen(!isOpen);
                });
                buildAddButton.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                });
            }
            if (buildLayerBackButton) {
                buildLayerBackButton.addEventListener('click', () => {
                    adjustSelectedBuildDrawOrder(-1);
                    buildLayerBackButton.blur();
                });
            }
            if (buildLayerForwardButton) {
                buildLayerForwardButton.addEventListener('click', () => {
                    adjustSelectedBuildDrawOrder(1);
                    buildLayerForwardButton.blur();
                });
            }
            function activateBuildAddMenuButton(button) {
                const action = button.dataset.buildAction;
                if (action === 'draw-platform') {
                    setPlatformPlacementMode(true);
                    setBuildAddMenuOpen(false, { returnFocus: true });
                    return;
                }
                if (action === 'send-back' || action === 'bring-forward') {
                    adjustSelectedBuildDrawOrder(action === 'send-back' ? -1 : 1);
                    return;
                }
                const actionCompleted = action === 'remove-selected'
                    ? removeSelectedBuildItem()
                    : addBuildItem(button.dataset.buildItem);
                if (actionCompleted) setBuildAddMenuOpen(false, { returnFocus: true });
            }

            buildAddMenuButtons.forEach((button) => {
                // Commit on pointerdown: iOS can move focus and dismiss this floating
                // menu before its delayed synthetic click reaches the chosen item.
                button.addEventListener('pointerdown', (event) => {
                    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    activateBuildAddMenuButton(button);
                });
                // Keyboard and programmatic activation do not have a pointer click detail.
                button.addEventListener('click', (event) => {
                    if (event.detail !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    activateBuildAddMenuButton(button);
                });
                button.addEventListener('keydown', (event) => {
                    const enabledButtons = buildAddMenuButtons.filter(item => !item.disabled);
                    const buttonIndex = enabledButtons.indexOf(button);
                    let nextIndex = -1;
                    if (event.key === 'ArrowDown') nextIndex = (buttonIndex + 1) % enabledButtons.length;
                    else if (event.key === 'ArrowUp') nextIndex = (buttonIndex - 1 + enabledButtons.length) % enabledButtons.length;
                    else if (event.key === 'Home') nextIndex = 0;
                    else if (event.key === 'End') nextIndex = enabledButtons.length - 1;
                    else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setBuildAddMenuOpen(false, { returnFocus: true });
                        return;
                    } else if (event.key === 'Tab') {
                        event.preventDefault();
                        event.stopPropagation();
                        setBuildAddMenuOpen(false, { returnFocus: true });
                        return;
                    } else if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                        return;
                    }
                    if (nextIndex >= 0) {
                        event.preventDefault();
                        event.stopPropagation();
                        enabledButtons[nextIndex]?.focus();
                    }
                });
            });
            buildAddMenu?.addEventListener('focusout', (event) => {
                if (!buildAddMenu.contains(event.relatedTarget)) setBuildAddMenuOpen(false);
            });
            document.addEventListener('pointerdown', (event) => {
                if (!buildAddMenu || buildAddMenu.hidden || buildAddTools?.contains(event.target)) return;
                setBuildAddMenuOpen(false);
            });
            if (doorClearButton) {
                doorClearButton.addEventListener('click', () => {
                    clearAllDoors();
                    doorClearButton.blur();
                });
            }
            if (npcToggleButton) {
                npcToggleButton.addEventListener('click', () => {
                    toggleNpcEnabled();
                    npcToggleButton.blur();
                });
                updateNpcToggleButton();
            }
            if (clearPlatformsButton) {
                clearPlatformsButton.addEventListener('click', () => {
                    if (!buildSegments.length) {
                        clearPlatformsButton.blur();
                        return;
                    }
                    clearCustomPlatforms();
                    clearPlatformsButton.blur();
                });
            }
            if (copyPlatformsButton) {
                copyPlatformsButton.addEventListener('click', () => {
                    copyPlatformsToClipboard();
                    copyPlatformsButton.blur();
                });
            }
            function worldCoordsFromEvent(event) {
                const rect = gameBoardElement.getBoundingClientRect();
                const screenX = event.clientX - rect.left;
                const screenY = event.clientY - rect.top;
                const worldX = screenX / zoomLevel + camera.x;
                const worldY = screenY / zoomLevel + camera.y;
                return { worldX, worldY };
            }
            function normalizeSegment(start, end, options = {}) {
                const { clamp = true, enforceMin = true } = options;
                if (!start || !end) return null;
                ensurePlatformThickness();
                const clampX = value => clamp ? Math.max(0, Math.min(value, WORLD_WIDTH)) : value;
                const maxTop = WORLD_HEIGHT - blockHeight;
                const clampY = value => clamp ? Math.max(0, Math.min(value, maxTop)) : value;
                const s = { x: clampX(start.x), y: clampY(start.y) };
                const e = { x: clampX(end.x), y: clampY(end.y) };
                const length = Math.hypot(e.x - s.x, e.y - s.y);
                if (enforceMin && length < MIN_SEGMENT_LENGTH) return null;
                return { x1: s.x, y1: s.y, x2: e.x, y2: e.y };
            }
            function beginSegmentDrawing(worldX, worldY) {
                const startPoint = { x: worldX, y: worldY };
                pendingSegment = { start: startPoint, end: { x: worldX, y: worldY } };
                pendingSegmentPreview = null; isDrawingSegment = true;
            }
            function updateSegmentDrawing(worldX, worldY) {
                if (!isDrawingSegment || !pendingSegment) return;
                pendingSegment.end = { x: worldX, y: worldY };
                pendingSegmentPreview = normalizeSegment(pendingSegment.start, pendingSegment.end, { clamp: true, enforceMin: false });
            }
            function finishSegmentDrawing(worldX, worldY) {
                if (!isDrawingSegment || !pendingSegment) return false;
                pendingSegment.end = { x: worldX, y: worldY };
                const segment = normalizeSegment(pendingSegment.start, pendingSegment.end, { clamp: true, enforceMin: true });
                if (segment) {
                    buildSegments.push(segment);
                    recomputePlatforms();
                    saveSegmentsForCurrentBackground();
                    spawnCoinsForCurrentPlatforms();
                }
                pendingSegment = null; pendingSegmentPreview = null; isDrawingSegment = false;
                return !!segment;
            }
            function cancelSegmentDrawing() {
                pendingSegment = null; pendingSegmentPreview = null; isDrawingSegment = false; chainAnchor = null;
            }
            function setPlatformPlacementMode(enabled, options = {}) {
                const shouldEnable = !!enabled && buildModeEnabled;
                cancelSegmentDrawing();
                platformPlacementMode = shouldEnable;
                if (shouldEnable) {
                    clearPendingBuildPlacement();
                    setChairPlacementMode(false);
                    setDoorPlacementMode(false);
                    if (gameBoardElement) gameBoardElement.style.cursor = 'crosshair';
                    showBuildPlacementStatus('Drag across the world to draw a platform');
                    setBuildAddFeedback('Drag from one end of the new platform to the other.');
                } else {
                    if (!pendingBuildPlacementType && gameBoardElement?.style.cursor === 'crosshair') {
                        gameBoardElement.style.cursor = '';
                    }
                    if (!options.keepStatus && buildPlacementStatus) buildPlacementStatus.hidden = true;
                }
                return shouldEnable;
            }
            function isPointNearPlatform(worldX, worldY, platform, margin = 4) {
                if (!platform) return false;
                if (platform.isSlope) {
                    const vx = platform.x2 - platform.x1;
                    const vy = platform.y2 - platform.y1;
                    const lenSq = vx * vx + vy * vy;
                    if (lenSq <= 0) return false;
                    const t = ((worldX - platform.x1) * vx + (worldY - platform.y1) * vy) / lenSq;
                    if (t < 0 || t > 1) return false;
                    const projX = platform.x1 + vx * t;
                    const projY = platform.y1 + vy * t;
                    const dx = worldX - projX;
                    const dy = worldY - projY;
                    const dist = Math.hypot(dx, dy);
                    return dist <= (platform.thickness + margin);
                }
                return worldX >= platform.x - margin && worldX <= platform.x + platform.width + margin &&
                    worldY >= platform.y - margin && worldY <= platform.y + platform.height + margin;
            }
            function removeSegmentAt(worldX, worldY) {
                if (!buildPlatforms.length) return;
                const index = buildPlatforms.findIndex(p => isPointNearPlatform(worldX, worldY, p));
                if (index !== -1) {
                    buildSegments.splice(index, 1);
                    recomputePlatforms();
                    saveSegmentsForCurrentBackground();
                    spawnCoinsForCurrentPlatforms();
                }
            }

            function clearCustomPlatforms() {
                if (!buildSegments.length) return;
                buildSegments = [];
                chainAnchor = null;
                recomputePlatforms();
                saveSegmentsForCurrentBackground();
                spawnCoinsForCurrentPlatforms();
            }

            function formatPlatformsForExport() {
                ensurePlatformThickness();
                if (!buildPlatforms.length) return 'const platforms = [];';
                const round = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
                const entries = buildPlatforms.map(platform => ({
                    x: round(platform.x1 ?? platform.x),
                    y: round(platform.y1 ?? platform.y),
                    x2: round(platform.x2 ?? (platform.x + platform.width)),
                    y2: round(platform.y2 ?? platform.y),
                    width: round(platform.width),
                    height: round(platform.thickness ?? platform.height ?? blockHeight),
                    oneWay: !!platform.oneWay
                }));
                const lines = entries.map(entry =>
                    `  { x: ${entry.x}, y: ${entry.y}, x2: ${entry.x2}, y2: ${entry.y2}, width: ${entry.width}, height: ${entry.height}, oneWay: ${entry.oneWay} }`
                );
                return `const platforms = [\n${lines.join(',\n')}\n];`;
            }

            function copyPlatformsToClipboard() {
                const exportString = formatPlatformsForExport();
                const clipboard = navigator.clipboard;
                if (clipboard?.writeText) {
                    clipboard.writeText(exportString)
                        .then(() => alert('Platform data copied. Paste it into your script file.'))
                        .catch(() => {
                            window.prompt('Copy the platform data:', exportString);
                        });
                } else {
                    window.prompt('Copy the platform data:', exportString);
                }
            }
            if (gameBoardElement) {
                gameBoardElement.addEventListener('pointerdown', (event) => {
                    const { worldX, worldY } = worldCoordsFromEvent(event);
                    if (!buildModeEnabled) {
                        return;
                    }
                    event.preventDefault();
                    setSelectedTextBox(null);
                    if (pendingBuildPlacementType && event.button === 0) {
                        placeBuildItemAt(pendingBuildPlacementType, worldX, worldY);
                        focusGameCanvas();
                        return;
                    }
                    if (doorPlacementMode) {
                        if (event.button === 0) { placeDoorAt(worldX, worldY); return; }
                        if (event.button === 2) { removeDoorAt(worldX, worldY); return; }
                    }
                    if (chairPlacementMode) {
                        if (event.button === 0) { placeChairAt(worldX, worldY); return; }
                        if (event.button === 2) { removeChairAt(worldX, worldY); return; }
                    }
                    if (event.button === 0 && beginPlacedSpinePropDrag(event, worldX, worldY)) return;
                    if (event.button === 2) {
                        const targetProp = findPlacedSpinePropAtPoint(worldX, worldY);
                        if (targetProp) {
                            removePlacedSpineProp(targetProp);
                            cancelSegmentDrawing();
                            return;
                        }
                        const targetButterflySpawn = findButterflySpawnAtPoint(worldX, worldY);
                        if (targetButterflySpawn) {
                            removeButterflySpawn(targetButterflySpawn);
                            cancelSegmentDrawing();
                            return;
                        }
                    }
                    if (event.button === 0 && beginButterflySpawnDrag(event, worldX, worldY)) return;
                    setSelectedPlacedSpineProp(null);
                    if (event.button === 0 && beginBalloonDrag(event, worldX, worldY)) return;
                    setSelectedBuildLayerItem(null, null);
                    if (event.button === 2) { removeSegmentAt(worldX, worldY); cancelSegmentDrawing(); return; }
                    if (event.button === 0 && platformPlacementMode) beginSegmentDrawing(worldX, worldY);
                });
                gameBoardElement.addEventListener('pointermove', (event) => {
                    if (buildModeEnabled && pendingBuildPlacementType) {
                        gameBoardElement.style.cursor = 'crosshair';
                        return;
                    }
                    if (buildModeEnabled && platformPlacementMode && !isDrawingSegment) {
                        gameBoardElement.style.cursor = 'crosshair';
                        return;
                    }
                    if (buildModeEnabled && placedSpinePropDragState.active) {
                        event.preventDefault();
                        const { worldX, worldY } = worldCoordsFromEvent(event);
                        updatePlacedSpinePropDrag(worldX, worldY);
                        return;
                    }
                    if (buildModeEnabled && butterflySpawnDragState.active) {
                        event.preventDefault();
                        const { worldX, worldY } = worldCoordsFromEvent(event);
                        updateButterflySpawnDrag(worldX, worldY);
                        return;
                    }
                    if (buildModeEnabled && balloonDragState.active) {
                        event.preventDefault();
                        const { worldX, worldY } = worldCoordsFromEvent(event);
                        updateBalloonDrag(worldX, worldY);
                        return;
                    }
                    if (buildModeEnabled && !chairPlacementMode && !doorPlacementMode && !isDrawingSegment) {
                        const { worldX, worldY } = worldCoordsFromEvent(event);
                        gameBoardElement.style.cursor = findPlacedSpinePropAtPoint(worldX, worldY)
                            || findButterflySpawnAtPoint(worldX, worldY)
                            || findBalloonAtPoint(worldX, worldY)
                            ? 'grab'
                            : '';
                    }
                    if (buildModeEnabled && isDrawingSegment) { event.preventDefault(); updateSegmentDrawing(worldCoordsFromEvent(event).worldX, worldCoordsFromEvent(event).worldY); }
                });
                window.addEventListener('pointermove', (event) => {
                    if (!textBoxDragState.active) return;
                    updateTextBoxDrag(event);
                });
                window.addEventListener('pointerup', (event) => {
                    if (textBoxDragState.active) {
                        endTextBoxDrag(event);
                        return;
                    }
                    if (placedSpinePropDragState.active) {
                        endPlacedSpinePropDrag(event);
                        return;
                    }
                    if (butterflySpawnDragState.active) {
                        endButterflySpawnDrag(event);
                        return;
                    }
                    if (balloonDragState.active) {
                        endBalloonDrag(event);
                        return;
                    }
                    if (!isDrawingSegment) return;
                    if (event.button === 2) { cancelSegmentDrawing(); return; }
                    const { worldX, worldY } = worldCoordsFromEvent(event);
                    const platformCreated = finishSegmentDrawing(worldX, worldY);
                    if (platformCreated) {
                        setPlatformPlacementMode(false, { keepStatus: true });
                        showBuildPlacementStatus('Platform placed', 1600);
                    } else if (platformPlacementMode) {
                        showBuildPlacementStatus('Drag farther to create the platform');
                    }
                });
                window.addEventListener('pointercancel', (event) => {
                    endTextBoxDrag(event);
                    endPlacedSpinePropDrag(event);
                    endButterflySpawnDrag(event);
                    endBalloonDrag(event);
                    cancelSegmentDrawing();
                });
                gameBoardElement.addEventListener('contextmenu', (event) => { if (buildModeEnabled) event.preventDefault(); });
            }
            function getBackgroundSceneDef(id) {
                return BACKGROUND_SCENES.find(scene => scene.id === id) || BACKGROUND_SCENES[0] || null;
            }

            function addBackgroundOption(sceneDef) {
                if (!backgroundSelect || !sceneDef || Array.from(backgroundSelect.options).some(opt => opt.value === sceneDef.id)) return;
                const option = document.createElement('option');
                option.value = sceneDef.id;
                option.textContent = sceneDef.label || sceneDef.id;
                backgroundSelect.appendChild(option);
            }
            function loadSavedSceneObjects(sceneId) {
                loadSegmentsForBackground(sceneId);
                loadChairsForBackground(sceneId);
                loadDoorsForBackground(sceneId);
                loadBalloonForBackground(sceneId);
                loadPlacedSpinePropsForBackground(sceneId);
                loadTextBoxesForBackground(sceneId);
                loadButterflySpawnsForBackground(sceneId);
            }

            function setBackground(sceneId) {
                const sceneDef = getBackgroundSceneDef(sceneId);
                if (!sceneDef) return Promise.resolve();
                const resolvedSceneId = sceneDef.id;
                const token = ++backgroundLoadToken;
                backgroundLoadAbortController?.abort();
                backgroundLoadAbortController = new AbortController();
                backgroundTileRenderer.clearScene();
                removeBackgroundLayerSurfaces();
                currentBackground = resolvedSceneId;
                if (backgroundSelect && backgroundSelect.value !== resolvedSceneId) backgroundSelect.value = resolvedSceneId;
                backgroundSceneLoaded = false;
                currentBackgroundScene = null;
                if (backgroundLoadResolvers.length) backgroundLoadResolvers.splice(0).forEach((resolve) => resolve());
                backgroundLoadPromise = new Promise((resolve) => {
                    backgroundLoadResolvers.push(resolve);
                });
                loadPsdBackgroundScene(sceneDef, backgroundLoadAbortController.signal)
                    .then(async (scene) => {
                        if (token !== backgroundLoadToken) return;
                        currentBackgroundScene = scene;
                        syncBackgroundLayerSurfaces(scene);
                        WORLD_WIDTH = scene.width;
                        WORLD_HEIGHT = scene.height;
                        applyWorldDimensionSideEffects();
                        loadSavedSceneObjects(resolvedSceneId);
                        const fallbackReady = await backgroundTileRenderer.setScene(scene);
                        if (token !== backgroundLoadToken) return;
                        if (!fallbackReady) {
                            console.warn(`Background fallback tiles will retry while rendering: ${resolvedSceneId}`);
                        }
                        backgroundSceneLoaded = true;
                        resolveBackgroundLoad();
                    })
                    .catch((error) => {
                        if (token !== backgroundLoadToken) return;
                        if (error?.name === 'AbortError') return;
                        console.error('Failed to load background scene:', error);
                        backgroundTileRenderer.clearScene();
                        removeBackgroundLayerSurfaces();
                        backgroundSceneLoaded = false;
                        currentBackgroundScene = null;
                        WORLD_WIDTH = DEFAULT_WORLD_WIDTH;
                        WORLD_HEIGHT = DEFAULT_WORLD_HEIGHT;
                        applyWorldDimensionSideEffects();
                        loadSavedSceneObjects(resolvedSceneId);
                        resolveBackgroundLoad();
                    });
                return backgroundLoadPromise;
            }
            if (backgroundSelect) {
                backgroundSelect.addEventListener('change', () => { if (backgroundSelect.value && backgroundSelect.value !== currentBackground) setBackground(backgroundSelect.value); });
            }
            function discoverBackgrounds() {
                if (backgroundSelect) backgroundSelect.innerHTML = '';
                BACKGROUND_SCENES.forEach(addBackgroundOption);
                const fallback = BACKGROUND_SCENES[0];
                if (fallback) {
                    if (backgroundSelect) backgroundSelect.value = fallback.id;
                    setBackground(fallback.id);
                }
            }

            function cycleBackgroundForDoorRush() {
                if (!Array.isArray(BACKGROUND_SCENES) || !BACKGROUND_SCENES.length) return;
                const currentIndex = BACKGROUND_SCENES.findIndex(scene => scene.id === currentBackground);
                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % BACKGROUND_SCENES.length : 0;
                const nextScene = BACKGROUND_SCENES[nextIndex] || BACKGROUND_SCENES[0];
                if (!nextScene) return;
                // Persist current door layout onto the next background so the door stays aligned.
                saveDoorsForCurrentBackground();
                cachedDoorData[nextScene.id] = doorPlacements.map(door => ({
                    id: door.id,
                    x: door.x,
                    y: door.y,
                    scale: door.scale
                }));
                const promise = setBackground(nextScene.id);
                setTimeout(() => rebindDoorRushDoor(), 0);
                return promise;
            }
            // --- Spine Player Animations ---
            let DRIVINGSPEED = 0;

            const ANIM_IDLE = "GameAnims/game_idle_breathing_loop";
            const ANIM_HARVEST = "GameAnims/game_harvest";
            const ANIM_EDGE_UNBALANCED = "GameAnims/game_unbalancedLoop";
            let EDGE_PROXIMITY_THRESHOLD = 2; // Distance in px from a platform edge before triggering the unbalanced loop
            const WIND_LEFT_ANIMATION = "GameAnims/game_wind_right";
            const WIND_RIGHT_ANIMATION = "GameAnims/game_wind_left";
            const WIND_TRACK_INDEX = 1;

            const LANDING_OVERLAY_TRACK_INDEX = 2;
            const LANDING_OVERLAY_BLEND_IN = 0.12;
            const LANDING_OVERLAY_BLEND_OUT = 0.2;


            const LANDING_TOO_HARD_BLEND_IN = 0.01;
            const LANDING_TOO_HARD_BLEND_OUT = 0.15;
            const LANDING_TOO_HARD_BLEND_START = 0.6; // fraction of hard-landing anim before blending to movement
            const LANDING_TOO_HARD_INPUT_LOCK_FRACTION = 0.15; // portion of hard landing to keep inputs blocked
            const LANDING_MOMENTUM_MIN_SPEED = 300;
            const LANDING_MOMENTUM_DECEL = 2200;
            const LANDING_MOMENTUM_MAX_SPEED = PLAYER_RUN_SPEED * 1.1;
            const LANDING_MOMENTUM_STOP_EPSILON = 40;


            const STOP_OVERLAY_TRACK_INDEX = 3;
            const STOP_OVERLAY_BLEND_IN = 0.08;
            const STOP_OVERLAY_BLEND_OUT = 0.14;

            
            const TALK_TRACK_INDEX = 4;
            const EMOTE_TRACK_INDEX = 5;
            const SWORD_TRACK_INDEX = 6;
            const TALK_LIP_SYNC_TRACK_INDEX = 7;
            const SWORD_UNSHEATH_ANIMATION = "GameAnims/game_weapon_unsheath";
            const SWORD_HOLD_ANIMATION = "GameAnims/game_weapon_hold";
            const SWORD_SHEATH_ANIMATION = "GameAnims/game_weapon_sheath";
            const SWORD_ATTACK_ANIMATION = "GameAnims/game_weapon_swing";
            const SWORD_HITBOX_WIDTH = 120;
            const SWORD_HITBOX_HEIGHT = 90;
            const SWORD_HITBOX_FORWARD_OFFSET = -250;
            const SWORD_HITBOX_VERTICAL_OFFSET = -200;
            const SWORD_HITBOX_FLASH_TIME = 0.1;
            const SWORD_HITBOX_FREEZE_DURATION = 0.3;
            const TALK_TRANSITION_DISCOVERY_OPTIONS = Object.freeze({
                homePose: 'H',
                categoryWeights: Object.freeze({
                    homeSelf: 3,
                    homeExit: 7,
                    self: 2,
                    homeReturn: 2,
                    explore: 8
                })
            });
            const TALK_FALLBACK_ANIMATION_NAMES = Object.freeze([
                "GameAnims/game_talkLoop_neutral",
                "GameAnims/Talking/game_talkLoop_excited_ALLSEGMENTS"
            ]);
            const TALK_LIP_SYNC_ANIMATION_NAMES = Object.freeze([
                "GameAnims/game_talkLoop_LipSyncOnly",
                "GameAnims/game_talkLoop_LipSyncOnly_sad"
            ]);
            const TALK_LIP_SYNC_SWITCH_DELAY = Object.freeze({ min: 2.4, max: 5.2 });
            const BLINK_TRACK_INDEX = 15;
            const BLINK_ANIMATION_NAME = "GameAnims/blink";
            const JETPACK_TRACK_INDEX = 16;
            const JETPACK_WEAR_ANIMATION = "GameAnims/game_jetpack_wearLoop";
            const JETPACK_FLY_ANIMATION = "GameAnims/game_jetpack_flyLoop";
            const JETPACK_REMOVE_ANIMATION = "GameAnims/game_jetpack_remove";
            const BLINK_MIN_DELAY = 1.0;
            const BLINK_MAX_DELAY = 5.5;
            const RANDOM_ANIMATION_TEST_FALLBACK_PADDING_MS = 180;
            const RANDOM_ANIMATION_TEST_MIN_DURATION_MS = 100;
            const BLINK_ANIMATION_BLOCKLIST = new Set([
                "GameAnims/game_runLoop_cute_02 girly",
                "GameAnims/game_runLoop_cute_03 skip",
                "GameAnims/game_walkloop_neutral_02 stomp",
                "BankingAnims/BankIdle02_B_phoneLoop",
                "BankingAnims/BankIdle02_C_phoneStop",
                "BankingAnims/BankIdle03_B_lieLoop",
                "dozing-start-neutral",
                "dozing-start-neutral-loop",
                "dozing-wake-neutral",
                "GameAnims/game_walkloop_cute_03_dblBounce",
                "GameAnims/game_drivingLoop",

                "sticker-angry-001",
                "sticker-confused-001",
                "sticker-love-001",
                "sticker-sad-001",
                "sticker-shock-001",
                "TestAnims/jumpingLoop",
                "TestAnims/sticker-confused-001_long",
                "annoyed-neutral",
                "BankingAnims/BankNoticeCoin_L_04",
                "annoyed-neutral",
                "DanceAnims/celebrate_dance_001",
                "DanceAnims/celebrate_dance_002",
                "DanceAnims/celebrate_dance_003",
                "DanceAnims/celebrate_dance_004",
                "DanceAnims/celebrate_dance_005",
                "GameAnims/game_walkLoop_gojo",
                "GameAnims/game_walkLoop_geto",
                "GameAnims/game_walkLoop_gojo_fast",
                "GameAnims/game_walkLoop_geto_fast",
                "GameAnims/game_sit1Begin",
                "GameAnims/game_sit1Cycle",
                "GameAnims/game_sit1End",
                "GameAnims/game_enterDoor"


                // NEED TO ADD MORE IN HERE!!! NEED MORE no blinking 


            ]);
            const FIDGET_IDLE_DELAY = 180;
            const FIDGET_SPEED_THRESHOLD = 0.05;
            const FIDGET_SEQUENCES = [
                { key: 'dozing', start: "dozing-start-neutral", loop: "dozing-start-neutral-loop", stop: "dozing-wake-neutral" },
                { key: 'phone', start: "BankingAnims/BankIdle02_A_phoneStart", loop: "BankingAnims/BankIdle02_B_phoneLoop", stop: "BankingAnims/BankIdle02_C_phoneStop" },
                { key: 'lieDown', start: "BankingAnims/BankIdle03_A_lieStart", loop: "BankingAnims/BankIdle03_B_lieLoop", stop: "BankingAnims/BankIdle03_C_lieStop" },

            ];
            const EMOTE_ANIMATIONS = [
                { animation: "sticker-angry-001", label: "Angry" },
                { animation: "sticker-confused-001", label: "Confused" },
                { animation: "DanceAnims/celebrate_dance_001", label: "Dance 1" },
                { animation: "DanceAnims/celebrate_dance_002", label: "Dance 2" },
                { animation: "DanceAnims/celebrate_dance_003", label: "Dance 3" },
                { animation: "DanceAnims/celebrate_dance_004", label: "Dance 4" },
                { animation: "DanceAnims/celebrate_dance_005", label: "Dance 5" },

                { animation: "sticker-love-001", label: "Love" },
                { animation: "sticker-sad-001", label: "Sad" },
                { animation: "sticker-shock-001", label: "Shock" },
                { animation: "TestAnims/jumpingLoop", label: "Jump Loop" },
                { animation: "TestAnims/sticker-confused-001_long", label: "Confused Long" },
                { animation: "annoyed-neutral", label: "Annoyed" },
                { animation: "BankingAnims/BankNoticeCoin_L_04", label: "Coin Notice" }
            ];
            const EMOTE_LOOP_COUNT = 15;
            const EMOTE_ACTIVATION_KEY = 'e';


            const ANIMATION_SETS = {
                // ANIMATION SET 1
                 neutral: {
                    displayName: 'Neutral',
                    run: [
                        "GameAnims/game_runLoop_neutral_02",
                        "GameAnims/game_runLoop_neutral_03_fish"],
                    walk: [
                        "GameAnims/game_walkloop_neutral_01",
                        "GameAnims/game_walkloop_neutral_02 stomp",
                        "GameAnims/game_walkloop_neutral_03 float",

                    ],

                    movement: {
                        walkSpeed: 355 * SPEED_SCALE_FACTOR,
                        runSpeed: 655 * SPEED_SCALE_FACTOR
                    }
                },


                // ANIMATION SET 2
                cute: {
                    displayName: 'Cute',
                    run: ["GameAnims/game_runLoop_cute_01 prance",
                        "GameAnims/game_runLoop_cute_02 girly",
                        "GameAnims/game_runLoop_cute_03 skip",
                        "GameAnims/game_runLoop_cute_04 naruto",
                        "GameAnims/game_runloop_cute_04_longLegs",
                        "GameAnims/game_drivingLoop",
                        "GameAnims/game_runLoop_work"
                    ],
                    walk: ["GameAnims/game_walkloop_cute_02",

                        "GameAnims/game_walkloop_cute_03_dblBounce",
                        "GameAnims/game_walkLoop_gojo_fast",
                        "GameAnims/game_walkLoop_geto_fast",
                    ],
                    movement: {
                        walkSpeed: 355 * SPEED_SCALE_FACTOR,
                        runSpeed: 655 * SPEED_SCALE_FACTOR
                    }
                },




               


                // ANIMATION SET 3
                gojogeto: {
                    displayName: 'gojogeto',
                    run: [
                        "GameAnims/game_runLoop_neutral_02",

                    ],
                    walk: [
                        "GameAnims/game_walkLoop_gojo",
                        "GameAnims/game_walkLoop_geto",



                    ],

                    movement: {
                        walkSpeed: 355 * SPEED_SCALE_FACTOR / 4.5,
                        runSpeed: 655 * SPEED_SCALE_FACTOR
                    }
                },





            };
            const DEFAULT_ANIMATION_SET_KEY = 'cute';
            function getDefaultAnimation(setKey, category) {
                const set = ANIMATION_SETS[setKey];
                if (set && Array.isArray(set[category]) && set[category].length) return set[category][0];
                const fallbackSet = Object.values(ANIMATION_SETS).find(entry => Array.isArray(entry[category]) && entry[category].length);
                return fallbackSet ? fallbackSet[category][0] : "";
            }
            let ANIM_RUN = getDefaultAnimation(DEFAULT_ANIMATION_SET_KEY, 'run');
            let ANIM_WALK = getDefaultAnimation(DEFAULT_ANIMATION_SET_KEY, 'walk');
            let currentAnimationSetKey = DEFAULT_ANIMATION_SET_KEY;
            let currentMovementConfig = null;
            const animationSelectionCache = {};
            const ANIM_LIE_START = "BankingAnims/BankIdle03_A_lieStart", ANIM_LIE_LOOP = "BankingAnims/BankIdle03_B_lieLoop", ANIM_LIE_STOP = "BankingAnims/BankIdle03_C_lieStop";
            const ANIM_SIT_BEGIN = "GameAnims/game_sit1Begin", ANIM_SIT_LOOP = "GameAnims/game_sit1Cycle", ANIM_SIT_END = "GameAnims/game_sit1End";
            const ANIM_JUMP_UP = "GameAnims/game_jumpUp", ANIM_JUMP_UP_LOOP = "GameAnims/game_jumpUpLoop", ANIM_JUMP_FALL = "GameAnims/game_jumpFall", ANIM_JUMP_FALL_LOOP = "GameAnims/game_jumpFallLoop", ANIM_JUMP_LAND = "GameAnims/game_jumpLand", ANIM_JUMP_LAND_MOVING = "GameAnims/game_jumpLandWhileMoving", ANIM_DOUBLE_JUMP_UP = "GameAnims/game_jumpUp2nd", ANIM_DOUBLE_JUMP_UP_LOOP = "GameAnims/game_jumpUp2ndLoop", ANIM_DOUBLE_JUMP_FALL = "GameAnims/game_jumpFall2nd", ANIM_DOUBLE_JUMP_FALL_LOOP = "GameAnims/game_jumpFallLoop2nd", ANIM_DOUBLE_JUMP_LAND = "GameAnims/game_jumpLand2nd", ANIM_JUMP_LAND_TOO_HARD = "GameAnims/game_jumpLandTooHard";
            const ANIM_STOP_INERTIA_WALK = "GameAnims/game_stopInertiaWalk", ANIM_STOP_INERTIA_RUN = "GameAnims/game_stopInertiaRun";
            const ANIM_SLIDE = "GameAnims/game_slidingLoop";
            const ANIM_SKID = "GameAnims/game_skid";
            const ANIM_ENTER_DOOR = "GameAnims/game_enterDoor";
            const SKID_BLEND_ALPHA = 0.9; // controls how strongly the skid anim mixes in
            const SITTING_MOVE_DURATION = 0.4;
            const SITTING_POSITION = { x: 0, y: -40 }; // tweak offsets for chair alignment
            const SITTING_EASE_IN = 3;
            const SITTING_EASE_OUT = 3;
            const SITTING_PROMPT_OFFSET = { x: 0, y: -1080 }; // tweak prompt offsets relative to player hitbox

            // --- Game State ---
            let spinePlayer;
            let player = { x: 6000, y: 6000, vx: 0, vy: 0, width: PLAYER_HITBOX_WIDTH, height: PLAYER_HITBOX_HEIGHT, onGround: false, facingRight: false, currentAnimation: ANIM_IDLE, isRunning: false, jumpHeld: false, isJumping: false, jumpHoldTime: 0, lieState: 'none', fidgetState: 'none', sitState: 'none', sitTimer: 0, sitStartX: 0, sitStartY: 0, sitTargetX: 0, sitTargetY: 0, sittingChair: null, sitExitMoveDone: false, sitExitAnimDone: false, doorState: 'none', jumpUpIntroPlayed: false, fallIntroPlayed: false, isLandingAnimation: false, groundAnimCooldown: 0, landingInputLockTimer: 0, lastLandingImpactSpeed: 0, landingTooHard: false, landingHardBlendTriggered: false, isMoving: false, previousMoveType: 'idle', lastMoveType: 'idle', currentPlatform: null, airJumpAvailable: true, hasDoubleJumped: false, doubleJumpFallGrace: 0, isSkidding: false, landingMomentumVx: 0 };

            const mountController = window.AnimeeMountModes?.create({
                player,
                getJoystick: () => joystickState,
                isActionActive,
                setIdleAnimation: () => setSpineAnimation(ANIM_IDLE, true),
                setLoopAnimation: (animationName) => setSpineAnimation(animationName, true),
                setFrozenAnimation: (animationName, frameTime) => {
                    const animationState = spinePlayer?.animationState;
                    const skeleton = spinePlayer?.skeleton;
                    if (!animationState || !skeleton?.data?.findAnimation?.(animationName)) return;
                    const targetTime = Math.max(0, Number(frameTime) || 0);
                    const current = animationState.getCurrent?.(0);
                    if (current?.animation?.name === animationName
                        && current.timeScale === 0
                        && Math.abs((current.trackTime || 0) - targetTime) < 0.0001) return;
                    const entry = setLoggedAnimation(0, animationName, false, animationState);
                    if (!entry) return;
                    entry.trackTime = targetTime;
                    entry.timeScale = 0;
                    entry.alpha = 1;
                    entry.mixDuration = 0;
                    player.currentAnimation = animationName;
                    animationState.apply?.(skeleton);
                },
                playAnimationOnce: (animationName, onComplete) => playSpineAnimationOnce(animationName, 0, onComplete),
                playAnimationWithEvents: (animationName, onEvent, onComplete) =>
                    playMountAnimationWithEvents(animationName, onEvent, onComplete),
                getBoneRotation: (boneName) => {
                    const bone = spinePlayer?.skeleton?.findBone?.(boneName);
                    const rotation = bone?.appliedPose?.rotation
                        ?? bone?.pose?.rotation
                        ?? bone?.rotation;
                    return Number.isFinite(rotation) ? rotation : 0;
                },
                stopJetpackVisibility: () => {
                    const wasEnabled = jetpackState.enabled;
                    jetpackState.enabled = false;
                    jetpackState.thrusting = false;
                    if (wasEnabled) playJetpackRemoveAnimation();
                    else if (!jetpackState.removing) clearJetpackTrack();
                    updateJetpackModeButton();
                },
                setJetpackEnabled: (enabled) => {
                    const nextEnabled = Boolean(enabled);
                    if (jetpackState.enabled === nextEnabled && (!jetpackState.thrusting || nextEnabled)) return;
                    jetpackState.enabled = nextEnabled;
                    if (!nextEnabled) {
                        jetpackState.thrusting = false;
                        clearJetpackTrack();
                    } else if (jetpackState.removing) {
                        clearJetpackTrack();
                    }
                    updateJetpackModeButton();
                },
                getZoom: () => zoomLevel,
                setZoom: (value) => setZoom(value)
            });

            function syncPlayerSkeletonScale() {
                const skeleton = spinePlayer?.skeleton;
                if (!skeleton) return;
                skeleton.scaleX = (player.facingRight ? 1 : -1) * PLAYER_SKELETON_VISUAL_SCALE;
                skeleton.scaleY = PLAYER_SKELETON_VISUAL_SCALE;
            }

            function getPlayerRootWorldPosition() {
                const root = spinePlayer?.skeleton?.getRootBone?.();
                const spineCamera = spinePlayer?.sceneRenderer?.camera;
                if (!root || !spineCamera) return null;
                const rootX = Number(root.worldX ?? root.appliedPose?.worldX);
                const rootY = Number(root.worldY ?? root.appliedPose?.worldY);
                const visibleWidth = Number(spineCamera.viewportWidth) * Number(spineCamera.zoom);
                const visibleHeight = Number(spineCamera.viewportHeight) * Number(spineCamera.zoom);
                const cameraX = Number(spineCamera.position?.x);
                const cameraY = Number(spineCamera.position?.y);
                if (![rootX, rootY, visibleWidth, visibleHeight, cameraX, cameraY].every(Number.isFinite)
                    || visibleWidth <= 0 || visibleHeight <= 0) return null;
                const normalizedX = (rootX - (cameraX - visibleWidth * 0.5)) / visibleWidth;
                const normalizedY = 1 - ((rootY - (cameraY - visibleHeight * 0.5)) / visibleHeight);
                return {
                    x: playerContainerWorldBounds.left + normalizedX * playerContainerWorldBounds.width,
                    y: playerContainerWorldBounds.top + normalizedY * playerContainerWorldBounds.height
                };
            }

            let playerSpawnPositionApplied = false;
            let playerTiltAngleDeg = 0;
            const slopeSlideState = { active: false, targetTiltDeg: 0 };
            const jetpackState = { enabled: false, thrusting: false, fuel: JETPACK_MAX_FUEL, removing: false };
            let currentWindOverlay = null;
            let currentLandingOverlayEntry = null;
            let currentStopOverlayEntry = null;
            let currentTalkEntry = null;
            let currentTalkAnimationName = '';
            let talkTransitionController = null;
            let talkSpeechActive = false;
            let manualTalkingActive = false;
            let currentTalkLipSyncEntry = null;
            let talkLipSyncVariantIndex = 0;
            let talkLipSyncSwitchTimer = 0;
            let currentBlinkEntry = null;
            let pendingFacingRight = null;
            let pendingFacingFlipTimer = 0;
            let debugPrevHasDoubleJumped = player.hasDoubleJumped;
            let debugPrevFallIntroPlayed = player.fallIntroPlayed;
            let debugPrevAirJumpAvailable = player.airJumpAvailable;
            const swordModeState = { active: false, busy: false, holdEntry: null, unsheathEntry: null, sheathEntry: null, attackEntry: null };
            let swordHitboxRect = null;
            let swordHitboxFlashTimer = 0;
            let blinkTimer = randomFloat(BLINK_MIN_DELAY, BLINK_MAX_DELAY);
            let inactivityTimer = 0;
            let currentFidgetSequence = null;
            let emoteMenuController = null;
            const emotePlayback = { active: false, animationName: '', loopsRemaining: 0, entry: null, trackIndex: EMOTE_TRACK_INDEX, previousBase: null };
            const randomAnimationTestState = { active: false, token: 0, currentEntry: null, fallbackTimerId: null, lastAnimationName: '' };
            const animationTrackLog = {};
            initializeAnimationControls();
            let lastTime = 0;
            let playerColors = null;
            let coinsCollected = 0;
            const playerContainerScreen = { left: 0, top: 0, width: 0, height: 0 };
            const playerContainerWorldBounds = { left: 0, top: 0, width: PLAYER_VISUAL_WIDTH, height: PLAYER_VISUAL_HEIGHT };
            let zoomLevel = DEFAULT_ZOOM;
            let playerSpineRenderZoom = SPINE_CANVAS_RENDER_ZOOM;
            let playerSpineQualityTimer = 0;
            let pendingZoomWheelDelta = 0;
            let zoomWheelFrame = 0;
            let camera = { x: 0, y: 0, targetX: 0, targetY: 0, lerpFactor: 0.04, kickY: 0, kickDecay: 0.8, offsetX: 0, offsetY: 0, isDragging: false, lastPointerX: 0, lastPointerY: 0 };
            let cameraTrackingEnabled = true;
            updateMouseTrackerDisplay();
            let sitPromptChair = null;

            function centerCameraOnPlayer() {
                const leadFactor = 0.03;
                const leadX = player.facingRight ? player.width * leadFactor : -player.width * leadFactor;
                const visibleWidth = CANVAS_WIDTH / zoomLevel;
                const visibleHeight = CANVAS_HEIGHT / zoomLevel;
                const desiredX = player.x + player.width / 2 - visibleWidth / 2 + leadX + camera.offsetX;
                const desiredY = player.y + player.height / 2 - visibleHeight / 2 - 50 + camera.offsetY;
                const maxCamX = Math.max(0, WORLD_WIDTH - visibleWidth);
                const maxCamY = Math.max(0, WORLD_HEIGHT - visibleHeight);
                camera.x = Math.max(0, Math.min(desiredX, maxCamX));
                camera.y = Math.max(0, Math.min(desiredY, maxCamY));
                camera.targetX = camera.x; camera.targetY = camera.y;
                updatePlayerContainerPosition();
            }

            function recenterCameraOnPlayer() {
                setZoom(DEFAULT_ZOOM);
                cameraTrackingEnabled = true;
                camera.offsetX = 0;
                camera.offsetY = 0;
                camera.isDragging = false;
                centerCameraOnPlayer();
                updateCameraTrackingButton();
            }

            const keys = {};
            const touchActionPointers = new Map();
            const ACTION_KEY_MAP = Object.freeze({
                left: ['a', 'arrowleft'],
                right: ['d', 'arrowright'],
                jump: [' ', 'w', 'arrowup'],
                run: ['shift', 'shiftleft', 'shiftright'],
                descend: ['s', 'arrowdown'],
                chat: ['t']
            });

            function isActionActive(action) {
                const keyboardKeys = ACTION_KEY_MAP[action] || [];
                const keyboardActive = keyboardKeys.some((key) => Boolean(keys[key]));
                const touchActive = (touchActionPointers.get(action)?.size || 0) > 0;
                return keyboardActive || touchActive;
            }

            function setTouchAction(action, pointerId, active) {
                if (!action) return;
                if (active && action !== 'chat' && manualTalkingActive) {
                    setManualTalkingActive(false);
                }
                const pointers = touchActionPointers.get(action) || new Set();
                if (active) {
                    pointers.add(pointerId);
                    touchActionPointers.set(action, pointers);
                } else {
                    pointers.delete(pointerId);
                    if (pointers.size) touchActionPointers.set(action, pointers);
                    else touchActionPointers.delete(action);
                }
                recordUserActivity();
            }

            function clearTouchActions() {
                touchActionPointers.clear();
                document.querySelectorAll('.mobile-action.is-active').forEach((button) => {
                    button.classList.remove('is-active');
                });
            }

            const joystickState = { active: false, identifier: null, centerX: 0, centerY: 0, x: 0, y: 0, strength: 0 };
            let touchCameraGestureActive = false;
            const toggleDebugButton = document.getElementById('toggle-debug-btn');
            const debugInfoElement = document.getElementById('debug-info');
            let debugInfoVisible = false;
            let uiHidden = false;
            let viewportResizeFrame = 0;

            function resizeGameViewport() {
                const nextWidth = Math.max(1, Math.floor(window.innerWidth || document.documentElement.clientWidth || 990));
                const nextHeight = Math.max(1, Math.floor(window.innerHeight || document.documentElement.clientHeight || 990));
                const sizeChanged = nextWidth !== CANVAS_WIDTH
                    || nextHeight !== CANVAS_HEIGHT
                    || canvas.width !== nextWidth
                    || canvas.height !== nextHeight;

                CANVAS_WIDTH = nextWidth;
                CANVAS_HEIGHT = nextHeight;
                gameWrapper.style.width = `${CANVAS_WIDTH}px`;
                gameWrapper.style.height = `${CANVAS_HEIGHT}px`;
                gameBoardElement.style.width = `${CANVAS_WIDTH}px`;
                gameBoardElement.style.height = `${CANVAS_HEIGHT}px`;

                if (sizeChanged) {
                    canvas.width = CANVAS_WIDTH;
                    canvas.height = CANVAS_HEIGHT;
                }
                resizeBackgroundLayerSurfaces();
                resizePlatformOverlay();
                resizeAmbientLeafOverlay();

                spinePlayer?.resize?.();
                doors.forEach((door) => door?.spinePlayer?.resize?.());
                balloons.forEach((targetBalloon) => targetBalloon?.spinePlayer?.resize?.());
                placedSpineProps.forEach((prop) => prop?.spinePlayer?.resize?.());
                beaverNpcController?.resize?.();
                updateTextBoxContainers();
                updateButterflySpawnContainers();
                if (cameraTrackingEnabled) centerCameraOnPlayer();
                else clampCameraPosition();
                updateMouseTrackerDisplay();
            }

            function scheduleGameViewportResize() {
                if (viewportResizeFrame) cancelAnimationFrame(viewportResizeFrame);
                viewportResizeFrame = requestAnimationFrame(() => {
                    viewportResizeFrame = 0;
                    resizeGameViewport();
                });
            }

            function initGameElements() {
                setupPlatformOverlay();
                setupAmbientLeafOverlay();
                resizeGameViewport();
                window.addEventListener('resize', scheduleGameViewportResize);
                playerContainerElement.style.transformOrigin = 'top left';

                if (toggleDebugButton && debugInfoElement) {
                    debugInfoElement.style.display = 'none';
                    toggleDebugButton.textContent = 'Show Debug';
                    toggleDebugButton.addEventListener('click', () => {
                        debugInfoVisible = !debugInfoVisible;
                        debugInfoElement.style.display = debugInfoVisible ? 'block' : 'none';
                        toggleDebugButton.textContent = debugInfoVisible ? 'Hide Debug' : 'Show Debug';
                    });
                }
                if (toggleUiButton && uiControls) {
                    const compactTools = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;
                    if (compactTools) {
                        uiHidden = true;
                        uiControls.classList.add('ui-hidden');
                    }
                    const syncToolsButtonLabel = () => {
                        toggleUiButton.textContent = compactTools
                            ? (uiHidden ? 'TOOLS' : 'CLOSE')
                            : (uiHidden ? 'Show UI' : 'Hide UI');
                        toggleUiButton.setAttribute('aria-expanded', String(!uiHidden));
                    };
                    syncToolsButtonLabel();
                    toggleUiButton.addEventListener('click', () => {
                        uiHidden = !uiHidden;
                        uiControls.classList.toggle('ui-hidden', uiHidden);
                        syncToolsButtonLabel();
                        toggleUiButton.blur();
                        focusGameCanvas();
                    });
                }
                if (randomizeColorsButton) {
                    randomizeColorsButton.addEventListener('click', () => {
                        if (spinePlayer && spinePlayer.skeleton) {
                            playerColors = generateCharacterColors(playerColors, { skin: true, hair: true, eyes: true });
                            applyAttachmentColors(spinePlayer.skeleton, playerColors);
                        }
                        randomizeColorsButton.blur();
                    });
                }
                if (randomAnimationTestButton) {
                    updateRandomAnimationTestButton();
                    randomAnimationTestButton.addEventListener('click', () => {
                        toggleRandomAnimationTest();
                        randomAnimationTestButton.blur();
                        focusGameCanvas();
                    });
                }
                if (backgroundToggleButton) {
                    backgroundToggleButton.addEventListener('click', () => {
                        backgroundVisible = !backgroundVisible;
                        updateBackgroundToggleButton();
                    });
                    updateBackgroundToggleButton();
                }
                if (cameraTrackingButton) {
                    updateCameraTrackingButton();
                    cameraTrackingButton.addEventListener('click', () => {
                        cameraTrackingEnabled = !cameraTrackingEnabled;
                        camera.targetX = camera.x;
                        camera.targetY = camera.y;
                        updateCameraTrackingButton();
                        cameraTrackingButton.blur();
                        focusGameCanvas();
                    });
                }
                if (cameraRecenterButton) {
                    cameraRecenterButton.addEventListener('click', () => {
                        recenterCameraOnPlayer();
                        cameraRecenterButton.blur();
                        focusGameCanvas();
                    });
                }
                if (jetpackModeButton) {
                    updateJetpackModeButton();
                    jetpackModeButton.addEventListener('click', () => {
                        const wasEnabled = jetpackState.enabled;
                        jetpackState.enabled = !jetpackState.enabled;
                        if (!jetpackState.enabled) {
                            jetpackState.thrusting = false;
                            if (wasEnabled) {
                                playJetpackRemoveAnimation();
                            }
                        } else if (jetpackState.removing) {
                            clearJetpackTrack();
                        }
                        if (jetpackState.fuel > JETPACK_MAX_FUEL) {
                            jetpackState.fuel = JETPACK_MAX_FUEL;
                        }
                        updateJetpackModeButton();
                        jetpackModeButton.blur();
                        focusGameCanvas();
                    });
                }
                if (gameWrapper) {
                    gameWrapper.addEventListener('wheel', handleZoomWheel, { passive: false });
                    gameWrapper.addEventListener('mousedown', startCameraPan);
                    gameWrapper.addEventListener('mouseleave', stopCameraPan);
                }
                initializeEmoteMenu();
                setupMobileControls();
                setupTouchCameraGestures();
            }

            function initializeEmoteMenu() {
                if (!window.EmoteMenuManager || emoteMenuController || !gameBoardElement) return;
                emoteMenuController = window.EmoteMenuManager.create({
                    parent: gameBoardElement,
                    items: EMOTE_ANIMATIONS,
                    radius: 220,
                    onSelect: handleEmoteSelection
                });
                document.addEventListener('pointerdown', (event) => {
                    if (!emoteMenuController?.isVisible()) return;
                    const target = event.target;
                    const root = typeof emoteMenuController.getRoot === 'function' ? emoteMenuController.getRoot() : emoteMenuController.root;
                    if (target instanceof Node && root && root.contains(target)) return;
                    emoteMenuController.hide();
                });
            }

            function isEmotePlaying() {
                return emotePlayback.active;
            }

            function handleEmoteSelection(animationName) {
                if (!animationName) return;
                playEmoteAnimation(animationName);
            }

            function playEmoteAnimation(animationName, loopCount = EMOTE_LOOP_COUNT) {
                if (!spinePlayer?.animationState || !spinePlayer?.skeleton?.data) return;
                if (!spinePlayer.skeleton.data.findAnimation(animationName)) {
                    console.warn(`[EmoteMenu] Animation not found: ${animationName}`);
                    return;
                }
                const requestedLoopCount = Math.max(1, Math.floor(loopCount));
                if (emotePlayback.active && emotePlayback.animationName === animationName) {
                    emotePlayback.loopsRemaining = requestedLoopCount;
                    return;
                }
                if (emotePlayback.active) {
                    cancelEmotePlayback();
                }
                const baseEntry = spinePlayer.animationState.getCurrent(0);
                if (baseEntry?.animation) {
                    emotePlayback.previousBase = {
                        name: baseEntry.animation.name,
                        loop: baseEntry.loop === true,
                        trackTime: baseEntry.trackTime ?? 0
                    };
                } else {
                    emotePlayback.previousBase = null;
                }
                const trackIndex = emotePlayback.trackIndex ?? EMOTE_TRACK_INDEX;
                const entry = setLoggedAnimation(trackIndex, animationName, true);
                if (!entry) return;
                entry.alpha = 1;
                entry.mixDuration = 0;
                entry.mixTime = 0;
                emotePlayback.active = true;
                emotePlayback.animationName = animationName;
                emotePlayback.loopsRemaining = requestedLoopCount;
                emotePlayback.entry = entry;
                emotePlayback.trackIndex = trackIndex;
                const previousComplete = entry.listener?.complete;
                entry.listener = entry.listener || {};
                entry.listener.complete = (trackEntry) => {
                    if (typeof previousComplete === 'function') {
                        previousComplete(trackEntry);
                    }
                    if (!emotePlayback.active || trackEntry !== emotePlayback.entry) return;
                    emotePlayback.loopsRemaining -= 1;
                    if (emotePlayback.loopsRemaining <= 0) {
                        finishEmotePlayback();
                    }
                };
            }

            function playHarvestAnimation() {
                playEmoteAnimation(ANIM_HARVEST, 1);
            }

            function finishEmotePlayback() {
                if (!emotePlayback.active) return;
                const trackIndex = typeof emotePlayback.entry?.trackIndex === 'number' ? emotePlayback.entry.trackIndex : (emotePlayback.trackIndex ?? EMOTE_TRACK_INDEX);
                if (emotePlayback.entry && emotePlayback.entry.listener) {
                    emotePlayback.entry.listener.complete = null;
                }
                if (spinePlayer?.animationState) {
                    clearTrackLogged(trackIndex, spinePlayer.animationState);
                }
                // NEW: Reset the skeleton to the setup pose to clear any lingering keys
                // from the emote animation. This is the crucial fix.
                if (spinePlayer && spinePlayer.skeleton) {
                    resetSpineSlotsToSetupPose(spinePlayer.skeleton);
                    resetSpineBonesToSetupPose(spinePlayer.skeleton);
                }
                emotePlayback.active = false;
                emotePlayback.animationName = '';
                emotePlayback.loopsRemaining = 0;
                emotePlayback.entry = null;
                emotePlayback.trackIndex = EMOTE_TRACK_INDEX;
                let restored = false;
                if (emotePlayback.previousBase?.name && spinePlayer?.animationState?.setAnimation) {
                    const baseEntry = setLoggedAnimation(0, emotePlayback.previousBase.name, emotePlayback.previousBase.loop === true);
                    if (baseEntry) {
                        if (typeof emotePlayback.previousBase.trackTime === 'number') {
                            baseEntry.trackTime = emotePlayback.previousBase.trackTime;
                        }
                        baseEntry.mixDuration = 0;
                        baseEntry.mixTime = 0;
                        player.currentAnimation = emotePlayback.previousBase.name;
                        restored = true;
                    }
                }
                emotePlayback.previousBase = null;
                if (!restored) {
                    player.currentAnimation = '';
                    if (player.onGround) {
                        applyGroundAnimation();
                    } else {
                        updateAirAnimation(player.vy);
                    }
                }
            }

            function cancelEmotePlayback() {
                if (!emotePlayback.active) return;
                finishEmotePlayback();
            }

            function setupSpine() {
                console.info(`[startup] Loading player atlas: ${CHARACTER_ATLAS_URL}`);
                new spine.SpinePlayer("player-container", {
                    skelUrl: CHARACTER_SKEL_URL, atlasUrl: CHARACTER_ATLAS_URL, alpha: true,
                    showControls: false, defaultMix: 0.05, fitToCanvas: false, viewport: PLAYER_VIEWPORT_CONFIG,
                    success: (instance) => {
                        console.info('[startup] Player Spine ready.');
                        spinePlayer = instance;
                        syncPlayerSkeletonScale();
                        if (spinePlayer.viewport && spinePlayer.viewport.camera) {
                            spinePlayer.viewport.camera.zoom = 1 / SPINE_RENDER_SCALE;
                        }

                        spineData = instance.skeleton.data;
                        allSkinNames = spineData.skins.map(s => s.name);
                        populateAvailableSkins();
                        talkTransitionController = createTalkTransitionController(
                            spinePlayer.animationState,
                            spineData
                        );
                        if (playerContainerElement) {
                            playerContainerElement.dataset.talkSystem = talkTransitionController
                                ? 'weighted-state-machine'
                                : 'legacy-loop-fallback';
                            playerContainerElement.dataset.talkPose = 'H';
                        }



                        //Animation Overlap MIXING and blending settings
                        const data = spinePlayer.animationState?.data;
                        if (data?.setMix) {
                            data.setMix(ANIM_SIT_BEGIN, ANIM_SIT_LOOP, 0.2);
                            data.setMix(ANIM_SIT_LOOP, ANIM_SIT_END, 0.2);
                            data.setMix(ANIM_SKID, ANIM_RUN, 0.2);
                            data.setMix(ANIM_RUN, ANIM_SKID, 0.01);
                            data.setMix(ANIM_IDLE, ANIM_ENTER_DOOR, 0.08);
                            data.setMix(ANIM_ENTER_DOOR, ANIM_IDLE, 0.12);

                        } else {
                            console.warn('AnimationState data unavailable; sit blend setup skipped.');
                        }





                        const getSkinsForGroup = (groupKey) => availableSkinsByGroup[groupKey] || [];
                        const randomSkinFromList = (list) => list.length ? list[Math.floor(Math.random() * list.length)] : '';

                        const randomizeSkins = () => {
                            const skinsToApply = [];
                            if (isSkinGroupEnabled('Common') && allSkinNames.includes(DEFAULT_COMMON_SKIN)) skinsToApply.push(DEFAULT_COMMON_SKIN);
                            let headGearEquipped = false;
                            if (isSkinGroupEnabled('HeadGear') && Math.random() < 0.10) {
                                const chosenHeadGear = randomSkinFromList(getSkinsForGroup('HeadGear'));
                                if (chosenHeadGear) { skinsToApply.push(chosenHeadGear); headGearEquipped = true; }
                            }
                            if (headGearEquipped) {
                                if (isSkinGroupEnabled('Hair') && allSkinNames.includes('Hair/H-000_Hat')) skinsToApply.push('Hair/H-000_Hat');
                            } else if (isSkinGroupEnabled('Hair')) {
                                const normalHair = getSkinsForGroup('Hair').filter(name => name !== 'Hair/H-000_Hat' && !name.toLowerCase().endsWith('_hat'));
                                const chosenHair = randomSkinFromList(normalHair);
                                if (chosenHair) skinsToApply.push(chosenHair);
                            }
                            ['ClothingBotFar', 'ClothingBotNear', 'ClothingInner', 'ClothingTopFar', 'ClothingTopNear', 'EarAccessory', 'EyeStyle', 'ShoesFar', 'ShoesNear'].forEach(groupKey => {
                                if (isSkinGroupEnabled(groupKey)) {
                                    const chosen = randomSkinFromList(getSkinsForGroup(groupKey));
                                    if (chosen) skinsToApply.push(chosen);
                                }
                            });
                            if (isSkinGroupEnabled('FaceAccessory') && Math.random() < 0.05) {
                                const faceAcc = randomSkinFromList(getSkinsForGroup('FaceAccessory'));
                                if (faceAcc) skinsToApply.push(faceAcc);
                            }
                            if (isSkinGroupEnabled('FullOutfit') && Math.random() < 0.05) {
                                const outfit = randomSkinFromList(getSkinsForGroup('FullOutfit'));
                                if (outfit) skinsToApply.push(outfit);
                            }
                            applySkinNames(skinsToApply, { updateUI: true });
                        };

                        currentSkinSelections = {};
                        Object.values(skinInputs).forEach(input => input.classList.remove('invalid'));
                        if (allSkinNames.includes(DEFAULT_COMMON_SKIN)) setSkinSelection('Common', DEFAULT_COMMON_SKIN, { skipApply: true });
                        const eyeOptions = getSkinsForGroup('EyeStyle');
                        if (eyeOptions.length) {
                            const randomEye = randomSkinFromList(eyeOptions);
                            if (randomEye) setSkinSelection('EyeStyle', randomEye, { skipApply: true });
                        }
                        applySkinSelections();

                        // =========================================================
                        // ▼▼▼ Randomize skins ON LOAD ▼▼▼
                        // =========================================================
                        randomizeSkins();
                        // =========================================================


                        if (randomizeSkinsButton) {
                            randomizeSkinsButton.addEventListener('click', () => { randomizeSkins(); randomizeSkinsButton.blur(); });
                        }
                        if (typeof spinePlayer.resize === 'function') spinePlayer.resize();
                        setSpineAnimation(ANIM_IDLE, true);
                        initializeBeaverNpc();
                        if (!IS_NATIVE_IOS) {
                            createBalloons();
                        }
                        initGame();
                        centerCameraOnPlayer();
                        requestAnimationFrame(gameLoop);
                        if (IS_NATIVE_IOS) {
                            // Keep player texture decoding and background tile decoding out of the same peak.
                            setTimeout(() => {
                                console.info('[startup] Loading nearby quarter-resolution background tiles.');
                                discoverBackgrounds();
                            }, 750);
                        }
                    },
                    error: (instance, error) => {
                        console.error("Spine error:", error);
                        debugInfoElement.textContent = `Spine Error: ${error}`;
                    }
                });
            }

            function logAnimationStart(trackIndex, animationName) {
                if (!animationName) return;
                animationTrackLog[trackIndex] = animationName;
                if (!DEBUG_ANIMATION_EVENT_LOGGING) return;
                console.info(`[Animation] Track ${trackIndex}: start "${animationName}"`);
            }

            function logAnimationStop(trackIndex, animationName) {
                const lastName = animationTrackLog[trackIndex];
                const nameToLog = animationName || lastName;
                if (!nameToLog) return;
                if (lastName) {
                    delete animationTrackLog[trackIndex];
                }
                if (!DEBUG_ANIMATION_EVENT_LOGGING) return;
                console.info(`[Animation] Track ${trackIndex}: stop "${nameToLog}"`);
            }

            function attachDebugListenerToEntry(entry) {
                if (!DEBUG_SPINE_EVENT_LOGGING || !entry || entry.__debugListenerPatched) return;
                const prevListener = entry.listener || {};
                const logLine = (type, extra) => {
                    const animName = entry.animation?.name || '(none)';
                    const trackIdx = typeof entry.trackIndex === 'number' ? entry.trackIndex : '?';
                    const suffix = extra ? ` ${extra}` : '';
                    console.log(`[SpineDebug] ${type} track ${trackIdx} "${animName}"${suffix}`);
                };
                const wrap = (type, fn) => (...args) => {
                    if (type === 'event') {
                        const eventName = args[1]?.data?.name || '';
                        logLine(type, eventName ? `event="${eventName}"` : '');
                    } else {
                        logLine(type);
                    }
                    if (typeof fn === 'function') fn.apply(prevListener, args);
                };
                entry.listener = {
                    start: wrap('start', prevListener.start),
                    interrupt: wrap('interrupt', prevListener.interrupt),
                    end: wrap('end', prevListener.end),
                    dispose: wrap('dispose', prevListener.dispose),
                    complete: wrap('complete', prevListener.complete),
                    event: wrap('event', prevListener.event)
                };
                entry.__debugListenerPatched = true;
            }

            function logAnimationFrameSample(currentTime) {
                if (!DEBUG_ANIMATION_FRAME_LOGGING && !DEBUG_ANIMATION_TRACK_FRAME_LOGGING) return;
                const animationState = spinePlayer?.animationState;
                if (!animationState) return;
                const timeSeconds = typeof currentTime === 'number' ? (currentTime / 1000).toFixed(3) : '0.000';
                if (DEBUG_ANIMATION_FRAME_LOGGING) {
                    const trackEntry = animationState.getCurrent(0);
                    const animationName = trackEntry?.animation?.name || player.currentAnimation || '(none)';
                    console.log(`[AnimationFrame] t=${timeSeconds}s -> ${animationName}`);
                }
                if (DEBUG_ANIMATION_TRACK_FRAME_LOGGING) {
                    const tracks = animationState.tracks || [];
                    tracks.forEach((entry, index) => {
                        if (!entry) return;
                        const name = entry.animation?.name || '(none)';
                        console.log(`[AnimationFrameTrack] t=${timeSeconds}s track ${index}: ${name} alpha=${entry.alpha?.toFixed?.(2) ?? ''}`);
                    });
                }
            }

            function setLoggedAnimation(trackIndex, animationName, loop, animationState = spinePlayer?.animationState) {
                if (!animationState?.setAnimation) return null;
                const previous = animationState.getCurrent?.(trackIndex);
                const previousName = previous?.animation?.name;
                if (previousName) {
                    logAnimationStop(trackIndex, previousName);
                } else if (animationTrackLog[trackIndex]) {
                    logAnimationStop(trackIndex, animationTrackLog[trackIndex]);
                }
                const entry = animationState.setAnimation(trackIndex, animationName, loop);
                if (entry) {
                    const startedName = entry.animation?.name || animationName;
                    if (startedName) {
                        logAnimationStart(trackIndex, startedName);
                    }
                    attachDebugListenerToEntry(entry);
                }
                return entry;
            }

            function clearTrackLogged(trackIndex, animationState = spinePlayer?.animationState) {
                if (!animationState?.clearTrack) return;
                const current = animationState.getCurrent?.(trackIndex);
                const currentName = current?.animation?.name;
                if (currentName || animationTrackLog[trackIndex]) {
                    logAnimationStop(trackIndex, currentName);
                }
                animationState.clearTrack(trackIndex);
            }

            function setSpineAnimation(animationName, loop, trackIndex = 0) {
                if (!spinePlayer || !spinePlayer.animationState || !spinePlayer.skeleton) return;
                if (player.isSkidding && trackIndex === 0 && animationName !== ANIM_SKID) return;
                const currentEntry = spinePlayer.animationState.getCurrent(trackIndex);
                if (player.currentAnimation === animationName && loop === currentEntry?.loop) return;

                if (spinePlayer.skeleton.data.findAnimation(animationName)) {
                    setLoggedAnimation(trackIndex, animationName, loop);
                    player.currentAnimation = animationName;
                    if (trackIndex === 0) {
                        const lowerAnimationName = String(animationName || '').toLowerCase();
                        const isDriving = lowerAnimationName.includes('game_drivingloop');
                        const targetDrivingSpeed = isDriving ? 900 : 0;
                        if (DRIVINGSPEED !== targetDrivingSpeed) {
                            DRIVINGSPEED = targetDrivingSpeed;
                            if (currentMovementConfig) {
                                applyMovementSpeeds(currentMovementConfig);
                            }
                        }
                    }
                } else {
                    console.warn(`Animation not found: ${animationName}`);
                }
            }

            function isPlayerNearPlatformEdge() {
                if (!player?.onGround || !player?.currentPlatform) return false;
                if (player.lastMoveType !== 'idle') return false;
                const threshold = Math.max(0, EDGE_PROXIMITY_THRESHOLD ?? 0);
                if (threshold <= 0) return false;
                const nearLedgeHorizTolerance = 10; // tweak: max horizontal gap to treat edges as connected
                const nearLedgeVertTolerance = (blockHeight || DEFAULT_PLATFORM_THICKNESS) + 20; // tweak: vertical allowance
                const platform = player.currentPlatform;
                const platformWidth = Number.isFinite(platform?.width) ? platform.width : 0;
                if (!platform || platformWidth <= 0) return false;
                const platformLeft = platform.x;
                const platformRight = platformLeft + platformWidth;
                const playerLeft = player.x;
                const playerRight = player.x + player.width;
                const nearLeft = (playerLeft - platformLeft) <= threshold;
                const nearRight = (platformRight - playerRight) <= threshold;
                if (nearLeft || nearRight) {
                    const ledgeX = nearLeft ? platformLeft : platformRight;
                    const hasNearbyLedge = platforms.some(p => {
                        if (!p || p === platform) return false;
                        const pLeft = p.x, pRight = p.x + p.width;
                        const horizontalGap = nearLeft ? Math.abs(pRight - ledgeX) : Math.abs(pLeft - ledgeX);
                        const verticalGap = Math.abs((p.y ?? 0) - (platform.y ?? 0));
                        return !p.isSlope && horizontalGap <= nearLedgeHorizTolerance && verticalGap <= nearLedgeVertTolerance;
                    });
                    if (hasNearbyLedge) return false;
                    return true;
                }
                return false;
            }

            function startSlopeSlide(angleRad) {
                const angleDeg = angleRad * RAD_TO_DEG;
                const newTilt = player.facingRight ? (angleDeg + 30) : (angleDeg - 30); // TERNARY!!!
                if (slopeSlideState.active && Math.abs(slopeSlideState.targetTiltDeg - newTilt) < 0.01) return;
                slopeSlideState.active = true;
                slopeSlideState.targetTiltDeg = newTilt;
                setSpineAnimation(ANIM_SLIDE, true);
            }

            function stopSlopeSlide() {
                if (!slopeSlideState.active) return;
                slopeSlideState.active = false;
                slopeSlideState.targetTiltDeg = 0;
                if (player.onGround) applyGroundAnimation();
            }

            function applyGroundAnimation() {
                if (mountController?.ownsRiderAnimation?.()) return;
                if (player.doorState !== 'none') return;
                if (randomAnimationTestState.active) return;
                if (isEmotePlaying()) return;
                if (player.fidgetState !== 'none') return;
                if (player.groundAnimCooldown > 0) return;
                if (slopeSlideState.active) return;
                if (isPlayerNearPlatformEdge()) {
                    setSpineAnimation(ANIM_EDGE_UNBALANCED, true);
                    return;
                }
                const speed = Math.abs(player.vx);
                if (speed > 0) {
                    setSpineAnimation(player.isRunning ? ANIM_RUN : ANIM_WALK, true);
                } else {
                    setSpineAnimation(ANIM_IDLE, true);
                    if (player.onGround && player.previousMoveType !== 'idle' && player.lastMoveType === 'idle' && player.lieState === 'none' && player.fidgetState === 'none') {
                        const stoppedFromRun = player.previousMoveType === 'run';
                        playStopOverlay(stoppedFromRun);
                    }
                }
            }

            function playRunSkidAnimation() {
                if (isEmotePlaying()) return;
                if (Math.abs(player.vx) < 100) return;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) return;
                const skidAnim = skeletonData.findAnimation(ANIM_SKID);
                if (!skidAnim) return;
                const skidDuration = skidAnim.duration && skidAnim.duration > 0
                    ? skidAnim.duration
                    : Math.max(GROUND_ANIMATION_LOCKOUT * 3, 0.36);
                player.groundAnimCooldown = Math.max(player.groundAnimCooldown, skidDuration);
                player.isSkidding = true;
                player.facingRight = !player.facingRight;
                syncPlayerSkeletonScale();
                const entry = setLoggedAnimation(0, ANIM_SKID, false, animationState);
                if (!entry) {
                    player.isSkidding = false;
                    return;
                }
                // how much to blend the SKID animation 
                entry.alpha = SKID_BLEND_ALPHA;
                console.log('[Skid] Triggering skid puff VFX');
                playSkidPuffEffect();
                const finishSkid = () => {
                    if (!player.isSkidding) return;
                    player.isSkidding = false;
                    player.groundAnimCooldown = 0;
                    if (player.onGround) applyGroundAnimation();
                };
                entry.listener = {
                    start: null,
                    interrupt: finishSkid,
                    event: null,
                    complete: finishSkid,
                    end: finishSkid,
                    dispose: finishSkid
                };
                attachDebugListenerToEntry(entry);
                player.currentAnimation = ANIM_SKID;
            }

            function startLandingAnimation() {
                if (isEmotePlaying()) return;
                if (player.lieState !== 'none' || player.fidgetState !== 'none') return;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                const canPlayHardLanding = player.landingTooHard && animationState && skeletonData?.findAnimation(ANIM_JUMP_LAND_TOO_HARD);
                if (canPlayHardLanding) {
                    player.isLandingAnimation = true;
                    player.landingHardBlendTriggered = false;
                    console.log('[Landing] Triggering hard landing animation', { impactSpeed: player.lastLandingImpactSpeed });
                    if (player.landingMomentumVx !== 0) {
                        player.facingRight = player.landingMomentumVx < 0;
                        syncPlayerSkeletonScale();
                    }
                    const entry = setLoggedAnimation(0, ANIM_JUMP_LAND_TOO_HARD, false, animationState);
                    if (entry) {
                        entry.mixDuration = LANDING_TOO_HARD_BLEND_IN;
                        entry.mixTime = 0;
                        const hardLandingDuration = entry.animation?.duration ?? skeletonData.findAnimation(ANIM_JUMP_LAND_TOO_HARD)?.duration ?? 0;
                        const lockDuration = hardLandingDuration > 0 ? hardLandingDuration * LANDING_TOO_HARD_INPUT_LOCK_FRACTION : 0.25;
                        player.landingInputLockTimer = Math.max(player.landingInputLockTimer, lockDuration);
                        const finishHardLanding = () => {
                            player.isLandingAnimation = false;
                            player.landingTooHard = false;
                            player.landingHardBlendTriggered = false;
                            player.landingInputLockTimer = 0;
                            player.landingMomentumVx = 0;
                            if (player.onGround) {
                                applyGroundAnimation();
                                const nextEntry = spinePlayer?.animationState?.getCurrent(0);
                                if (nextEntry) {
                                    nextEntry.mixDuration = LANDING_TOO_HARD_BLEND_OUT;
                                    nextEntry.mixTime = 0;
                                }
                            } else {
                                player.jumpUpIntroPlayed = false;
                                player.fallIntroPlayed = false;
                            }
                        };
                        entry.listener = {
                            interrupt: finishHardLanding,
                            complete: finishHardLanding,
                            end: finishHardLanding,
                            dispose: finishHardLanding
                        };
                        attachDebugListenerToEntry(entry);
                    } else {
                        player.isLandingAnimation = false;
                        player.landingTooHard = false;
                        player.landingMomentumVx = 0;
                    }
                    return;
                }
                player.landingTooHard = false;
                player.landingMomentumVx = 0;
                const movingOnLanding = Math.abs(player.vx) > 0.01;
                const canPlayMovingLanding = movingOnLanding && animationState && skeletonData?.findAnimation(ANIM_JUMP_LAND_MOVING);
                if (canPlayMovingLanding) {
                    const currentOverlay = animationState.getCurrent(LANDING_OVERLAY_TRACK_INDEX);
                    const overlayActive = currentOverlay && currentOverlay.animation?.name === ANIM_JUMP_LAND_MOVING;
                    if (!overlayActive) {
                        player.isLandingAnimation = false;
                        player.groundAnimCooldown = 0;
                        if (player.onGround) applyGroundAnimation();
                        const overlayEntry = setLoggedAnimation(LANDING_OVERLAY_TRACK_INDEX, ANIM_JUMP_LAND_MOVING, false, animationState);
                        if (overlayEntry) {
                            overlayEntry.alpha = 1;
                            overlayEntry.mixDuration = LANDING_OVERLAY_BLEND_IN;
                            overlayEntry.mixTime = 0;
                            currentLandingOverlayEntry = overlayEntry;
                            overlayEntry.listener = {
                                complete: () => {
                                    if (currentLandingOverlayEntry === overlayEntry) currentLandingOverlayEntry = null;
                                    const state = spinePlayer?.animationState;
                                    if (state) {
                                        clearTrackLogged(LANDING_OVERLAY_TRACK_INDEX, state);
                                    }
                                }
                            };
                        }
                    }
                    return;
                }
                if (Math.abs(player.vx) >= LAND_BLEND_TO_RUN_THRESHOLD) {
                    player.isLandingAnimation = false;
                    if (player.onGround) applyGroundAnimation();
                    return;
                }
                if (player.isLandingAnimation) return;
                const landingAnim = player.hasDoubleJumped ? ANIM_DOUBLE_JUMP_LAND : ANIM_JUMP_LAND;
                const canPlayLanding = animationState && skeletonData?.findAnimation(landingAnim);
                if (!canPlayLanding) {
                    applyGroundAnimation();
                    return;
                }
                player.isLandingAnimation = true;
                playSpineAnimationOnce(landingAnim, 0, () => {
                    player.isLandingAnimation = false;
                    if (player.onGround) applyGroundAnimation(); else { player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; }
                });
            }

            function updateHardLandingBlend() {
                if (!player.isLandingAnimation || !player.landingTooHard) return;
                if (!player.onGround) return;
                const animationState = spinePlayer?.animationState;
                const current = animationState?.getCurrent(0);
                if (!current || current.animation?.name !== ANIM_JUMP_LAND_TOO_HARD) return;
                const animationStart = current.animationStart ?? 0;
                const animationEnd = current.animationEnd ?? current.animation?.duration ?? 0;
                const duration = Math.max(0, animationEnd - animationStart) || current.animation?.duration || 0;
                if (!Number.isFinite(duration) || duration <= 0) return;
                const trackTime = (current.trackTime ?? 0) - animationStart;
                const progress = Math.max(0, Math.min(1, trackTime / duration));
                const intent = (() => {
                    const leftPressed = isActionActive('left');
                    const rightPressed = isActionActive('right');
                    const runPressed = isActionActive('run');
                    const joystickActive = joystickState.active;
                    const joystickX = joystickActive ? joystickState.x : 0;
                    const joystickStrength = joystickActive ? joystickState.strength : 0;
                    const joystickHorizontal = joystickActive && Math.abs(joystickX) > JOYSTICK_DEADZONE;
                    if (joystickHorizontal) {
                        const horizontalInput = Math.max(-1, Math.min(1, joystickX));
                        const radialStrength = Math.min(1, joystickStrength);
                        const walkMix = Math.min(1, radialStrength / JOYSTICK_RUN_THRESHOLD);
                        const runMix = radialStrength <= JOYSTICK_RUN_THRESHOLD ? 0 : Math.min(1, (radialStrength - JOYSTICK_RUN_THRESHOLD) / (1 - JOYSTICK_RUN_THRESHOLD));
                        let targetSpeed = PLAYER_WALK_SPEED * walkMix + (PLAYER_RUN_SPEED - PLAYER_WALK_SPEED) * runMix;
                        if (runPressed) targetSpeed = PLAYER_RUN_SPEED;
                        const targetVelocityX = horizontalInput * targetSpeed;
                        const isMoving = Math.abs(targetVelocityX) > 0.01;
                        const isRunning = (radialStrength >= JOYSTICK_RUN_THRESHOLD || runPressed) && isMoving;
                        return { isMoving, isRunning, targetVelocityX };
                    }
                    const movingLeft = leftPressed && !rightPressed;
                    const movingRight = rightPressed && !leftPressed;
                    const isMoving = movingLeft || movingRight;
                    const speed = (runPressed && isMoving) ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
                    const targetVelocityX = movingLeft ? -speed : (movingRight ? speed : 0);
                    const isRunning = runPressed && isMoving;
                    return { isMoving, isRunning, targetVelocityX };
                })();
                if (player.landingHardBlendTriggered || progress < LANDING_TOO_HARD_BLEND_START || !intent.isMoving) return;
                player.vx = intent.targetVelocityX;
                player.isRunning = intent.isRunning;
                player.isMoving = intent.isMoving;
                player.lastMoveType = intent.isMoving ? (intent.isRunning ? 'run' : 'walk') : 'idle';
                player.previousMoveType = player.lastMoveType;
                if (intent.targetVelocityX < 0) player.facingRight = true; else if (intent.targetVelocityX > 0) player.facingRight = false;
                player.landingHardBlendTriggered = true;
                player.isLandingAnimation = false;
                player.landingTooHard = false;
                player.landingInputLockTimer = 0;
                player.landingMomentumVx = 0;
                applyGroundAnimation();
                const next = animationState.getCurrent(0);
                if (next && next !== current) {
                    next.mixDuration = LANDING_TOO_HARD_BLEND_OUT;
                    next.mixTime = 0;
                }
            }

            function updateAirAnimation(prevVy) {
                if (mountController?.ownsRiderAnimation?.()) return;
                if (player.doorState !== 'none') return;
                if (randomAnimationTestState.active) return;
                if (isEmotePlaying()) {
                    cancelActiveEmote('airborne state', { vy: player.vy, prevVy, onGround: player.onGround });
                }
                if (!spinePlayer || !spinePlayer.skeleton) return;

                const usingDoubleJumpAnims = player.hasDoubleJumped;
                const animJumpUp = usingDoubleJumpAnims ? ANIM_DOUBLE_JUMP_UP : ANIM_JUMP_UP;
                const animJumpUpLoop = usingDoubleJumpAnims ? ANIM_DOUBLE_JUMP_UP_LOOP : ANIM_JUMP_UP_LOOP;
                const animJumpFall = usingDoubleJumpAnims ? ANIM_DOUBLE_JUMP_FALL : ANIM_JUMP_FALL;
                const animJumpFallLoop = usingDoubleJumpAnims ? ANIM_DOUBLE_JUMP_FALL_LOOP : ANIM_JUMP_FALL_LOOP;
                const vy = player.vy;

                // --- START OF FIX ---
                // Simplified logic into two states: moving up/at peak (vy <= 0) or falling (vy > 0).
                // This removes the "apex" dead zone that was causing the flicker.

                if (vy <= 0) { // If moving up OR at the absolute peak
                    // We just transitioned from falling to rising (a double jump), so reset the flags.
                    if (prevVy > 0) {
                        player.fallIntroPlayed = false;
                        player.jumpUpIntroPlayed = false;
                    }
                    // If we're rising and not on the jump up or loop animation, start the jump up sequence.
                    if (player.currentAnimation !== animJumpUp && player.currentAnimation !== animJumpUpLoop) {
                        if (!player.jumpUpIntroPlayed) {
                            playSpineAnimationOnce(animJumpUp, 0, () => {
                                if (player.currentAnimation !== animJumpUp) return;
                                player.jumpUpIntroPlayed = true;
                                if (!player.onGround) {
                                    setSpineAnimation(animJumpUpLoop, true);
                                }
                            });
                        } else {
                            // Intro already played, go straight to loop
                            setSpineAnimation(animJumpUpLoop, true);
                        }
                    }
                } else { // We are actively falling (vy > 0)
                    // If the one-shot fall intro animation hasn't played yet for this jump...
                    if (!player.fallIntroPlayed) {
                        // ...but wait for the grace period to end before committing to the fall animation.
                        if (!player.hasDoubleJumped && player.airJumpAvailable && player.doubleJumpFallGrace > 0) {
                            return;
                        }
                        // If the jump up animation is still playing, let it finish first - don't interrupt it.
                        // The callback will transition to the loop, and then we'll catch it on the next frame.
                        if (player.currentAnimation === animJumpUp) {
                            return;
                        }

                        player.fallIntroPlayed = true;
                        playSpineAnimationOnce(animJumpFall, 0, () => {
                            // When the intro finishes, switch to the fall loop if still in the air.
                            if (player.currentAnimation !== animJumpFall) return;
                            if (player.onGround) startLandingAnimation();
                            else setSpineAnimation(animJumpFallLoop, true);
                        });
                    }
                    // If the fall intro has already played, ensure we are on the fall loop animation.
                    else if (player.currentAnimation !== animJumpFallLoop && player.currentAnimation !== animJumpFall) {
                        setSpineAnimation(animJumpFallLoop, true);
                    }
                }
                // --- END OF FIX ---
            }

            function updateWindOverlay() {
                if (!spinePlayer?.animationState || !spinePlayer?.skeleton) return;

                if (player.lieState !== 'none' || player.fidgetState !== 'none') {
                    if (currentWindOverlay) {
                        clearTrackLogged(WIND_TRACK_INDEX);
                        currentWindOverlay = null;
                    }
                    return;
                }
                const horizontalSpeed = player.vx;
                const absSpeed = Math.abs(horizontalSpeed);
                const onGround = player.onGround && !player.isLandingAnimation;
                if (!onGround || absSpeed <= 0.01) {
                    if (currentWindOverlay) {
                        clearTrackLogged(WIND_TRACK_INDEX);
                        currentWindOverlay = null;
                    }
                    return;
                }
                const animationName = horizontalSpeed >= 0 ? WIND_RIGHT_ANIMATION : WIND_LEFT_ANIMATION;
                if (!spinePlayer.skeleton.data.findAnimation(animationName)) {
                    if (currentWindOverlay) {
                        clearTrackLogged(WIND_TRACK_INDEX);
                        currentWindOverlay = null;
                    }
                    return;
                }
                let entry = spinePlayer.animationState.getCurrent(WIND_TRACK_INDEX);
                if (!entry || entry.animation?.name !== animationName) {
                    entry = setLoggedAnimation(WIND_TRACK_INDEX, animationName, true);
                    currentWindOverlay = animationName;
                }
                const maxSpeed = PLAYER_RUN_SPEED > 0 ? PLAYER_RUN_SPEED : absSpeed || 1;
                const blend = Math.max(0, Math.min(1, absSpeed / maxSpeed));
                if (entry) {
                    entry.alpha = blend;
                    entry.mixDuration = 0;
                }
            }

            function clearJetpackTrack() {
                clearTrackLogged(JETPACK_TRACK_INDEX);
                jetpackState.removing = false;
                jetpackRemoveEntry = null;
            }

            function playJetpackRemoveAnimation() {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) {
                    clearJetpackTrack();
                    return;
                }
                if (!skeletonData.findAnimation(JETPACK_REMOVE_ANIMATION)) {
                    clearJetpackTrack();
                    return;
                }
                const entry = setLoggedAnimation(JETPACK_TRACK_INDEX, JETPACK_REMOVE_ANIMATION, false, animationState);
                if (!entry) {
                    clearJetpackTrack();
                    return;
                }
                jetpackState.removing = true;
                jetpackRemoveEntry = entry;
                entry.alpha = 1;
                entry.mixDuration = 0;
                const previousComplete = entry.listener?.complete;
                entry.listener = entry.listener || {};
                entry.listener.complete = (trackEntry) => {
                    if (typeof previousComplete === 'function') {
                        previousComplete(trackEntry);
                    }
                    if (trackEntry === entry) {
                        jetpackState.removing = false;
                        jetpackRemoveEntry = null;
                        clearJetpackTrack();
                    }
                };
            }

            function updateJetpackAnimation() {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) {
                    clearJetpackTrack();
                    return;
                }
                if (jetpackState.removing) {
                    const current = animationState.getCurrent(JETPACK_TRACK_INDEX);
                    if (!current || current.animation?.name !== JETPACK_REMOVE_ANIMATION || (jetpackRemoveEntry && current !== jetpackRemoveEntry)) {
                        jetpackState.removing = false;
                    }
                    return;
                }
                if (!jetpackState.enabled) {
                    clearJetpackTrack();
                    return;
                }
                const flyingUp = jetpackState.thrusting;
                const targetAnimation = flyingUp ? JETPACK_FLY_ANIMATION : JETPACK_WEAR_ANIMATION;
                if (!skeletonData.findAnimation(targetAnimation)) {
                    clearJetpackTrack();
                    return;
                }
                let entry = animationState.getCurrent(JETPACK_TRACK_INDEX);
                if (!entry || entry.animation?.name !== targetAnimation) {
                    entry = setLoggedAnimation(JETPACK_TRACK_INDEX, targetAnimation, true, animationState);
                }
                if (!entry) {
                    clearJetpackTrack();
                    return;
                }
                entry.alpha = 1;
                entry.mixDuration = 0;
            }

            function updateLandingOverlayWeight() {
                if (!spinePlayer?.animationState) {
                    currentLandingOverlayEntry = null;
                    return;
                }
                const entry = spinePlayer.animationState.getCurrent(LANDING_OVERLAY_TRACK_INDEX);
                if (!entry || entry.animation?.name !== ANIM_JUMP_LAND_MOVING) {
                    currentLandingOverlayEntry = null;
                    return;
                }
                currentLandingOverlayEntry = entry;
                const animationStart = entry.animationStart ?? 0;
                const animationEnd = entry.animationEnd ?? entry.animation?.duration ?? 0;
                const duration = Math.max(0, animationEnd - animationStart) || entry.animation?.duration || 0;
                if (!Number.isFinite(duration) || duration <= 0) {
                    entry.alpha = 0;
                    return;
                }
                const trackTime = (entry.trackTime ?? 0) - animationStart;
                const clampedTrackTime = Math.max(0, Math.min(duration, trackTime));
                const remaining = duration - clampedTrackTime;
                if (remaining <= LANDING_OVERLAY_BLEND_OUT) {
                    const blend = Math.max(0, Math.min(1, remaining / LANDING_OVERLAY_BLEND_OUT));
                    entry.alpha = blend;
                } else {
                    entry.alpha = 1;
                }
            }

            function updateStopOverlayWeight() {
                if (!spinePlayer?.animationState) {
                    currentStopOverlayEntry = null;
                    return;
                }
                const entry = spinePlayer.animationState.getCurrent(STOP_OVERLAY_TRACK_INDEX);
                if (!entry || entry.animation?.name == null) {
                    currentStopOverlayEntry = null;
                    return;
                }
                currentStopOverlayEntry = entry;
                const animationStart = entry.animationStart ?? 0;
                const animationEnd = entry.animationEnd ?? entry.animation?.duration ?? 0;
                const duration = Math.max(0, animationEnd - animationStart) || entry.animation?.duration || 0;
                if (!Number.isFinite(duration) || duration <= 0) {
                    entry.alpha = 0;
                    return;
                }
                const trackTime = (entry.trackTime ?? 0) - animationStart;
                const clampedTrackTime = Math.max(0, Math.min(duration, trackTime));
                const remaining = duration - clampedTrackTime;
                if (remaining <= STOP_OVERLAY_BLEND_OUT) {
                    const blend = Math.max(0, Math.min(1, remaining / STOP_OVERLAY_BLEND_OUT));
                    entry.alpha = blend;
                } else {
                    entry.alpha = 1;
                }
            }

            function logOverlayTrackStates() {
                if (!DEBUG_OVERLAY_TRACK_LOGGING || !spinePlayer?.animationState) return;
                const overlays = [
                    { label: 'wind', index: WIND_TRACK_INDEX },
                    { label: 'landing', index: LANDING_OVERLAY_TRACK_INDEX },
                    { label: 'stop', index: STOP_OVERLAY_TRACK_INDEX },
                    { label: 'talk', index: TALK_TRACK_INDEX },
                    { label: 'emote', index: EMOTE_TRACK_INDEX }
                ];
                overlays.forEach(({ label, index }) => {
                    const entry = spinePlayer.animationState.getCurrent(index);
                    if (!entry) return;
                    const animName = entry.animation?.name || '(none)';
                    const alpha = typeof entry.alpha === 'number' ? entry.alpha.toFixed(2) : '';
                    console.log(`[OverlayDebug] track ${index} (${label}): ${animName} alpha=${alpha}`);
                });
            }

            function logJumpFlagChanges() {
                if (!DEBUG_JUMP_FLAG_LOGGING) return;
                if (debugPrevHasDoubleJumped !== player.hasDoubleJumped) {
                    console.log(`[JumpFlagDebug] hasDoubleJumped: ${debugPrevHasDoubleJumped} -> ${player.hasDoubleJumped}`);
                    debugPrevHasDoubleJumped = player.hasDoubleJumped;
                }
                if (debugPrevFallIntroPlayed !== player.fallIntroPlayed) {
                    console.log(`[JumpFlagDebug] fallIntroPlayed: ${debugPrevFallIntroPlayed} -> ${player.fallIntroPlayed}`);
                    debugPrevFallIntroPlayed = player.fallIntroPlayed;
                }
                if (debugPrevAirJumpAvailable !== player.airJumpAvailable) {
                    console.log(`[JumpFlagDebug] airJumpAvailable: ${debugPrevAirJumpAvailable} -> ${player.airJumpAvailable}`);
                    debugPrevAirJumpAvailable = player.airJumpAvailable;
                }
            }

            function clearStopOverlay() {
                if (spinePlayer?.animationState) {
                    clearTrackLogged(STOP_OVERLAY_TRACK_INDEX, spinePlayer.animationState);
                }
                currentStopOverlayEntry = null;
            }

            function playStopOverlay(fromRun) {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) return;
                const animationName = fromRun ? ANIM_STOP_INERTIA_RUN : ANIM_STOP_INERTIA_WALK;
                if (!skeletonData.findAnimation(animationName)) return;
                clearStopOverlay();
                const entry = setLoggedAnimation(STOP_OVERLAY_TRACK_INDEX, animationName, false, animationState);
                if (!entry) return;
                currentStopOverlayEntry = entry;
                entry.alpha = 1;
                entry.mixDuration = STOP_OVERLAY_BLEND_IN;
                entry.mixTime = 0;
                entry.listener = {
                    complete: () => {
                        const state = spinePlayer?.animationState;
                        if (currentStopOverlayEntry === entry) currentStopOverlayEntry = null;
                        if (state) {
                            clearTrackLogged(STOP_OVERLAY_TRACK_INDEX, state);
                        }
                    },
                    end: () => {
                        if (currentStopOverlayEntry === entry) currentStopOverlayEntry = null;
                    },
                    dispose: () => {
                        if (currentStopOverlayEntry === entry) currentStopOverlayEntry = null;
                    }
                };
            }

            function clearTalkLipSyncOverlay() {
                if (spinePlayer?.animationState) {
                    clearTrackLogged(TALK_LIP_SYNC_TRACK_INDEX, spinePlayer.animationState);
                }
                currentTalkLipSyncEntry = null;
                talkLipSyncVariantIndex = 0;
                talkLipSyncSwitchTimer = 0;
                if (playerContainerElement) {
                    playerContainerElement.dataset.talkLipSyncAnimation = '';
                    playerContainerElement.dataset.talkLipSyncTrack = '';
                }
            }

            function updateTalkLipSyncOverlay(dt) {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!talkSpeechActive || !currentTalkEntry || !animationState || !skeletonData) {
                    if (currentTalkLipSyncEntry || animationState?.getCurrent?.(TALK_LIP_SYNC_TRACK_INDEX)) {
                        clearTalkLipSyncOverlay();
                    }
                    return;
                }

                talkLipSyncSwitchTimer = Math.max(0, talkLipSyncSwitchTimer - Math.max(0, Number(dt) || 0));
                const activeEntry = animationState.getCurrent(TALK_LIP_SYNC_TRACK_INDEX);
                const needsFirstVariant = !currentTalkLipSyncEntry || activeEntry !== currentTalkLipSyncEntry;
                if (needsFirstVariant) talkLipSyncVariantIndex = 0;
                else if (talkLipSyncSwitchTimer <= 0) {
                    talkLipSyncVariantIndex = (talkLipSyncVariantIndex + 1) % TALK_LIP_SYNC_ANIMATION_NAMES.length;
                } else {
                    return;
                }

                let animationName = TALK_LIP_SYNC_ANIMATION_NAMES[talkLipSyncVariantIndex];
                if (!skeletonData.findAnimation(animationName)) {
                    animationName = TALK_LIP_SYNC_ANIMATION_NAMES.find(name => skeletonData.findAnimation(name)) || '';
                }
                if (!animationName) {
                    clearTalkLipSyncOverlay();
                    return;
                }

                const entry = setLoggedAnimation(TALK_LIP_SYNC_TRACK_INDEX, animationName, true, animationState);
                if (!entry) return;
                currentTalkLipSyncEntry = entry;
                entry.alpha = 1;
                entry.additive = false;
                entry.mixDuration = 0.08;
                entry.mixTime = 0;
                talkLipSyncSwitchTimer = randomFloat(
                    TALK_LIP_SYNC_SWITCH_DELAY.min,
                    TALK_LIP_SYNC_SWITCH_DELAY.max
                );
                playerContainerElement.dataset.talkLipSyncAnimation = animationName;
                playerContainerElement.dataset.talkLipSyncTrack = String(TALK_LIP_SYNC_TRACK_INDEX);
            }

            function createTalkTransitionController(animationState, skeletonData) {
                const talkingApi = window.WeightedTalking;
                if (!talkingApi?.discoverPoseTransitionClips
                    || !talkingApi?.PoseTransitionStateMachine
                    || !talkingApi?.SpineTalkingController) return null;

                const availableAnimationNames = Array.isArray(skeletonData.animations)
                    ? skeletonData.animations.map(animation => animation?.name).filter(Boolean)
                    : [];
                const transitionClips = talkingApi.discoverPoseTransitionClips(
                    availableAnimationNames,
                    TALK_TRANSITION_DISCOVERY_OPTIONS
                );
                const machine = new talkingApi.PoseTransitionStateMachine({
                    homePose: 'H',
                    clips: transitionClips,
                    recentLimit: 4,
                    edgeRepeatPenalty: 0.15,
                    variantRepeatPenalty: 0.08
                }).setAvailableAnimations(availableAnimationNames);
                if (!machine.hasPlayableGraph()) return null;
                if (playerContainerElement) {
                    playerContainerElement.dataset.talkTransitionClipCount = String(transitionClips.length);
                }
                console.info(`[Talking] Discovered ${transitionClips.length} pose-transition clips.`);

                return new talkingApi.SpineTalkingController({
                    machine,
                    animationState,
                    trackIndex: TALK_TRACK_INDEX,
                    mixDuration: 0,
                    setAnimation: animationName => setLoggedAnimation(
                        TALK_TRACK_INDEX,
                        animationName,
                        false,
                        animationState
                    ),
                    clearTrack: () => clearTrackLogged(TALK_TRACK_INDEX, animationState),
                    onClipStart: (clip, entry, snapshot) => {
                        currentTalkEntry = entry;
                        currentTalkAnimationName = clip.animation;
                        updateTalkAnimationLabel(clip.animation);
                        if (playerContainerElement) {
                            playerContainerElement.dataset.talkSystem = 'weighted-state-machine';
                            playerContainerElement.dataset.talkPose = snapshot?.pose || clip.from;
                            playerContainerElement.dataset.talkNextPose = clip.to;
                            playerContainerElement.dataset.talkOverlayAnimation = clip.animation;
                        }
                    },
                    onStop: () => {
                        currentTalkEntry = null;
                        currentTalkAnimationName = '';
                        updateTalkAnimationLabel('');
                        if (playerContainerElement) {
                            playerContainerElement.dataset.talkPose = 'H';
                            playerContainerElement.dataset.talkNextPose = '';
                            playerContainerElement.dataset.talkOverlayAnimation = '';
                        }
                    }
                });
            }

            function setManualTalkingActive(active) {
                manualTalkingActive = Boolean(active);
                if (playerContainerElement) {
                    playerContainerElement.dataset.manualTalkingActive = String(manualTalkingActive);
                }
            }

            function stopTalkOverlay(options = {}) {
                talkSpeechActive = false;
                clearTalkLipSyncOverlay();
                speechBubbleController?.handleTalkState(false);

                if (talkTransitionController) {
                    talkTransitionController.stop({ immediate: Boolean(options.immediate) });
                    return;
                }

                if (spinePlayer?.animationState) {
                    clearTrackLogged(TALK_TRACK_INDEX, spinePlayer.animationState);
                }
                currentTalkEntry = null;
                currentTalkAnimationName = '';
                updateTalkAnimationLabel('');
                if (playerContainerElement) playerContainerElement.dataset.talkOverlayAnimation = '';
            }

            function clearTalkOverlay() {
                setManualTalkingActive(false);
                stopTalkOverlay({ immediate: true });
            }

            function startTalkOverlay(animationState, skeletonData) {
                if (!talkTransitionController) {
                    talkTransitionController = createTalkTransitionController(animationState, skeletonData);
                }
                if (talkTransitionController) {
                    const entry = talkTransitionController.start();
                    currentTalkEntry = entry || currentTalkEntry;
                    return entry || currentTalkEntry;
                }

                const availableAnimations = TALK_FALLBACK_ANIMATION_NAMES.filter(name => skeletonData.findAnimation(name));
                if (!availableAnimations.length) return null;
                if (!currentTalkAnimationName || !availableAnimations.includes(currentTalkAnimationName)) {
                    currentTalkAnimationName = availableAnimations[Math.floor(Math.random() * availableAnimations.length)];
                }
                const entry = setLoggedAnimation(TALK_TRACK_INDEX, currentTalkAnimationName, true, animationState);
                if (!entry) return null;
                currentTalkEntry = entry;
                updateTalkAnimationLabel(currentTalkAnimationName);
                entry.alpha = 1;
                entry.mixDuration = 0;
                entry.mixTime = 0;
                if (playerContainerElement) {
                    playerContainerElement.dataset.talkSystem = 'legacy-loop-fallback';
                    playerContainerElement.dataset.talkOverlayAnimation = currentTalkAnimationName;
                }
                return entry;
            }

            function updateTalkOverlay() {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                talkTransitionController?.update();

                if (!animationState || !skeletonData) {
                    clearTalkOverlay();
                    return;
                }

                const stationary = !player.isMoving && Math.abs(player.vx) < 0.01 && player.onGround && !player.isLandingAnimation;
                const canTalk = manualTalkingActive
                    && stationary
                    && player.lieState === 'none'
                    && player.fidgetState === 'none';
                const talkRequested = beaverConversationState.active
                    || Boolean(chatBotController?.isChatting?.())
                    || canTalk;

                if (talkRequested) {
                    talkSpeechActive = true;
                    if (!startTalkOverlay(animationState, skeletonData)) {
                        talkSpeechActive = false;
                        speechBubbleController?.handleTalkState(false);
                        return;
                    }
                    speechBubbleController?.handleTalkState(true);
                    return;
                }

                const interruptedByMovement = !stationary
                    || player.lieState !== 'none'
                    || player.fidgetState !== 'none';
                if (talkTransitionController?.isActive()) {
                    stopTalkOverlay({ immediate: interruptedByMovement });
                } else if (!talkTransitionController && currentTalkEntry) {
                    clearTalkOverlay();
                } else {
                    talkSpeechActive = false;
                    speechBubbleController?.handleTalkState(false);
                }
            }

            function updateTalkAnimationLabel(animationName) {
                if (!talkAnimationLabelElement) return;
                const shortName = String(animationName || '').split('/').pop() || '';
                talkAnimationLabelElement.textContent = shortName;
                talkAnimationLabelElement.title = animationName || '';
            }









            function clearSwordTrack() {
                if (spinePlayer?.animationState) {
                    clearTrackLogged(SWORD_TRACK_INDEX, spinePlayer.animationState);
                }
                swordModeState.holdEntry = null;
                swordModeState.unsheathEntry = null;
                swordModeState.sheathEntry = null;
                swordModeState.attackEntry = null;
                swordModeState.attackEntry = null;
                swordModeState.active = false;
            }

            function playSwordHoldLoop() {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData || !skeletonData.findAnimation(SWORD_HOLD_ANIMATION)) {
                    clearSwordTrack();
                    swordModeState.busy = false;
                    return;
                }
                const entry = setLoggedAnimation(SWORD_TRACK_INDEX, SWORD_HOLD_ANIMATION, true, animationState);
                if (!entry) {
                    clearSwordTrack();
                    swordModeState.busy = false;
                    return;
                }
                entry.alpha = 1;
                entry.mixDuration = 0;
                swordModeState.unsheathEntry = null;
                swordModeState.sheathEntry = null;
                entry.listener = {
                    end: () => {
                        if (swordModeState.holdEntry === entry) {
                            swordModeState.holdEntry = null;
                            swordModeState.active = false;
                        }
                    },
                    dispose: () => {
                        if (swordModeState.holdEntry === entry) {
                            swordModeState.holdEntry = null;
                            swordModeState.active = false;
                        }
                    }
                };
                swordModeState.holdEntry = entry;
                swordModeState.active = true;
                swordModeState.busy = false;
            }

            function startSwordMode() {
                if (swordModeState.busy) return;
                swordModeState.busy = true;
                swordModeState.active = false;
                clearSwordTrack();
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) {
                    swordModeState.busy = false;
                    return;
                }
                if (!skeletonData.findAnimation(SWORD_UNSHEATH_ANIMATION)) {
                    playSwordHoldLoop();
                    return;
                }
                const entry = setLoggedAnimation(SWORD_TRACK_INDEX, SWORD_UNSHEATH_ANIMATION, false, animationState);
                if (!entry) {
                    playSwordHoldLoop();
                    return;
                }
                entry.alpha = 0;
                entry.mixDuration = 0;
                swordModeState.unsheathEntry = entry;
                swordModeState.sheathEntry = null;
                entry.listener = {
                    complete: () => {
                        if (swordModeState.unsheathEntry === entry) swordModeState.unsheathEntry = null;
                        playSwordHoldLoop();
                    },
                    end: () => {
                        if (swordModeState.unsheathEntry === entry) swordModeState.unsheathEntry = null;
                        if (!swordModeState.active) swordModeState.busy = false;
                    },
                    dispose: () => {
                        if (swordModeState.unsheathEntry === entry) swordModeState.unsheathEntry = null;
                        if (!swordModeState.active) swordModeState.busy = false;
                    }
                };
            }

            function stopSwordMode() {
                if (swordModeState.busy) return;
                swordModeState.busy = true;
                swordModeState.active = false;
                swordModeState.holdEntry = null;
                swordModeState.attackEntry = null;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) {
                    clearSwordTrack();
                    swordModeState.busy = false;
                    return;
                }
                if (!skeletonData.findAnimation(SWORD_SHEATH_ANIMATION)) {
                    clearSwordTrack();
                    swordModeState.busy = false;
                    return;
                }
                const entry = setLoggedAnimation(SWORD_TRACK_INDEX, SWORD_SHEATH_ANIMATION, false, animationState);
                if (!entry) {
                    clearSwordTrack();
                    swordModeState.busy = false;
                    return;
                }
                entry.alpha = 1;
                entry.mixDuration = 0;
                swordModeState.sheathEntry = entry;
                swordModeState.unsheathEntry = null;
                entry.listener = {
                    complete: () => {
                        if (swordModeState.sheathEntry === entry) swordModeState.sheathEntry = null;
                        clearSwordTrack();
                        swordModeState.busy = false;
                    },
                    end: () => {
                        if (swordModeState.sheathEntry === entry) swordModeState.sheathEntry = null;
                        clearSwordTrack();
                        swordModeState.busy = false;
                    },
                    dispose: () => {
                        if (swordModeState.sheathEntry === entry) swordModeState.sheathEntry = null;
                        clearSwordTrack();
                        swordModeState.busy = false;
                    }
                };
            }

            function playSwordAttack() {
                const existingAttackEntry = swordModeState.attackEntry;
                const attackRunning = !!existingAttackEntry;
                if (!swordModeState.active || (swordModeState.busy && !attackRunning)) return;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData || !skeletonData.findAnimation(SWORD_ATTACK_ANIMATION)) {
                    return;
                }
                if (attackRunning) {
                    existingAttackEntry.trackTime = 0;
                    existingAttackEntry.animationLast = 0;
                    existingAttackEntry.nextAnimationLast = 0;
                    return;
                }
                swordModeState.busy = false;
                const entry = setLoggedAnimation(SWORD_TRACK_INDEX, SWORD_ATTACK_ANIMATION, false, animationState);
                if (!entry) {
                    swordModeState.busy = false;
                    playSwordHoldLoop();
                    return;
                }
                entry.alpha = 1;
                entry.mixDuration = 0;
                swordModeState.attackEntry = entry;
                swordModeState.holdEntry = null;
                const finalizeAttack = () => {
                    if (swordModeState.attackEntry === entry) {
                        swordModeState.attackEntry = null;
                    }
                    if (swordModeState.active) {
                        playSwordHoldLoop();
                    } else {
                        swordModeState.busy = false;
                    }
                };
                const handleAttackEvent = (trackEntry, event) => {
                    if (swordModeState.attackEntry !== trackEntry) return;
                    const eventName = event?.data?.name;
                    if (typeof eventName !== 'string') return;
                    if (eventName.toLowerCase() === 'hitvfx') {
                        playSwordHitVfx();
                        handleSwordHitEvent();
                    }
                };
                entry.listener = {
                    event: handleAttackEvent,
                    complete: finalizeAttack,
                    end: finalizeAttack,
                    dispose: finalizeAttack
                };
            }

            function toggleSwordMode() {
                if (swordModeState.busy) return;
                if (swordModeState.active) {
                    stopSwordMode();
                } else {
                    startSwordMode();
                }
            }

            function recordUserActivity() {
                inactivityTimer = 0;
                if (player.fidgetState === 'starting' || player.fidgetState === 'loop') {
                    stopFidgetSequence();
                }
            }



            function selectNextFidgetSequence() {
                const skeletonData = spinePlayer?.skeleton?.data;

                // Safety check
                if (!skeletonData || !FIDGET_SEQUENCES.length) return null;

                // 1. Filter the list to find only the sequences where all animations actually exist
                const validCandidates = FIDGET_SEQUENCES.filter(candidate => {
                    return skeletonData.findAnimation(candidate.start) &&
                        skeletonData.findAnimation(candidate.loop) &&
                        skeletonData.findAnimation(candidate.stop);
                });

                // 2. If no valid sequences were found, return null
                if (validCandidates.length === 0) return null;

                // 3. Pick a random index from the valid candidates
                const randomIndex = Math.floor(Math.random() * validCandidates.length);

                return validCandidates[randomIndex];
            }

            function enterFidgetLoop(sequence) {
                if (player.fidgetState !== 'starting' || currentFidgetSequence !== sequence) return;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData || !skeletonData.findAnimation(sequence.loop)) {
                    finalizeFidgetStop();
                    return;
                }
                player.fidgetState = 'loop';
                const entry = setLoggedAnimation(0, sequence.loop, true, animationState);
                if (entry) entry.mixDuration = 0;
            }

            function finalizeFidgetStop() {
                currentFidgetSequence = null;
                player.fidgetState = 'none';
                inactivityTimer = 0;
                setSpineAnimation(ANIM_IDLE, true);
            }

            function startFidgetSequence() {
                if (player.fidgetState !== 'none' || player.lieState !== 'none') return;
                const sequence = selectNextFidgetSequence();
                if (!sequence) {
                    inactivityTimer = 0;
                    return;
                }
                currentFidgetSequence = sequence;
                player.fidgetState = 'starting';
                player.vx = 0;
                player.isMoving = false;
                playSpineAnimationOnce(sequence.start, 0, () => enterFidgetLoop(sequence));
            }

            function stopFidgetSequence() {
                if (!currentFidgetSequence) {
                    inactivityTimer = 0;
                    player.fidgetState = 'none';
                    return;
                }
                if (player.fidgetState === 'stopping') return;
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                const stopName = currentFidgetSequence.stop;
                if (!animationState || !skeletonData || !skeletonData.findAnimation(stopName)) {
                    finalizeFidgetStop();
                    return;
                }
                player.fidgetState = 'stopping';
                playSpineAnimationOnce(stopName, 0, () => finalizeFidgetStop());
            }

            function shouldAllowFidget() {
                if (player.lieState !== 'none' || player.fidgetState !== 'none') return false;
                if (!player.onGround || player.isLandingAnimation) return false;
                if (player.isMoving) return false;
                if (Math.abs(player.vx) > FIDGET_SPEED_THRESHOLD || Math.abs(player.vy) > FIDGET_SPEED_THRESHOLD) return false;
                if (currentTalkEntry) return false;
                if (manualTalkingActive) return false;
                if (isActionActive('chat')) return false;
                if (buildModeEnabled) return false;
                return true;
            }

            function shouldMaintainFidget() {
                if (player.lieState !== 'none') return false;
                if (!player.onGround || player.isLandingAnimation) return false;
                if (player.isMoving) return false;
                if (Math.abs(player.vx) > FIDGET_SPEED_THRESHOLD || Math.abs(player.vy) > FIDGET_SPEED_THRESHOLD) return false;
                return true;
            }

            function updateFidget(dt) {
                if (player.sitState !== 'none') return;
                if (!spinePlayer || !spinePlayer.animationState) return;
                if (player.fidgetState === 'none') {
                    if (shouldAllowFidget()) {
                        inactivityTimer = Math.min(inactivityTimer + dt, FIDGET_IDLE_DELAY + 1);
                        if (inactivityTimer >= FIDGET_IDLE_DELAY) {
                            startFidgetSequence();
                        }
                    } else {
                        inactivityTimer = 0;
                    }
                    return;
                }
                if (!shouldMaintainFidget()) {
                    stopFidgetSequence();
                    return;
                }
                if (player.fidgetState === 'loop') {
                    inactivityTimer = 0;
                }
            }

            function blinkBlockedByCurrentAnimation() {
                const animationState = spinePlayer?.animationState;
                if (!animationState) return false;
                const indices = new Set([0, WIND_TRACK_INDEX, LANDING_OVERLAY_TRACK_INDEX, STOP_OVERLAY_TRACK_INDEX, TALK_TRACK_INDEX, EMOTE_TRACK_INDEX, SWORD_TRACK_INDEX]);
                const tracksArray = Array.isArray(animationState.tracks) ? animationState.tracks : [];
                for (let i = 0; i < tracksArray.length; i++) {
                    indices.add(i);
                }
                for (const key of Object.keys(animationTrackLog)) {
                    const idx = Number(key);
                    if (Number.isFinite(idx)) indices.add(idx);
                }
                for (const index of indices) {
                    const entry = animationState.getCurrent?.(index);
                    const name = entry?.animation?.name;
                    if (name && BLINK_ANIMATION_BLOCKLIST.has(name)) {
                        return true;
                    }
                }
                for (const name of Object.values(animationTrackLog)) {
                    if (name && BLINK_ANIMATION_BLOCKLIST.has(name)) {
                        return true;
                    }
                }
                if (player?.currentAnimation && BLINK_ANIMATION_BLOCKLIST.has(player.currentAnimation)) {
                    return true;
                }
                return false;
            }

            function scheduleNextBlink() {
                blinkTimer = randomFloat(BLINK_MIN_DELAY, BLINK_MAX_DELAY);
            }

            function handleBlinkEntryFinished(entry) {
                if (currentBlinkEntry === entry) {
                    currentBlinkEntry = null;
                    const state = spinePlayer?.animationState;
                    if (state && state.getCurrent(BLINK_TRACK_INDEX) === entry) {
                        clearTrackLogged(BLINK_TRACK_INDEX, state);
                    }
                    scheduleNextBlink();
                }
            }

            function playBlinkAnimation() {
                if (blinkBlockedByCurrentAnimation()) {
                    scheduleNextBlink();
                    return;
                }
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData) return;
                if (!skeletonData.findAnimation(BLINK_ANIMATION_NAME)) {
                    blinkTimer = Number.POSITIVE_INFINITY;
                    return;
                }
                const entry = setLoggedAnimation(BLINK_TRACK_INDEX, BLINK_ANIMATION_NAME, false, animationState);
                if (!entry) {
                    scheduleNextBlink();
                    return;
                }
                currentBlinkEntry = entry;
                entry.alpha = 1;
                entry.mixDuration = 0;
                entry.listener = {
                    complete: () => handleBlinkEntryFinished(entry),
                    end: () => handleBlinkEntryFinished(entry),
                    dispose: () => handleBlinkEntryFinished(entry)
                };
            }

            function updateBlink(dt) {
                if (!spinePlayer?.animationState || !spinePlayer?.skeleton?.data) return;
                if (blinkBlockedByCurrentAnimation()) {
                    if (currentBlinkEntry) {
                        handleBlinkEntryFinished(currentBlinkEntry);
                    }
                    return;
                }
                if (currentBlinkEntry) {
                    const activeEntry = spinePlayer.animationState.getCurrent(BLINK_TRACK_INDEX);
                    if (activeEntry !== currentBlinkEntry) {
                        handleBlinkEntryFinished(currentBlinkEntry);
                    }
                    return;
                }
                if (!Number.isFinite(blinkTimer)) return;
                blinkTimer -= dt;
                if (blinkTimer <= 0) {
                    playBlinkAnimation();
                }
            }

            // Gradually blend unsheath and sheath overlays.
            function updateSwordMixing(dt) {
                if (!spinePlayer?.animationState) return;
                const currentEntry = spinePlayer.animationState.getCurrent(SWORD_TRACK_INDEX);
                if (!currentEntry) {
                    swordModeState.unsheathEntry = null;
                    swordModeState.sheathEntry = null;
                    swordModeState.attackEntry = null;
                    return;
                }

                if (swordModeState.unsheathEntry === currentEntry) {
                    const duration = swordModeState.unsheathEntry.animation?.duration ?? swordModeState.unsheathEntry.animationEnd ?? 0;
                    swordModeState.unsheathEntry.alpha = duration > 0
                        ? Math.min(Math.max(swordModeState.unsheathEntry.trackTime / duration, 0), 1)
                        : 1;
                } else if (swordModeState.unsheathEntry) {
                    swordModeState.unsheathEntry = null;
                }

                if (swordModeState.sheathEntry === currentEntry) {
                    const duration = swordModeState.sheathEntry.animation?.duration ?? swordModeState.sheathEntry.animationEnd ?? 0;
                    swordModeState.sheathEntry.alpha = duration > 0
                        ? Math.max(0, 1 - Math.min(Math.max(swordModeState.sheathEntry.trackTime / duration, 0), 1))
                        : 0;
                } else if (swordModeState.sheathEntry) {
                    swordModeState.sheathEntry = null;
                }

                if (swordModeState.attackEntry && swordModeState.attackEntry !== currentEntry) {
                    swordModeState.attackEntry = null;
                }
            }

            /*
            function logAnimationTracks() {
                const animationState = spinePlayer?.animationState;
                if (!animationState) return;
                const tracksArray = Array.isArray(animationState.tracks) ? animationState.tracks : [];
                const maxIndex = Math.max(tracksArray.length, WIND_TRACK_INDEX + 1, LANDING_OVERLAY_TRACK_INDEX + 1, STOP_OVERLAY_TRACK_INDEX + 1, TALK_TRACK_INDEX + 1, EMOTE_TRACK_INDEX + 1, SWORD_TRACK_INDEX + 1, BLINK_TRACK_INDEX + 1, JETPACK_TRACK_INDEX + 1, 1);
                const parts = [];
                for (let i = 0; i < maxIndex; i++) {
                    const entry = animationState.getCurrent(i);
                    if (!entry) {
                        parts.push(`Track ${i}: none (mix=0%)`);
                        continue;
                    }
                    const name = entry.animation?.name || 'none';
                    const loop = entry.loop === true;
                    const alpha = Math.max(0, Math.min(1, entry.alpha ?? 0));
                    const mixPercent = Math.round(alpha * 1000) / 10;
                    const mixDisplay = `${mixPercent.toFixed(1)}%`;
                    parts.push(`Track ${i}: ${name} (${loop ? 'loop' : 'once'}) mix=${mixDisplay}`);
                }
                console.log(`Tracks => ${parts.join(' | ')}`);
            }
            */

            function updatePlayerDimensionsFromSkeleton() {
                if (!spinePlayer || !spinePlayer.skeleton) return;
                const physicsUpdate = (typeof spine?.Physics?.update !== 'undefined')
                    ? spine.Physics.update
                    : (typeof window.spine?.Physics?.update !== 'undefined'
                        ? window.spine.Physics.update
                        : 2);
                spinePlayer.skeleton.updateWorldTransform(physicsUpdate);
                const clipper = spinePlayer.sceneRenderer?.skeletonRenderer?.getSkeletonClipping?.();
                TMP_BOUNDS_ARRAY[0] = 0; TMP_BOUNDS_ARRAY[1] = 0;
                spinePlayer.skeleton.getBounds(TMP_BOUNDS_OFFSET, TMP_BOUNDS_SIZE, TMP_BOUNDS_ARRAY, clipper);
                const visualWidth = TMP_BOUNDS_SIZE.x * SPINE_RENDER_SCALE;
                const visualHeight = TMP_BOUNDS_SIZE.y * SPINE_RENDER_SCALE;
                if (!Number.isFinite(visualWidth) || !Number.isFinite(visualHeight) || visualWidth <= 0 || visualHeight <= 0) return;

                // FIX: Only use bounds for visual container, NOT for hitbox.
                const prevCenterX = player.x + player.width / 2;
                const prevBottom = player.y + player.height;

                // Visual container now stays fixed; viewport defined once via PLAYER_VIEWPORT_CONFIG.

                // Keep the small collision box for gameplay physics.
                PLAYER_HITBOX_WIDTH = PLAYER_COLLISION_BOX.width;
                PLAYER_HITBOX_HEIGHT = PLAYER_COLLISION_BOX.height;
                player.width = PLAYER_HITBOX_WIDTH;
                player.height = PLAYER_HITBOX_HEIGHT;

                // Maintain the player position relative to the hitbox with offsets.
                player.x = prevCenterX - player.width / 2 + PLAYER_HITBOX_OFFSET_X;
                player.y = prevBottom - player.height + PLAYER_HITBOX_OFFSET_Y;

                // Respect world bounds and ground collision using the hitbox.
                if (player.x < 0) player.x = 0;
                if (player.x + player.width > WORLD_WIDTH) player.x = WORLD_WIDTH - player.width;
                const groundY = WORLD_HEIGHT - FLOOR_HEIGHT - player.height;
                if (player.y > groundY) {
                    player.y = groundY;
                    player.onGround = true;
                    player.vy = 0;
                    player.currentPlatform = null;
                    player.airJumpAvailable = true;
                    player.hasDoubleJumped = false;
                    player.doubleJumpFallGrace = 0;
                }
            }

            function playSpineAnimationOnce(animationName, trackIndex = 0, onComplete = null) {
                if (trackIndex === 0 && isEmotePlaying()) return;
                if (player.isSkidding && trackIndex === 0 && animationName !== ANIM_SKID) return;
                if (spinePlayer?.animationState && spinePlayer.skeleton.data.findAnimation(animationName)) {
                    const entry = setLoggedAnimation(trackIndex, animationName, false);
                    if (!entry) return;
                    if (onComplete) entry.listener = { complete: onComplete };
                    attachDebugListenerToEntry(entry);
                    player.currentAnimation = animationName;
                }
            }

            function playMountAnimationWithEvents(animationName, onEvent, onComplete) {
                const animationState = spinePlayer?.animationState;
                const skeletonData = spinePlayer?.skeleton?.data;
                if (!animationState || !skeletonData?.findAnimation?.(animationName)) return null;
                const entry = setLoggedAnimation(0, animationName, false, animationState);
                if (!entry) return null;
                let finished = false;
                const finish = () => {
                    if (finished) return;
                    finished = true;
                    onComplete?.();
                };
                entry.listener = {
                    event: (_trackEntry, event) => onEvent?.(event?.data?.name || '', event),
                    interrupt: finish,
                    complete: finish,
                    end: finish,
                    dispose: finish
                };
                attachDebugListenerToEntry(entry);
                player.currentAnimation = animationName;
                return entry;
            }

            function initGame() {
                ensurePlatformThickness();
                positionPlayerAtWorldCenterOnce();
                player.vx = 0; player.vy = 0; player.onGround = false; player.facingRight = false; player.currentPlatform = null;
                player.isRunning = false; player.lieState = 'none'; player.fidgetState = 'none'; player.sitState = 'none'; player.sittingChair = null; player.doorState = 'none'; player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; player.isLandingAnimation = false; player.groundAnimCooldown = 0; player.landingInputLockTimer = 0; player.landingTooHard = false; player.landingHardBlendTriggered = false; player.lastLandingImpactSpeed = 0; player.landingMomentumVx = 0;
                activeDoorInteraction = null;
                resetDoorRushState();
                coinsCollected = 0;
                updateCoinCounterDisplay();
                basePlatforms = [{ x: 0, y: WORLD_HEIGHT - FLOOR_HEIGHT, width: WORLD_WIDTH, height: blockHeight, isBuild: false, oneWay: false }];
                recomputePlatforms();
                spawnCoinsForCurrentPlatforms();
            }

            function handleInput(dt) {
                // --- 1. BLOCKING CHECKS (Sit, Lie, Chat, etc) ---
                if (doorRushState.active) {
                    player.isRunning = true;
                    player.isMoving = true;
                    player.previousMoveType = 'run';
                    player.lastMoveType = 'run';
                    player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }
                if (player.doorState !== 'none') {
                    player.vx = 0; player.vy = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                    player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }
                if (beaverConversationState.active) {
                    player.vx = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                    player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }
                if (player.sitState !== 'none') {
                    const leftPressed = isActionActive('left'), rightPressed = isActionActive('right');
                    const jumpPressed = isActionActive('jump');
                    if (player.sitState === 'seated' && (leftPressed || rightPressed || jumpPressed)) {
                        stopSitting();
                    } else {
                        player.vx = 0; player.vy = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                        player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                        clearStopOverlay(); jetpackState.thrusting = false;
                        return;
                    }
                }
                if (player.lieState !== 'none' || player.fidgetState !== 'none' || (npcEnabled && chatBotController?.shouldBlockGameInput?.())) {
                    player.vx = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                    player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }
                if (player.landingInputLockTimer > 0) {
                    if (player.landingTooHard && player.isLandingAnimation) {
                        const landingFriction = LANDING_MOMENTUM_DECEL * dt;
                        if (player.landingMomentumVx > 0) player.landingMomentumVx = Math.max(0, player.landingMomentumVx - landingFriction);
                        else if (player.landingMomentumVx < 0) player.landingMomentumVx = Math.min(0, player.landingMomentumVx + landingFriction);
                        const sliding = Math.abs(player.landingMomentumVx) > LANDING_MOMENTUM_STOP_EPSILON;
                        player.vx = sliding ? player.landingMomentumVx : 0;
                        if (!sliding) player.landingMomentumVx = 0;
                        if (player.vx < 0) player.facingRight = true; else if (player.vx > 0) player.facingRight = false;
                        player.isRunning = false; player.isMoving = sliding; player.previousMoveType = sliding ? 'run' : 'idle'; player.lastMoveType = sliding ? 'run' : 'idle';
                        clearStopOverlay(); jetpackState.thrusting = false;
                        return;
                    }
                    player.vx = 0; player.isRunning = false; player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }
                if (randomAnimationTestState.active) {
                    player.vx = 0; player.vy = 0; player.isRunning = false; player.jumpHeld = false; player.isJumping = false; player.jumpHoldTime = 0;
                    player.isMoving = false; player.previousMoveType = 'idle'; player.lastMoveType = 'idle';
                    clearStopOverlay(); jetpackState.thrusting = false;
                    return;
                }

                if (pendingFacingFlipTimer > 0) {
                    pendingFacingFlipTimer = Math.max(0, pendingFacingFlipTimer - dt);
                    if (pendingFacingFlipTimer === 0 && pendingFacingRight !== null) {
                        player.facingRight = pendingFacingRight;
                        pendingFacingRight = null;
                    }
                }

                // --- 2. CAPTURE PREVIOUS PHYSICS STATE ---
                const currentPhysicalVelocity = player.vx;
                const prevMoveType = player.lastMoveType;
                const wasOnGroundAtInput = player.onGround;

                // --- 3. READ RAW INPUTS ---
                const leftPressed = isActionActive('left');
                const rightPressed = isActionActive('right');
                const keyboardJump = isActionActive('jump');
                const runPressed = isActionActive('run');

                const joystickActive = joystickState.active, joystickX = joystickActive ? joystickState.x : 0;
                const joystickStrength = joystickActive ? joystickState.strength : 0, joystickJump = joystickActive && joystickState.y > JOYSTICK_JUMP_THRESHOLD;
                const joystickHorizontal = joystickActive && Math.abs(joystickX) > JOYSTICK_DEADZONE;

                // --- 4. CALCULATE MOVEMENT INTENT ---
                let targetVelocityX = 0;
                let isRunning = false, isMoving = false;
                let slidingOverride = false;

                if (slopeSlideState.active && player.onGround && player.currentPlatform?.isSlope) {
                    const p = player.currentPlatform;
                    const downhill = (p.y2 > p.y1) ? 1 : -1;
                    const dirX = downhill === 1 ? (p.x2 - p.x1) / (p.length || 1) : (p.x1 - p.x2) / (p.length || 1);
                    targetVelocityX = dirX * SLOPE_SLIDE_SPEED;
                    player.isRunning = false;
                    player.isMoving = true;
                    player.lastMoveType = 'slide';
                    slidingOverride = true;
                    if (targetVelocityX < 0) player.facingRight = true; else if (targetVelocityX > 0) player.facingRight = false;
                    player.vx = targetVelocityX;
                }

                if (!slidingOverride) {
                    if (joystickHorizontal) {
                        const horizontalInput = Math.max(-1, Math.min(1, joystickX));
                        const radialStrength = Math.min(1, joystickStrength);
                        const walkMix = Math.min(1, radialStrength / JOYSTICK_RUN_THRESHOLD);
                        const runMix = radialStrength <= JOYSTICK_RUN_THRESHOLD ? 0 : Math.min(1, (radialStrength - JOYSTICK_RUN_THRESHOLD) / (1 - JOYSTICK_RUN_THRESHOLD));
                        let targetSpeed = PLAYER_WALK_SPEED * walkMix + (PLAYER_RUN_SPEED - PLAYER_WALK_SPEED) * runMix;
                        if (runPressed) targetSpeed = PLAYER_RUN_SPEED;
                        targetVelocityX = horizontalInput * targetSpeed;
                        isMoving = Math.abs(targetVelocityX) > 0.01;
                        isRunning = (radialStrength >= JOYSTICK_RUN_THRESHOLD || runPressed) && isMoving;
                    } else {
                        const movingLeft = leftPressed && !rightPressed;
                        const movingRight = rightPressed && !leftPressed;
                        isMoving = movingLeft || movingRight;
                        const speed = (runPressed && isMoving) ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
                        if (movingLeft) { targetVelocityX = -speed; }
                        else if (movingRight) { targetVelocityX = speed; }
                        isRunning = runPressed && isMoving;
                    }

                    // ============================================================
                    // ▼▼▼ SKID LOGIC FIX ▼▼▼
                    // We check the RAW inputs (Active Intent) vs Current Physics
                    // ============================================================

                    if (player.onGround && !player.isSkidding && !player.isLandingAnimation && !mountController?.controlsGroundMomentum?.()) {
                        
                        // 1. KEYBOARD SKID CHECK
                        // Simple binary check: Moving one way, pressing the other
                        const oppositeKeyboard = (currentPhysicalVelocity > 0 && leftPressed) || 
                                                 (currentPhysicalVelocity < 0 && rightPressed);
                                                 
                        // Threshold: slightly higher than walk speed to prevent skidding while just walking
                        const fastEnoughForKeyboard = Math.abs(currentPhysicalVelocity) > (PLAYER_WALK_SPEED + 50);

                        // 2. JOYSTICK SKID CHECK
                        // Analog input creates a specific challenge:
                        // We need to ensure the stick is pushed FIRMLY in the opposite direction.
                        // If we don't check for strength, slight movements near the center might trigger skids.
                        
                        // Condition A: Are we running fast enough? (e.g. > 60% of Run Speed)
                        // We use PLAYER_RUN_SPEED here instead of the hardcoded 1200 constant
                        const fastEnoughForJoystick = Math.abs(currentPhysicalVelocity) > (PLAYER_RUN_SPEED * 0.6);

                        // Condition B: Is the joystick pushed firmly? (> 0.5 magnitude) 
                        // AND is it in the opposite direction of movement?
                        const joystickOpposite = joystickHorizontal && 
                                                 Math.abs(joystickX) > JOYSTICK_SKID_STICK_THRESHOLD && 
                                                 (joystickX * currentPhysicalVelocity < 0);

                        // 3. EXECUTE
                        if ((fastEnoughForKeyboard && oppositeKeyboard) || (fastEnoughForJoystick && joystickOpposite)) {
                            playRunSkidAnimation();
                        }
                    }
                    // ============================================================

                    if (player.isSkidding) {
                        const skidFriction = 2500 * dt;
                        if (player.vx > 0) player.vx = Math.max(0, player.vx - skidFriction);
                        else player.vx = Math.min(0, player.vx + skidFriction);
                        if (Math.abs(player.vx) < 50) {
                            player.isSkidding = false;
                            player.vx = 0;
                        }
                        player.isRunning = false;
                    } else {
                        player.vx = targetVelocityX;
                        player.isRunning = isRunning;
                        player.isMoving = isMoving;
                        if (targetVelocityX === 0) {
                            pendingFacingRight = null;
                            pendingFacingFlipTimer = 0;
                        } else {
                            const desiredFacing = targetVelocityX < 0;
                            if (player.facingRight === desiredFacing) {
                                pendingFacingRight = null;
                                pendingFacingFlipTimer = 0;
                            } else if (pendingFacingRight !== desiredFacing && pendingFacingFlipTimer <= 0) {
                                pendingFacingRight = desiredFacing;
                                pendingFacingFlipTimer = RUN_FLIP_DELAY_SECONDS;
                            }
                        }
                    }

                    player.lastMoveType = isMoving ? (isRunning ? 'run' : 'walk') : 'idle';
                }

                player.previousMoveType = prevMoveType;
                if (player.isMoving) clearStopOverlay();
                if (player.isLandingAnimation && player.onGround && Math.abs(player.vx) > 0.01) {
                    player.isLandingAnimation = false;
                    player.landingTooHard = false;
                    player.landingInputLockTimer = 0;
                    player.groundAnimCooldown = 0;
                    applyGroundAnimation();
                }

                // --- 5. JUMP LOGIC ---
                const jumpPressed = keyboardJump || joystickJump;
                if (isEmotePlaying() && (isMoving || jumpPressed)) {
                    cancelActiveEmote('movement input', { isMoving, jumpPressed, joystickActive });
                }
                const wasJumpHeld = player.jumpHeld;
                player.jumpHeld = jumpPressed;
                const jumpJustPressed = jumpPressed && !wasJumpHeld;

                if (jumpJustPressed && player.isSkidding) {
                    player.isSkidding = false;
                    player.groundAnimCooldown = 0;
                }

                if (!jetpackState.enabled && !mountController?.usesBouncePump?.()
                    && jumpPressed && player.onGround) {
                    clearStopOverlay();
                    player.vy = JUMP_VELOCITY; player.onGround = false; player.isJumping = true; player.jumpHoldTime = 0;
                    player.airJumpAvailable = true; player.hasDoubleJumped = false; player.doubleJumpFallGrace = DOUBLE_JUMP_FALL_GRACE;
                    if (!mountController?.suppressesJumpAnimations?.()) {
                        playSpineAnimationOnce(ANIM_JUMP_UP, 0, () => {
                            if (player.currentAnimation !== ANIM_JUMP_UP) return;
                            player.jumpUpIntroPlayed = true;
                            if (!player.onGround) {
                                setSpineAnimation(ANIM_JUMP_UP_LOOP, true);
                            }
                        });
                    }
                    player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; player.isLandingAnimation = false; player.groundAnimCooldown = GROUND_ANIMATION_LOCKOUT;
                    player.isSkidding = false;
                } else if (!jetpackState.enabled && !mountController?.usesBouncePump?.()
                    && jumpJustPressed && !player.onGround && player.airJumpAvailable) {
                    clearStopOverlay();
                    player.vy = JUMP_VELOCITY; player.isJumping = true; player.jumpHoldTime = 0;
                    player.airJumpAvailable = false;
                    player.hasDoubleJumped = true;
                    player.doubleJumpFallGrace = 0;
                    if (!mountController?.suppressesJumpAnimations?.()) {
                        playSpineAnimationOnce(ANIM_DOUBLE_JUMP_UP, 0, () => {
                            if (player.currentAnimation !== ANIM_DOUBLE_JUMP_UP) return;
                            player.jumpUpIntroPlayed = true;
                            if (!player.onGround) {
                                setSpineAnimation(ANIM_DOUBLE_JUMP_UP_LOOP, true);
                            }
                        });
                    }
                    player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; player.isLandingAnimation = false; player.groundAnimCooldown = GROUND_ANIMATION_LOCKOUT;
                }

                // --- 6. JETPACK LOGIC ---
                if (jetpackState.enabled) {
                    if (jumpPressed && jetpackState.fuel > 0) {
                        jetpackState.thrusting = true;
                        player.isJumping = false;
                        if (wasOnGroundAtInput) { player.onGround = false; player.jumpHoldTime = 0; }
                        clearStopOverlay();
                        player.isSkidding = false;
                    } else {
                        jetpackState.thrusting = false;
                    }
                } else {
                    jetpackState.thrusting = false;
                }
            }

            function applyJetpackThrust(dt) {
                if (!jetpackState.enabled || !jetpackState.thrusting) return;
                if (jetpackState.fuel <= 0) {
                    jetpackState.thrusting = false;
                    jetpackState.fuel = 0;
                    return;
                }
                jetpackState.fuel = Math.max(0, jetpackState.fuel - JETPACK_BURN_RATE * dt);
                const thrustMultiplier = getJetpackThrustMultiplier();
                player.vy += (JETPACK_THRUST_ACCEL * thrustMultiplier) * dt;
                if (JETPACK_MAX_ASCENT_SPEED < 0) {
                    player.vy = Math.max(player.vy, JETPACK_MAX_ASCENT_SPEED);
                }
                if (jetpackState.fuel <= 0) {
                    jetpackState.thrusting = false;
                    jetpackState.fuel = 0;
                }
            }
            function updateJetpackRecharge(dt) {
                if (jetpackState.fuel > JETPACK_MAX_FUEL) {
                    jetpackState.fuel = JETPACK_MAX_FUEL;
                }
                const shouldRecharge = player.onGround && (!jetpackState.thrusting || jetpackState.fuel <= 0 || !jetpackState.enabled);
                if (!shouldRecharge) return;
                const rate = player.onGround ? JETPACK_REFUEL_RATE_GROUNDED : JETPACK_REFUEL_RATE_AIRBORNE;
                if (rate > 0 && jetpackState.fuel < JETPACK_MAX_FUEL) {
                    jetpackState.fuel = Math.min(JETPACK_MAX_FUEL, jetpackState.fuel + rate * dt);
                }
            }
            function updatePlayer(dt) {
                if (doorRushState.active) {
                    updateDoorRush(dt);
                    return;
                }
                if (player.doorState !== 'none') {
                    player.vx = 0; player.vy = 0;
                    player.onGround = true;
                    player.currentPlatform = null;
                    return;
                }
                if (player.sitState !== 'none') { updateSitting(dt); return; }
                const wasOnGround = player.onGround;
                const previousVy = player.vy;
                let groundedPlatform = null;
                if (player.isJumping) player.jumpHoldTime += dt;
                if (player.doubleJumpFallGrace > 0) {
                    if (player.onGround) player.doubleJumpFallGrace = 0;
                    else player.doubleJumpFallGrace = Math.max(0, player.doubleJumpFallGrace - dt);
                }
                if (player.landingInputLockTimer > 0) player.landingInputLockTimer = Math.max(0, player.landingInputLockTimer - dt);
                if (player.groundAnimCooldown > 0) player.groundAnimCooldown = Math.max(0, player.groundAnimCooldown - dt);
                player.vy += GRAVITY * dt;
                if (player.isJumping) {
                    if (player.jumpHeld && player.jumpHoldTime <= MAX_JUMP_HOLD_TIME && player.vy < 0) player.vy += JUMP_HOLD_ACCELERATION * dt;
                    else player.isJumping = false;
                }
                if (!player.jumpHeld && player.vy < 0) player.vy += JUMP_RELEASE_DAMPING * dt;
                applyJetpackThrust(dt);
                player.y += player.vy * dt; player.x += player.vx * dt;
                const prevBottom = (player.y - player.vy * dt) + player.height;
                player.onGround = false;
                if (!mountController?.ignoresPlatforms?.()) for (const p of platforms) {
                    const minX = Math.min(p.x, (p.x1 ?? p.x)), maxX = Math.max(p.x + p.width, (p.x2 ?? p.x + p.width));
                    const minY = Math.min(p.y, (p.y1 ?? p.y)), maxY = Math.max(p.y + p.height, (p.y2 ?? p.y + p.height));
                    if (!(player.x < maxX && player.x + player.width > minX && player.y < maxY && player.y + player.height > minY - (p.thickness || 0))) continue;
                    if (p.isSlope) {
                        const dx = p.x2 - p.x1;
                        if (Math.abs(dx) < 1e-3) continue;
                        const footX = player.x + player.width * 0.5;
                        if (footX < Math.min(p.x1, p.x2) - COLLISION_EPSILON || footX > Math.max(p.x1, p.x2) + COLLISION_EPSILON) continue;
                        const t = (footX - p.x1) / dx;
                        const clampedT = Math.max(0, Math.min(1, t));
                        const surfaceY = p.y1 + (p.y2 - p.y1) * clampedT;
                        const feetY = player.y + player.height;
                        const snapPadding = Math.max(p.thickness || blockHeight, blockHeight) + COLLISION_EPSILON * 4;
                        const wasAbove = prevBottom <= surfaceY + snapPadding;
                        const feetNearSurface = feetY >= surfaceY - snapPadding && feetY <= surfaceY + snapPadding;
                        const descendingOrStanding = player.vy >= -20 || wasOnGround;
                        if (descendingOrStanding && wasAbove && feetNearSurface) {
                            player.y = surfaceY - player.height; player.vy = 0; player.onGround = true; player.isJumping = false; player.jumpHoldTime = 0; groundedPlatform = p;
                        }
                        continue;
                    }
                    if (player.vy >= 0 && prevBottom <= p.y + COLLISION_EPSILON && player.y + player.height >= p.y) {
                        player.y = p.y - player.height; player.vy = 0; player.onGround = true; player.isJumping = false; player.jumpHoldTime = 0; groundedPlatform = p;
                        continue;
                    }
                    if (p.oneWay) continue;
                    const prevRight = (player.x - player.vx * dt) + player.width;
                    if (player.vx > 0 && prevRight <= p.x + COLLISION_EPSILON && player.x + player.width >= p.x) { player.x = p.x - player.width; player.vx = 0; }
                    else if (player.vx < 0 && (player.x - player.vx * dt) >= p.x + p.width - COLLISION_EPSILON && player.x <= p.x + p.width) { player.x = p.x + p.width; player.vx = 0; }
                    else if (player.vy < 0 && (player.y - player.vy * dt) >= p.y + p.height - COLLISION_EPSILON && player.y <= p.y + p.height) { player.y = p.y + p.height; player.vy = 0; player.isJumping = false; player.jumpHoldTime = 0; }
                }
                if (!mountController?.ignoresPlatforms?.() && !player.onGround && platforms.length > 0) {
                    const ground = platforms[0];
                    if (player.x + player.width > ground.x && player.x < ground.x + ground.width && player.y + player.height >= ground.y) {
                        player.y = ground.y - player.height; if (player.vy > 0) player.vy = 0;
                        player.onGround = true; player.isJumping = false; player.jumpHoldTime = 0; groundedPlatform = ground;
                    }
                }
                player.currentPlatform = player.onGround ? groundedPlatform : null;
                if (player.onGround && groundedPlatform?.isSlope) {
                    const dx = Math.abs(groundedPlatform.x2 - groundedPlatform.x1);
                    const dy = Math.abs(groundedPlatform.y2 - groundedPlatform.y1);
                    const slopeAngleDeg = Math.atan2(dy, dx || 1e-6) * RAD_TO_DEG;
                    if (slopeAngleDeg >= SLOPE_SLIDE_ANGLE_THRESHOLD_DEG) startSlopeSlide(groundedPlatform.angle);
                    else stopSlopeSlide();
                } else {
                    stopSlopeSlide();
                }
                if (slopeSlideState.active && player.onGround && !isEmotePlaying() && !mountController?.ownsRiderAnimation?.()) {
                    setSpineAnimation(ANIM_SLIDE, true);
                }
                const tiltTarget = slopeSlideState.active ? slopeSlideState.targetTiltDeg : 0;
                const blendSpeed = slopeSlideState.active ? SLOPE_TILT_BLEND_IN_SPEED : SLOPE_TILT_BLEND_OUT_SPEED;
                if (blendSpeed > 0) {
                    const delta = tiltTarget - playerTiltAngleDeg;
                    const maxStep = blendSpeed * dt;
                    const step = Math.max(-maxStep, Math.min(maxStep, delta));
                    playerTiltAngleDeg += step;
                } else {
                    playerTiltAngleDeg = tiltTarget;
                }
                if (DEBUG_GROUND_STATE_LOGGING && wasOnGround !== player.onGround) {
                    const surface = groundedPlatform ? (groundedPlatform.debugName ?? groundedPlatform.label ?? groundedPlatform.id ?? 'platform') : (player.onGround ? 'ground' : 'none');
                    console.log(`[GroundDebug] ${wasOnGround ? 'grounded' : 'airborne'} -> ${player.onGround ? 'grounded' : 'airborne'} y=${player.y.toFixed(2)} vy=${player.vy.toFixed(2)} surface=${surface}`);
                }
                if (!player.onGround && wasOnGround) { player.isLandingAnimation = false; player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; player.groundAnimCooldown = GROUND_ANIMATION_LOCKOUT; player.landingInputLockTimer = 0; player.landingTooHard = false; player.landingHardBlendTriggered = false; player.lastLandingImpactSpeed = 0; player.landingMomentumVx = 0; clearStopOverlay(); }
                if (player.onGround && !wasOnGround && previousVy >= 0) {
                    player.lastLandingImpactSpeed = previousVy;
                    player.landingTooHard = previousVy >= LANDING_TOO_HARD_IMPACT_SPEED;
                    const cappedLandingVx = Math.max(-LANDING_MOMENTUM_MAX_SPEED, Math.min(LANDING_MOMENTUM_MAX_SPEED, player.vx));
                    player.landingMomentumVx = (player.landingTooHard && Math.abs(player.vx) >= LANDING_MOMENTUM_MIN_SPEED) ? cappedLandingVx : 0;
                    if (player.landingMomentumVx < 0) player.facingRight = true;
                    else if (player.landingMomentumVx > 0) player.facingRight = false;
                    if (previousVy >= LANDING_PUFF_MIN_IMPACT_SPEED) playLandingPuffEffect();
                    player.jumpUpIntroPlayed = false;
                    player.fallIntroPlayed = false;
                    if (!mountController?.suppressesJumpAnimations?.()) startLandingAnimation();
                }
                updateJetpackRecharge(dt);
                if (player.x < 0) player.x = 0; if (player.x + player.width > WORLD_WIDTH) player.x = WORLD_WIDTH - player.width;
                if (player.y > WORLD_HEIGHT) { player.x = WORLD_WIDTH * 0.5; player.y = 0; player.vy = 0; player.isJumping = false; player.jumpHoldTime = 0; player.lieState = 'none'; player.jumpUpIntroPlayed = false; player.fallIntroPlayed = false; player.isLandingAnimation = false; player.groundAnimCooldown = 0; player.landingInputLockTimer = 0; player.landingTooHard = false; player.landingHardBlendTriggered = false; player.lastLandingImpactSpeed = 0; player.landingMomentumVx = 0; player.airJumpAvailable = true; player.hasDoubleJumped = false; player.doubleJumpFallGrace = 0; }
                if (player.onGround) {
                    player.airJumpAvailable = true;
                    player.hasDoubleJumped = false;
                    player.doubleJumpFallGrace = 0;
                }
                syncPlayerSkeletonScale();
                updateHardLandingBlend();
                if (player.lieState === 'none' && player.fidgetState === 'none') {
                    if (player.onGround) { if (!player.isLandingAnimation && player.groundAnimCooldown <= 0) applyGroundAnimation(); }
                    else updateAirAnimation(previousVy);
                }
                updateWindOverlay();
                updateLandingOverlayWeight();
                updateStopOverlayWeight();
                logOverlayTrackStates();
                updateJetpackAnimation();
            }

            function updatePlayerContainerPosition() {
                if (!playerContainerElement) return;
                const containerWidth = PLAYER_VISUAL_WIDTH, containerHeight = PLAYER_VISUAL_HEIGHT;
                const playerBottom = player.y + player.height;
                const playerCenterX = player.x + player.width / 2;
                const containerWorldLeft = playerCenterX - (containerWidth / 2);
                const containerWorldTop = playerBottom - containerHeight - FOOT_OFFSET;
                const screenLeft = (containerWorldLeft - camera.x) * zoomLevel;
                const screenTop = (containerWorldTop - camera.y) * zoomLevel;
                const screenWidth = containerWidth * zoomLevel;
                const screenHeight = containerHeight * zoomLevel;
                playerContainerElement.style.left = `${screenLeft}px`;
                playerContainerElement.style.top = `${screenTop}px`;
                playerContainerElement.style.width = `${screenWidth}px`;
                playerContainerElement.style.height = `${screenHeight}px`;
                playerContainerElement.dataset.worldX = String(playerCenterX);
                playerContainerElement.dataset.facing = player.facingRight ? 'left' : 'right';
                updateSpineRenderSurface(
                    playerContainerElement,
                    containerWidth,
                    containerHeight,
                    playerSpineRenderZoom
                );
                if (playerTiltAngleDeg) {
                    const pivotX = (containerWidth * 0.5) * zoomLevel;
                    const pivotY = (containerHeight + FOOT_OFFSET) * zoomLevel;
                    playerContainerElement.style.transformOrigin = `${pivotX}px ${pivotY}px`;
                    playerContainerElement.style.transform = `rotate(${playerTiltAngleDeg}deg)`;
                } else {
                    playerContainerElement.style.transformOrigin = 'top left';
                    playerContainerElement.style.transform = '';
                }
                playerContainerScreen.left = screenLeft;
                playerContainerScreen.top = screenTop;
                playerContainerScreen.width = screenWidth;
                playerContainerScreen.height = screenHeight;
                playerContainerWorldBounds.left = containerWorldLeft;
                playerContainerWorldBounds.top = containerWorldTop;
                playerContainerWorldBounds.width = containerWidth;
                playerContainerWorldBounds.height = containerHeight;
                const playerRootWorldPosition = getPlayerRootWorldPosition();
                const playerGroundY = player.y + player.height;
                playerContainerElement.dataset.rootWorldY = playerRootWorldPosition
                    ? String(playerRootWorldPosition.y)
                    : '';
                playerContainerElement.dataset.rootGroundOffsetY = playerRootWorldPosition
                    ? String(playerRootWorldPosition.y - playerGroundY)
                    : '';
                if (doorRushState.active) {
                    applyDoorMaskClip(doorRushState.maskSide);
                } else {
                    clearDoorMaskClip();
                }
                updateJetpackBarVisual(screenWidth, screenHeight);

                //the speech bubble scale offsets
                const zoomScale = PLAYER_VISUAL_HEIGHT > 0 ? (screenHeight / PLAYER_VISUAL_HEIGHT) : 1;
                const speechOffsetY = -1200 * zoomScale;
                const speechTranslateY = 6 * zoomScale;
                playerContainerElement.style.setProperty('--speech-offset-y', `${speechOffsetY}px`);
                playerContainerElement.style.setProperty('--speech-translate-y', `${speechTranslateY}px`);
                const promptOffsetX = (SITTING_PROMPT_OFFSET.x || 0) * zoomScale;
                const promptOffsetY = (SITTING_PROMPT_OFFSET.y || 0) * zoomScale;
                playerContainerElement.style.setProperty('--sit-prompt-offset-x', `${promptOffsetX}px`);
                playerContainerElement.style.setProperty('--sit-prompt-offset-y', `${promptOffsetY}px`);
                const talkLabelTop = (containerHeight + FOOT_OFFSET) * zoomLevel;
                playerContainerElement.style.setProperty('--talk-label-top', `${talkLabelTop}px`);


                if (emoteMenuController) {
                    const centerX = screenLeft + (containerWidth * zoomLevel) / 2;
                    const centerY = screenTop + (containerHeight * zoomLevel) / 2;
                    emoteMenuController.setPosition(centerX, centerY);
                }

                updateDoorContainers();
                updateBalloonContainers();
                updatePlacedSpinePropContainers();
                updateTextBoxContainers();
                updateButterflySpawnContainers();
            }

            function updateCameraTrackingButton() {
                if (!cameraTrackingButton) return;
                cameraTrackingButton.textContent = `Camera Follow: ${cameraTrackingEnabled ? 'ON' : 'OFF'}`;
                cameraTrackingButton.setAttribute('aria-pressed', String(cameraTrackingEnabled));
            }

            function clampCameraPosition() {
                const visibleWidth = CANVAS_WIDTH / zoomLevel;
                const visibleHeight = CANVAS_HEIGHT / zoomLevel;
                const maxCamX = Math.max(0, WORLD_WIDTH - visibleWidth);
                const maxCamY = Math.max(0, WORLD_HEIGHT - visibleHeight);
                camera.x = Math.max(0, Math.min(camera.x, maxCamX));
                camera.y = Math.max(0, Math.min(camera.y, maxCamY));
            }

            function updateCamera(dt) {
                updateDoorRushCamera(dt);
                if (doorRushCameraState.active) return;
                if (!cameraTrackingEnabled) {
                    camera.targetX = camera.x;
                    camera.targetY = camera.y;
                    clampCameraPosition();
                    return;
                }
                const visibleWidth = CANVAS_WIDTH / zoomLevel, visibleHeight = CANVAS_HEIGHT / zoomLevel;
                const leadFactor = 0.03;
                const facingLeadX = player.facingRight ? player.width * leadFactor : -player.width * leadFactor;
                const maxVelocityLead = visibleWidth * CAMERA_MAX_LOOK_AHEAD_RATIO;
                const velocityLeadX = Math.max(-maxVelocityLead, Math.min(
                    player.vx * CAMERA_VELOCITY_LOOK_AHEAD_SECONDS,
                    maxVelocityLead
                ));
                const leadX = facingLeadX + velocityLeadX;
                camera.targetX = player.x + player.width / 2 - visibleWidth / 2 + leadX + camera.offsetX;
                camera.targetY = player.y + player.height / 2 - visibleHeight / 2 - 50 + camera.offsetY;
                if (camera.isDragging) { camera.x = camera.targetX; camera.y = camera.targetY; }
                else {
                    const playerSpeed = Math.hypot(player.vx, player.vy);
                    const fastFollowMix = Math.max(0, Math.min(1,
                        (playerSpeed - PLAYER_RUN_SPEED) / Math.max(1, CAMERA_FAST_SPEED_REFERENCE - PLAYER_RUN_SPEED)
                    ));
                    const followRate = CAMERA_FOLLOW_RATE_NORMAL
                        + (CAMERA_FOLLOW_RATE_FAST - CAMERA_FOLLOW_RATE_NORMAL) * fastFollowMix;
                    const followAlpha = 1 - Math.exp(-followRate * Math.max(0, Math.min(dt, 0.05)));
                    camera.x += (camera.targetX - camera.x) * followAlpha;
                    camera.y += (camera.targetY - camera.y) * followAlpha;
                }
                clampCameraPosition();
            }

            function gameLoop(currentTime) {
                const dt = (currentTime - lastTime) / 1000;
                lastTime = currentTime;
                mountController?.beforeInput(dt);
                handleInput(dt);
                mountController?.afterInput(dt);
                updateFidget(dt);
                updatePlayer(dt); // physics + collisions are up-to-date here
                mountController?.afterPhysics();


                if (player.sitState === 'none' && player.lieState === 'none' && player.fidgetState === 'none' && player.doorState === 'none' && !isEmotePlaying?.()) {
                    const playerHitbox = { x: player.x, y: player.y, width: player.width, height: player.height };
                    const nearbyDoor = findNearbyDoor(playerHitbox);
                    const chair = nearbyDoor ? null : findOverlappingChair(playerHitbox);
                    doorPromptDoor = nearbyDoor || null;
                    sitPromptChair = chair || null;
                    if (sitPromptElement) {
                        if (nearbyDoor) {
                            sitPromptElement.textContent = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches
                                ? 'Tap USE for door'
                                : DOOR_PROMPT_TEXT;
                            sitPromptElement.style.display = 'block';
                        } else if (chair) {
                            sitPromptElement.textContent = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches
                                ? 'Tap USE to sit'
                                : 'Press F to sit';
                            sitPromptElement.style.display = 'block';
                        } else {
                            sitPromptElement.style.display = 'none';
                        }
                    }
                } else {
                    doorPromptDoor = null;
                    sitPromptChair = null;
                    if (sitPromptElement) sitPromptElement.style.display = 'none';
                }






                updateTalkOverlay();
                updateTalkLipSyncOverlay(dt);
                updateBlink(dt);
                updateSwordMixing(dt);
                updateCamera(dt);
                updatePlayerDimensionsFromSkeleton(); //Call this
                updateBalloons(dt);
                updatePlacedSpineProps(dt);
                beaverNpcController?.update(dt);
                updateButterflySpawns(dt);
                if (mountController?.areLeavesEnabled?.() ?? true) updateAmbientLeaves(dt);
                updateCoins(dt);
                updateCoinPileCollectibles(dt);
                updatePlayerContainerPosition();
                mountController?.render(camera, zoomLevel);
                updateAllVfx(dt);
                updateSwordHitboxDebug(dt);
                if (npcEnabled && chatBotController?.updateNpc) {
                    chatBotController.updateNpc(dt, {
                        camera,
                        zoomLevel,
                        spineCanvasRenderZoom: SPINE_CANVAS_RENDER_ZOOM,
                        worldWidth: WORLD_WIDTH,
                        worldHeight: WORLD_HEIGHT,
                        floorHeight: FLOOR_HEIGHT,
                        footOffset: FOOT_OFFSET,
                        containerSize: PLAYER_CONTAINER_SIZE,
                        playerWorld: { x: player.x + player.width / 2, y: player.y + player.height }
                    });
                }
                drawGame(); updateDebug();
                logAnimationFrameSample(currentTime);
                logJumpFlagChanges();
                if (spinePlayer?.skeleton && (playerColors || !hairColoringEnabled)) applyAttachmentColors(spinePlayer.skeleton, playerColors);
                requestAnimationFrame(gameLoop);
            }

            function drawGroundGrid(context) {
                const gridSize = FLOOR_GRID_SIZE;
                const groundTop = Math.max(0, WORLD_HEIGHT - FLOOR_HEIGHT);
                const groundBottom = WORLD_HEIGHT;
                context.save();
                context.fillStyle = FLOOR_GRID_BACKGROUND;
                context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
                context.strokeStyle = FLOOR_GRID_COLOR;
                context.lineWidth = Math.max(1, 1 / zoomLevel);
                for (let x = 0; x <= WORLD_WIDTH; x += gridSize) { context.beginPath(); context.moveTo(x, groundTop); context.lineTo(x, groundBottom); context.stroke(); }
                for (let y = groundTop; y <= groundBottom; y += gridSize) { context.beginPath(); context.moveTo(0, y); context.lineTo(WORLD_WIDTH, y); context.stroke(); }
                context.restore();
            }

            function drawBackgroundScene(context) {
                context.fillStyle = '#4a525a';
                context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                clearBackgroundLayerSurfaces();
                if (!backgroundSceneLoaded || !currentBackgroundScene?.layers?.length) {
                    return;
                }
                backgroundTileRenderer.draw(
                    layer => backgroundLayerSurfaces.get(layer.id)?.context || null,
                    {
                        width: CANVAS_WIDTH,
                        height: CANVAS_HEIGHT,
                        camera,
                        zoom: zoomLevel
                    }
                );
            }

            function drawPlatformOverlay() {
                if (!platformOverlayCtx) return;
                const context = platformOverlayCtx;
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                context.save();
                context.scale(zoomLevel, zoomLevel);
                context.translate(-camera.x, -camera.y);

                const tileWidth = platformImage.width * BLOCK_SCALE;
                const tileHeight = platformImage.height * BLOCK_SCALE;
                const drawHitboxes = buildModeEnabled || DEBUG_DRAW;
                platforms.forEach(p => {
                    if (p.renderArtwork !== false && platformImageLoaded) {
                        if (p.isSlope) {
                            context.save();
                            context.translate(p.x1, p.y1);
                            context.rotate(p.angle);
                            const tiles = Math.ceil(p.length / tileWidth);
                            for (let i = 0; i < tiles; i++) {
                                context.drawImage(platformImage, i * tileWidth, 0, tileWidth, tileHeight);
                            }
                            context.restore();
                        } else {
                            const numTilesX = Math.ceil(p.width / tileWidth);
                            const numTilesY = Math.ceil(p.height / tileHeight);
                            for (let i = 0; i < numTilesX; i++) {
                                for (let j = 0; j < numTilesY; j++) {
                                    context.drawImage(platformImage, p.x + i * tileWidth, p.y + j * tileHeight, tileWidth, tileHeight);
                                }
                            }
                        }
                    } else if (p.renderArtwork !== false) {
                        context.fillStyle = p.isBuild ? '#994444' : '#333';
                        if (p.isSlope) {
                            context.save();
                            context.translate(p.x1, p.y1);
                            context.rotate(p.angle);
                            context.fillRect(0, 0, p.length, p.thickness);
                            context.restore();
                        } else {
                            context.fillRect(p.x, p.y, p.width, p.height);
                        }
                    }
                    if (drawHitboxes) {
                        context.strokeStyle = p.isBuild ? '#ffcc00' : '#66ccff';
                        context.lineWidth = Math.max(1, 2 / zoomLevel);
                        if (p.isSlope) {
                            context.save();
                            context.translate(p.x1, p.y1);
                            context.rotate(p.angle);
                            context.strokeRect(0, 0, p.length, p.thickness);
                            context.restore();
                        } else {
                            context.strokeRect(p.x, p.y, p.width, p.height);
                        }
                    }
                    if (DEBUG_DRAW) {
                        const baseAngle = Number.isFinite(p?.slopeAbsAngleDeg)
                            ? p.slopeAbsAngleDeg
                            : Math.atan2(
                                Math.abs((p.y2 ?? p.y) - (p.y1 ?? p.y)),
                                Math.abs((p.x2 ?? (p.x + p.width)) - (p.x1 ?? p.x)) || 1e-6
                            ) * RAD_TO_DEG;
                        const angleDeg = Math.round(baseAngle * 10) / 10;
                        const labelX = p.isSlope ? (p.x1 + p.x2) * 0.5 : (p.x + p.width * 0.5);
                        const labelY = p.isSlope ? (p.y1 + p.y2) * 0.5 : (p.y + p.height * 0.5);
                        context.save();
                        context.fillStyle = '#ffffff';
                        context.font = `${50 / zoomLevel}px monospace`;
                        context.textAlign = 'center';
                        context.textBaseline = 'middle';
                        context.fillText(`${angleDeg}°`, labelX, labelY);
                        context.restore();
                    }
                });

                // These were historically painted after platforms on the main canvas. Keeping them
                // in this same overlay preserves their existing order relative to platform artwork.
                drawChairs(context);
                drawCoins(context);
                drawCoinPileCollectibles(context);
                beaverNpcController?.draw(context);
                drawDoorsDebug(context);
                drawBalloonsDebug(context);
                drawPlacedSpinePropsDebug(context);
                if (DEBUG_SWORD_HITBOX) drawSwordHitboxDebug(context);
                if (DEBUG_DRAW) {
                    const pivotX = player.x + player.width / 2;
                    const pivotY = player.y + player.height;
                    context.save();
                    context.fillStyle = 'red';
                    context.beginPath();
                    context.arc(pivotX, pivotY, 8 / zoomLevel, 0, Math.PI * 2);
                    context.fill();
                    context.strokeStyle = 'lime';
                    context.lineWidth = 1 / zoomLevel;
                    context.strokeRect(player.x, player.y, player.width, player.height);
                    context.restore();
                }

                if (buildModeEnabled && pendingSegmentPreview) {
                    const previewPlatform = segmentToPlatform(pendingSegmentPreview, -1);
                    if (previewPlatform) {
                        context.save();
                        context.globalAlpha = 0.5;
                        context.fillStyle = '#66ccff';
                        if (previewPlatform.isSlope) {
                            context.translate(previewPlatform.x1, previewPlatform.y1);
                            context.rotate(previewPlatform.angle);
                            context.fillRect(0, 0, previewPlatform.length, previewPlatform.thickness);
                            if (drawHitboxes) {
                                context.strokeStyle = '#66ccff';
                                context.lineWidth = Math.max(1, 2 / zoomLevel);
                                context.strokeRect(0, 0, previewPlatform.length, previewPlatform.thickness);
                            }
                        } else {
                            context.fillRect(previewPlatform.x, previewPlatform.y, previewPlatform.width, previewPlatform.height);
                            if (drawHitboxes) {
                                context.strokeStyle = '#66ccff';
                                context.lineWidth = Math.max(1, 2 / zoomLevel);
                                context.strokeRect(previewPlatform.x, previewPlatform.y, previewPlatform.width, previewPlatform.height);
                            }
                        }
                        context.restore();
                    }
                }
                context.restore();
            }

            function drawGame() {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                if (backgroundVisible) {
                    drawBackgroundScene(ctx);
                } else {
                    clearBackgroundLayerSurfaces();
                }
                ctx.save();
                ctx.scale(zoomLevel, zoomLevel);
                ctx.translate(-camera.x, -camera.y);

                if (!backgroundVisible) {
                    drawGroundGrid(ctx);
                }

                ctx.restore();
                drawPlatformOverlay();
                if (mountController?.areLeavesEnabled?.() ?? true) drawAmbientLeafOverlay();
            }

            function updateDebug() {
                if (!debugInfoVisible || !spinePlayer?.animationState) { if (debugInfoElement && !debugInfoVisible) debugInfoElement.innerHTML = "Debug Hidden"; return; }
                let html = `Player: X:${player.x.toFixed(0)} Y:${player.y.toFixed(0)} VY:${player.vy.toFixed(0)} Ground:${player.onGround}<br>`;
                html += `Camera: X:${camera.x.toFixed(0)} Y:${camera.y.toFixed(0)} Zoom:${zoomLevel.toFixed(2)}<br>`;
                html += `Velocity X:${player.vx.toFixed(0)} Velocity Y:${player.vy.toFixed(0)}<br>`;
                const fuelPercent = JETPACK_MAX_FUEL > 0 ? Math.round((jetpackState.fuel / JETPACK_MAX_FUEL) * 100) : 0;
                html += `Jetpack: ${jetpackState.enabled ? 'ON' : 'OFF'} Fuel:${fuelPercent}% Thrust:${jetpackState.thrusting}<br>`;
                html += `Mount: ${mountController?.getDebugText?.() || 'Unavailable'}<br>`;
                const beaverDebug = beaverNpcController?.getSnapshot?.();
                html += `Beaver: ${beaverDebug?.phase || 'loading'} Logs:${beaverDebug?.deliveredCount || 0}<br>`;
                balloons.forEach((targetBalloon) => {
                    if (!targetBalloon.ready) return;
                    const hitPoint = getBalloonHitBoneWorldPosition(targetBalloon);
                    const rootPoint = getBalloonBoneWorldPosition(targetBalloon, targetBalloon.rootBone);
                    if (hitPoint && rootPoint) {
                        html += `Balloon ${targetBalloon.id}: Root Y:${rootPoint.y.toFixed(0)} HIT X:${hitPoint.x.toFixed(0)} Y:${hitPoint.y.toFixed(0)} Wind:${targetBalloon.currentWind || 'none'}<br>`;
                    }
                });
                html += `Current Anim: ${player.currentAnimation}<br>`;
                if (spinePlayer.chosenSkinsForDebug) html += `Skins: ${spinePlayer.chosenSkinsForDebug.join(', ').substring(0, 30)}...`;
                debugInfoElement.innerHTML = html;
            }

            function clampZoom(value) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)); }

            function updateSpineRenderSurface(
                container,
                worldWidth,
                worldHeight,
                renderZoom = SPINE_CANVAS_RENDER_ZOOM
            ) {
                if (!container || !Number.isFinite(worldWidth) || !Number.isFinite(worldHeight)) return;
                const surface = container.querySelector(':scope > .spine-player');
                if (!surface) return;
                const safeRenderZoom = Math.max(0.01, Number(renderZoom) || SPINE_CANVAS_RENDER_ZOOM);
                const renderWidth = Math.max(1, worldWidth * safeRenderZoom);
                const renderHeight = Math.max(1, worldHeight * safeRenderZoom);
                const displayScale = zoomLevel / safeRenderZoom;
                const layoutKey = `${renderWidth}|${renderHeight}|${displayScale}`;
                if (surface.dataset.gameZoomLayout === layoutKey) return;
                surface.dataset.gameZoomLayout = layoutKey;
                surface.dataset.gameRenderZoom = String(safeRenderZoom);
                surface.style.position = 'absolute';
                surface.style.left = '0';
                surface.style.top = '0';
                surface.style.width = `${renderWidth}px`;
                surface.style.height = `${renderHeight}px`;
                surface.style.transformOrigin = 'top left';
                surface.style.transform = `scale(${displayScale})`;
                surface.style.willChange = 'transform';
            }

            function getTargetPlayerSpineRenderZoom() {
                const deviceScale = Math.max(1, Number(window.devicePixelRatio) || 1);
                const largestWorldDimension = Math.max(
                    1,
                    PLAYER_CONTAINER_SIZE.width,
                    PLAYER_CONTAINER_SIZE.height
                );
                const maximumRenderZoom = Math.max(
                    SPINE_CANVAS_RENDER_ZOOM,
                    PLAYER_SPINE_MAX_BACKING_SIZE / (largestWorldDimension * deviceScale)
                );
                const desiredRenderZoom = Math.max(
                    SPINE_CANVAS_RENDER_ZOOM,
                    Math.min(zoomLevel, maximumRenderZoom)
                );
                const qualityStep = PLAYER_SPINE_RENDER_ZOOM_STEPS.find(
                    step => step >= desiredRenderZoom - 0.001
                ) || PLAYER_SPINE_RENDER_ZOOM_STEPS[PLAYER_SPINE_RENDER_ZOOM_STEPS.length - 1];
                return Math.max(
                    SPINE_CANVAS_RENDER_ZOOM,
                    Math.min(qualityStep, maximumRenderZoom)
                );
            }

            function schedulePlayerSpineQualityRefresh() {
                if (playerSpineQualityTimer) clearTimeout(playerSpineQualityTimer);
                playerSpineQualityTimer = setTimeout(() => {
                    playerSpineQualityTimer = 0;
                    const targetRenderZoom = getTargetPlayerSpineRenderZoom();
                    if (Math.abs(targetRenderZoom - playerSpineRenderZoom) < 0.001) return;
                    playerSpineRenderZoom = targetRenderZoom;
                    updatePlayerContainerPosition();
                    requestAnimationFrame(() => spinePlayer?.resize?.());
                }, PLAYER_SPINE_QUALITY_SETTLE_MS);
            }

            function setZoom(newZoom) {
                const clamped = clampZoom(newZoom);
                if (clamped !== zoomLevel) {
                    zoomLevel = clamped;
                    updateTextBoxContainers();
                    updateMouseTrackerDisplay(); updatePlayerContainerPosition();
                    schedulePlayerSpineQualityRefresh();
                }
            }

            function handleZoomWheel(event) {
                event.preventDefault();
                const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                    ? 16
                    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                        ? CANVAS_HEIGHT
                        : 1;
                pendingZoomWheelDelta += event.deltaY * deltaScale;
                if (zoomWheelFrame) return;
                zoomWheelFrame = requestAnimationFrame(() => {
                    zoomWheelFrame = 0;
                    const delta = pendingZoomWheelDelta;
                    pendingZoomWheelDelta = 0;
                    setZoom(zoomLevel * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY));
                });
            }
            function startCameraPan(event) { if (!buildModeEnabled && event.button === 1) { recordUserActivity(); event.preventDefault(); camera.isDragging = true; camera.lastPointerX = event.clientX; camera.lastPointerY = event.clientY; } }
            function updateCameraPan(event) {
                if (!camera.isDragging) return;
                const deltaX = (event.clientX - camera.lastPointerX) / zoomLevel;
                const deltaY = (event.clientY - camera.lastPointerY) / zoomLevel;
                if (cameraTrackingEnabled) {
                    camera.offsetX -= deltaX;
                    camera.offsetY -= deltaY;
                } else {
                    camera.x -= deltaX;
                    camera.y -= deltaY;
                    clampCameraPosition();
                    camera.targetX = camera.x;
                    camera.targetY = camera.y;
                }
                camera.lastPointerX = event.clientX;
                camera.lastPointerY = event.clientY;
                updatePlayerContainerPosition();
            }
            function stopCameraPan(event) { if (!event || event.type !== 'mouseup' || event.button === 1) camera.isDragging = false; }

            function resetJoystick() {
                Object.assign(joystickState, { active: false, identifier: null, centerX: 0, centerY: 0, x: 0, y: 0, strength: 0 });
                if (joystickContainer) joystickContainer.style.display = 'none';
                if (joystickThumb) joystickThumb.style.transform = 'translate(-50%, -50%)';
            }

            function updateJoystickFromPoint(x, y) {
                recordUserActivity();
                const dx = x - joystickState.centerX, dy = y - joystickState.centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const clampedDistance = Math.min(distance, JOYSTICK_RADIUS);
                const ratio = distance > 0 ? clampedDistance / distance : 0;
                const offsetX = dx * ratio, offsetY = dy * ratio;
                joystickState.x = Math.max(-1, Math.min(1, offsetX / JOYSTICK_RADIUS));
                joystickState.y = Math.max(-1, Math.min(1, (-offsetY) / JOYSTICK_RADIUS));
                joystickState.strength = Math.min(1, distance / JOYSTICK_RADIUS);
                if (joystickThumb) joystickThumb.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`;
            }

            function startJoystick(x, y, identifier) {
                if (!joystickContainer || !joystickThumb) return;
                recordUserActivity();
                Object.assign(joystickState, { active: true, identifier, centerX: x, centerY: y, x: 0, y: 0, strength: 0 });
                joystickContainer.style.display = 'block';
                joystickContainer.style.left = `${x}px`; joystickContainer.style.top = `${y}px`;
                joystickThumb.style.transform = 'translate(-50%, -50%)';
            }

            function pointEligibleForJoystick(x, y) {
                if (!gameWrapper) return false;
                const wrapperRect = gameWrapper.getBoundingClientRect();
                if (y < window.innerHeight * JOYSTICK_ACTIVATION_MIN_Y) return false;
                if (x < wrapperRect.left || x > wrapperRect.right || y < wrapperRect.top || y > wrapperRect.bottom) return false;
                const element = document.elementFromPoint(x, y);
                return !(element && element.closest('#ui-controls, .beaver-npc-container'));
            }

            function handleJoystickTouchStart(event) { if (touchCameraGestureActive || joystickState.active || buildModeEnabled) return; for (let touch of event.changedTouches) if (pointEligibleForJoystick(touch.clientX, touch.clientY)) { startJoystick(touch.clientX, touch.clientY, touch.identifier); event.preventDefault(); return; } }
            function handleJoystickTouchMove(event) { if (!joystickState.active) return; for (let touch of event.changedTouches) if (touch.identifier === joystickState.identifier) { updateJoystickFromPoint(touch.clientX, touch.clientY); event.preventDefault(); return; } }
            function handleJoystickTouchEnd(event) { if (!joystickState.active) return; for (let touch of event.changedTouches) if (touch.identifier === joystickState.identifier) { resetJoystick(); event.preventDefault(); return; } }
            function handleJoystickMouseDown(event) { if (event.button === 0 && !joystickState.active && !buildModeEnabled && pointEligibleForJoystick(event.clientX, event.clientY)) { startJoystick(event.clientX, event.clientY, 'mouse'); event.preventDefault(); } }
            function handleJoystickMouseMove(event) { if (joystickState.active && joystickState.identifier === 'mouse') { updateJoystickFromPoint(event.clientX, event.clientY); event.preventDefault(); } }
            function handleJoystickMouseUp(event) { if (joystickState.active && joystickState.identifier === 'mouse') { resetJoystick(); event.preventDefault(); } }

            function setupJoystickControls() {
                if (!gameWrapper || !joystickContainer || !joystickThumb) return;
                if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
                    gameWrapper.addEventListener('touchstart', handleJoystickTouchStart, { passive: false });
                    gameWrapper.addEventListener('touchmove', handleJoystickTouchMove, { passive: false });
                    gameWrapper.addEventListener('touchend', handleJoystickTouchEnd);
                    gameWrapper.addEventListener('touchcancel', handleJoystickTouchEnd);
                }
                gameWrapper.addEventListener('mousedown', handleJoystickMouseDown);
                window.addEventListener('mousemove', handleJoystickMouseMove);
                window.addEventListener('mouseup', handleJoystickMouseUp);
                window.addEventListener('blur', resetJoystick);
            }

            function updateTouchStatus(message = '') {
                const status = document.getElementById('touch-status');
                if (!status) return;
                status.textContent = message;
                if (message) {
                    clearTimeout(updateTouchStatus.timer);
                    updateTouchStatus.timer = setTimeout(() => {
                        if (status.textContent === message) status.textContent = '';
                    }, 2400);
                }
            }

            function performPrimaryInteraction() {
                recordUserActivity();
                if (player.sitState === 'seated') {
                    stopSitting();
                    return;
                }
                if (player.doorState === 'none' && doorPromptDoor) {
                    startDoorInteraction(doorPromptDoor);
                    return;
                }
                if (player.sitState === 'none' && sitPromptChair) {
                    beginSittingOnChair(sitPromptChair);
                    return;
                }
                updateTouchStatus('Move closer to something you can use.');
            }

            function triggerTouchAction(action) {
                recordUserActivity();
                if (action === 'interact') {
                    performPrimaryInteraction();
                } else if (action === 'sword') {
                    toggleSwordMode();
                } else if (action === 'attack') {
                    if (!swordModeState.active) updateTouchStatus('Draw your sword first.');
                    else playSwordAttack();
                } else if (action === 'emotes') {
                    if (!emoteMenuController) return;
                    if (emoteMenuController.isVisible?.()) emoteMenuController.hide();
                    else emoteMenuController.show();
                } else if (action === 'chat') {
                    const proxyUrl = typeof window.ANIMEE_CHAT_PROXY_URL === 'string'
                        ? window.ANIMEE_CHAT_PROXY_URL.trim()
                        : '';
                    if (!proxyUrl) {
                        updateTouchStatus('Chat is off until a secure proxy is configured.');
                        return;
                    }
                    if (!npcEnabled) enableNpc();
                    chatBotController?.toggleChat?.();
                }
                focusGameCanvas();
            }

            function setupMobileControls() {
                const root = document.getElementById('mobile-controls');
                if (!root || root.dataset.bound === 'true') return;
                root.dataset.bound = 'true';
                const chatButton = root.querySelector('[data-touch-trigger="chat"]');
                const chatAvailable = typeof window.ANIMEE_CHAT_PROXY_URL === 'string'
                    && window.ANIMEE_CHAT_PROXY_URL.trim().length > 0;
                if (chatButton) {
                    chatButton.setAttribute('aria-disabled', String(!chatAvailable));
                    chatButton.title = chatAvailable ? 'Open chat' : 'Chat requires a secure backend proxy';
                }

                root.querySelectorAll('[data-touch-action]').forEach((button) => {
                    const action = button.dataset.touchAction;
                    const release = (event) => {
                        setTouchAction(action, event.pointerId, false);
                        button.classList.toggle('is-active', isActionActive(action));
                        try { button.releasePointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
                    };
                    button.addEventListener('pointerdown', (event) => {
                        if (event.button !== 0 && event.pointerType !== 'touch') return;
                        event.preventDefault();
                        event.stopPropagation();
                        setTouchAction(action, event.pointerId, true);
                        button.classList.add('is-active');
                        try { button.setPointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
                    });
                    button.addEventListener('pointerup', release);
                    button.addEventListener('pointercancel', release);
                    button.addEventListener('lostpointercapture', release);
                });

                root.querySelectorAll('[data-touch-trigger]').forEach((button) => {
                    const action = button.dataset.touchTrigger;
                    let cannonPointerId = null;
                    const release = (event) => {
                        if (cannonPointerId === event.pointerId) {
                            mountController?.primaryAction?.(false);
                            cannonPointerId = null;
                        }
                        button.classList.remove('is-active');
                        try { button.releasePointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
                    };
                    button.addEventListener('pointerdown', (event) => {
                        if (event.button !== 0 && event.pointerType !== 'touch') return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (action === 'attack' && mountController?.primaryAction?.(true)) {
                            cannonPointerId = event.pointerId;
                        } else {
                            triggerTouchAction(action);
                        }
                        button.classList.add('is-active');
                        try { button.setPointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
                    });
                    button.addEventListener('pointerup', release);
                    button.addEventListener('pointercancel', release);
                    button.addEventListener('lostpointercapture', release);
                });

                window.addEventListener('blur', clearTouchActions);
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        clearTouchActions();
                        resetJoystick();
                    }
                });
            }

            function setupTouchCameraGestures() {
                if (!gameWrapper || gameWrapper.dataset.touchCameraBound === 'true') return;
                gameWrapper.dataset.touchCameraBound = 'true';
                const gesture = {
                    active: false,
                    startDistance: 0,
                    startZoom: 1,
                    startMidX: 0,
                    startMidY: 0,
                    startCameraX: 0,
                    startCameraY: 0,
                    startOffsetX: 0,
                    startOffsetY: 0,
                    anchorWorldX: 0,
                    anchorWorldY: 0
                };
                const measure = (touches) => {
                    const first = touches[0];
                    const second = touches[1];
                    const dx = second.clientX - first.clientX;
                    const dy = second.clientY - first.clientY;
                    return {
                        distance: Math.max(1, Math.hypot(dx, dy)),
                        midX: (first.clientX + second.clientX) * 0.5,
                        midY: (first.clientY + second.clientY) * 0.5
                    };
                };
                gameWrapper.addEventListener('touchstart', (event) => {
                    if (gesture.active) {
                        event.preventDefault();
                        return;
                    }
                    if (event.touches.length < 2 || pendingBuildPlacementType || isDrawingSegment
                        || placedSpinePropDragState.active || butterflySpawnDragState.active
                        || balloonDragState.active || textBoxDragState.active) return;
                    const touches = Array.from(event.touches).slice(0, 2);
                    const touchesUi = touches.some((touch) => touch.target?.closest?.(
                        '#ui-controls, #build-add-tools, #camera-recenter-btn, #mobile-controls'
                    ));
                    if (touchesUi) return;
                    // The first finger may have begun a joystick gesture. Two fingers
                    // always promote that interaction to camera zoom instead.
                    resetJoystick();
                    touchCameraGestureActive = true;
                    const boardRect = gameBoardElement.getBoundingClientRect();
                    const measured = measure(touches);
                    Object.assign(gesture, {
                        active: true,
                        startDistance: measured.distance,
                        startZoom: zoomLevel,
                        startMidX: measured.midX,
                        startMidY: measured.midY,
                        startCameraX: camera.x,
                        startCameraY: camera.y,
                        startOffsetX: camera.offsetX,
                        startOffsetY: camera.offsetY,
                        anchorWorldX: (measured.midX - boardRect.left) / zoomLevel + camera.x,
                        anchorWorldY: (measured.midY - boardRect.top) / zoomLevel + camera.y
                    });
                    recordUserActivity();
                    event.preventDefault();
                }, { passive: false });
                gameWrapper.addEventListener('touchmove', (event) => {
                    if (!gesture.active || event.touches.length < 2) return;
                    const measured = measure(event.touches);
                    const nextZoom = clampZoom(gesture.startZoom * (measured.distance / gesture.startDistance));
                    setZoom(nextZoom);
                    const boardRect = gameBoardElement.getBoundingClientRect();
                    const desiredCameraX = gesture.anchorWorldX - (measured.midX - boardRect.left) / nextZoom;
                    const desiredCameraY = gesture.anchorWorldY - (measured.midY - boardRect.top) / nextZoom;
                    if (cameraTrackingEnabled) {
                        camera.offsetX = gesture.startOffsetX + desiredCameraX - gesture.startCameraX;
                        camera.offsetY = gesture.startOffsetY + desiredCameraY - gesture.startCameraY;
                    } else {
                        camera.x = desiredCameraX;
                        camera.y = desiredCameraY;
                        camera.targetX = camera.x;
                        camera.targetY = camera.y;
                        clampCameraPosition();
                    }
                    updatePlayerContainerPosition();
                    event.preventDefault();
                }, { passive: false });
                const endGesture = (event) => {
                    if (!gesture.active || event.touches.length >= 2) return;
                    gesture.active = false;
                    touchCameraGestureActive = false;
                };
                gameWrapper.addEventListener('touchend', endGesture, { passive: true });
                gameWrapper.addEventListener('touchcancel', endGesture, { passive: true });
            }

            document.addEventListener('mousemove', updateCameraPan);
            document.addEventListener('mousemove', (event) => {
                lastMouseX = event.clientX; lastMouseY = event.clientY; updateMouseTrackerDisplay();
            });
            document.addEventListener('pointerdown', (event) => {
                recordUserActivity(event);
                if (manualTalkingActive) setManualTalkingActive(false);
            }, { passive: true });
            document.addEventListener('mouseup', stopCameraPan);
            window.addEventListener('blur', stopCameraPan);
            document.addEventListener('keydown', (e) => {
                if (isEditingWorldText(e.target)) return;
                const rawKey = e.key;
                const key = rawKey.toLowerCase();
                if (buildModeEnabled && selectedTextBox && (key === 'delete' || key === 'backspace')) {
                    e.preventDefault();
                    removeTextBox(selectedTextBox);
                    return;
                }
                if (buildModeEnabled && selectedPlacedSpineProp && (key === 'delete' || key === 'backspace')) {
                    e.preventDefault();
                    removePlacedSpineProp(selectedPlacedSpineProp);
                    return;
                }
                if (buildModeEnabled
                    && selectedBuildLayerItem?.kind === 'butterfly-spawn'
                    && (key === 'delete' || key === 'backspace')) {
                    e.preventDefault();
                    removeButterflySpawn(selectedBuildLayerItem.target);
                    return;
                }
                if (key === 'escape' && buildAddMenu && !buildAddMenu.hidden) {
                    e.preventDefault();
                    setBuildAddMenuOpen(false, { returnFocus: true });
                    return;
                }
                recordUserActivity();
                if (npcEnabled && chatBotController?.handleKeyDown?.(e)) return;
                if (npcEnabled && chatBotController?.shouldBlockGameInput?.()) { e.preventDefault(); return; }
                logInputEvent('keydown', { key: rawKey });
                keys[key] = true;
                if (key === 't') {
                    if (!e.repeat) {
                        e.preventDefault();
                        setManualTalkingActive(!manualTalkingActive);
                    }
                } else if (manualTalkingActive) {
                    setManualTalkingActive(false);
                }
                if (isEmotePlaying()) {
                    const cancelKeys = ['a', 'd', 'arrowleft', 'arrowright', ' ', 'space', 'w', 'arrowup', 'shift', 'shiftleft', 'shiftright'];
                    if (cancelKeys.includes(key)) {
                        cancelActiveEmote('movement key', { key: rawKey });
                    }
                }
                if (key === 'l') {
                    if (player.lieState === 'none') startLieSequence(); else if (player.lieState === 'loop') stopLieSequence();
                } else if (player.lieState === 'loop') stopLieSequence();
                if (key === EMOTE_ACTIVATION_KEY) {
                    if (emoteMenuController) {
                        e.preventDefault();
                        emoteMenuController.show();
                    }
                } else if (key === 'escape') {
                    emoteMenuController?.hide();
                } else if (key === 'p') {
                    if (!e.repeat) {
                        e.preventDefault();
                        toggleSwordMode();
                    }
                } else if (key === 'r') {
                    if (!e.repeat && swordModeState.active) {
                        e.preventDefault();
                        playSwordAttack();
                    }
                } else if (key === 'h') {
                    if (!e.repeat) {
                        e.preventDefault();
                        playHarvestAnimation();
                    }
                }
            });
            document.addEventListener('keyup', (e) => {
                if (isEditingWorldText(e.target)) return;
                recordUserActivity();
                if (npcEnabled && chatBotController?.handleKeyUp?.(e)) return;
                if (npcEnabled && chatBotController?.shouldBlockGameInput?.()) { e.preventDefault(); return; }
                const rawKey = e.key;
                const key = rawKey.toLowerCase();
                logInputEvent('keyup', { key: rawKey });
                keys[key] = false;
                if (key === EMOTE_ACTIVATION_KEY) {
                    emoteMenuController?.hide();
                }
            });
            document.addEventListener('keydown', (e) => {
                if (isEditingWorldText(e.target)) return;
                const key = e.key?.toLowerCase?.();
                if (key === 'g' && player.doorState === 'none' && !doorRushState.active && doorPromptDoor) {
                    e.preventDefault();
                    startDoorRushInteraction(doorPromptDoor);
                    return;
                }
                if (key === 'f' && ((player.doorState === 'none' && doorPromptDoor)
                    || (player.sitState === 'none' && sitPromptChair)
                    || player.sitState === 'seated')) {
                    e.preventDefault();
                    performPrimaryInteraction();
                    return;
                }
                if (player.sitState === 'seated') {
                    const movementKey = ['a', 'd', 'arrowleft', 'arrowright', 'w', 'arrowup', ' '].includes(key);
                    if (movementKey) {
                        stopSitting();
                    }
                }
            }, true);

            function rebindDoorRushDoor() {
                if (!doorRushState?.active) return;
                const currentDoor = doorRushState.door;
                const doorIsCurrent = currentDoor ? doors.includes(currentDoor) : false;
                const doorReady = currentDoor?.ready;
                if (currentDoor && doorReady && doorIsCurrent) return;
                const targetId = doorRushState.doorId || doorRushState.entryDoorId;
                if (!targetId) return;
                const replacement = doors.find(d => d.id === targetId);
                if (replacement) {
                    doorRushState.door = replacement;
                    doorRushState.targetX = computeDoorRushTargetX(replacement, doorRushState.direction);
                }
            }

            initGameElements(); setupJoystickControls(); centerCameraOnPlayer();
            if (!IS_NATIVE_IOS) discoverBackgrounds();
            console.log(`Zoom level: ${zoomLevel.toFixed(2)}`);
            if (platformImageLoaded) { setupSpine(); }
            else {
                platformImage.onload = () => { platformImageLoaded = true; setupSpine(); };
                platformImage.onerror = () => { console.error("Platform image failed to load."); setupSpine(); };
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', __animeeStartGame, { once: true });
        } else {
            __animeeStartGame();
        }
