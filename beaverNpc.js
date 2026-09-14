const ANIMATIONS = Object.freeze({
    carryOverlay: 'carryingLogOverlay',
    drop: 'dropLog',
    idle: 'idle',
    look: 'idle_lookAbout',
    talk: 'talk_loop',
    walk: 'walkLoop',
    walkCarry: 'walkLoop_carryLog',
    run: 'runLoop',
    stop: 'walkLoop_stop',
    stopCarry: 'walkLoop_stopLog'
});

const GAMEPLAY_ANIMATIONS = Object.freeze(Object.values(ANIMATIONS).filter(
    animationName => animationName !== ANIMATIONS.carryOverlay
));
// runLoop has no baked "carrying a log" variant, so the log visual is layered
// on via the carryingLogOverlay track instead (same technique idle/look/talk use).
// walkLoop already has its own dedicated walkLoop_carryLog clip, so it doesn't need the overlay.
const CARRY_OVERLAY_BASE_ANIMATIONS = new Set([
    ANIMATIONS.idle,
    ANIMATIONS.look,
    ANIMATIONS.talk,
    ANIMATIONS.run
]);
const MOVEMENT_MODES = Object.freeze({ WALK: 'walk', RUN: 'run' });
const WORLD_SIZE = Object.freeze({ width: 495, height: 515 });
const VISUAL_GROUND_OFFSET = WORLD_SIZE.height * 0.32;
const FALLBACK_BEAVER_VERTICAL_OFFSET_Y = 27;
const ENCOUNTER_OFFSET_X = -4000;
const SOURCE_OFFSET_X = -1500;
const PILE_OFFSET_X = 1550;
const WALK_SPEED = 130.5 * 0.85; // 15% slower than the previous beaver pace.
const RUN_SPEED = WALK_SPEED * 1.3;
const DEFAULT_ANIMATION_MIX = 0.14;
const WALK_CARRY_MIX_IN = DEFAULT_ANIMATION_MIX * 0.5;
const RUN_MIX_IN = DEFAULT_ANIMATION_MIX * 0.5;
const ARRIVAL_DISTANCE = 8;
const MAX_DROPPED_LOGS = 12;
const PILE_SIZE = Object.freeze({ width: 300, height: 150 });
const HARVEST_SIZE = Object.freeze({ width: 320, height: 680 });
const HARVEST_VISUAL_OFFSET_X = -125;
const WORLD_GRID_SIZE = 120;
const HARVEST_GRID_SHIFT_X = 7 * WORLD_GRID_SIZE;
const HARVEST_STOP_APPROACH_OFFSET_X = 120;
const PILE_STOP_APPROACH_OFFSET_X = 370;
const LOOK_STOP_DISTANCE = Object.freeze({ min: 560, max: 940 });
const SHOP_SIZE = Object.freeze({ width: 1500, height: 1013 });
const DROPPED_LOG_SIZE = Object.freeze({ width: 126, height: 126 * 86 / 167 });
const DROP_EVENT_NAME = 'logVanish';
const LOG_BONE_NAME = 'LOG';
const SPINE_RENDER_BLEED_RIGHT = 180;
const SPINE_RENDER_SIZE = Object.freeze({
    width: WORLD_SIZE.width + SPINE_RENDER_BLEED_RIGHT,
    height: WORLD_SIZE.height
});
// Preserve the approved visual scale and root framing across Spine re-exports.
const STABLE_VIEWPORT = Object.freeze({
    x: -801.5191069528605,
    y: -50.16853299976377,
    width: 1090.0997998404039 * (SPINE_RENDER_SIZE.width / WORLD_SIZE.width),
    height: 508.2846205947767
});

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function roundedRectPath(context, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, Math.abs(width) * 0.5, Math.abs(height) * 0.5));
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
}

export function createBeaverNpcController({
    spine,
    gameBoardElement,
    getSceneState,
    getPlayerState,
    hasActivePlayerInput,
    onConversationChange,
    hasSpineCapacity,
    assetPaths = {
        skel: 'spine stuff/beaver/npc-beaverlumberjack.skel',
        atlas: 'spine stuff/beaver/npc-beaverlumberjack.atlas',
        log: 'img_assets/npc/beaver/log.png',
        shop: 'img_assets/props/store-sushi-wip.png'
    },
    drawOrder = 45,
    spawnProgress = 0,
    initialPhase = 'harvest-hidden',
    ownsScenery = true,
    logSlotOffset = 0,
    debugName = 'beaver',
    movementMode = MOVEMENT_MODES.RUN
}) {
    const isRunning = movementMode === MOVEMENT_MODES.RUN;
    const moveSpeed = isRunning ? RUN_SPEED : WALK_SPEED;
    let beaver = null;
    let harvestArea = null;
    const droppedLogs = [];
    let nextLogId = 0;
    const logImage = new Image();
    const shopImage = new Image();
    logImage.src = assetPaths.log;
    shopImage.src = assetPaths.shop;

    function scene() {
        const value = getSceneState?.() || {};
        return {
            worldWidth: Math.max(1, Number(value.worldWidth) || 12000),
            worldHeight: Math.max(1, Number(value.worldHeight) || 13971),
            floorHeight: Math.max(0, Number(value.floorHeight) || 820),
            camera: value.camera || { x: 0, y: 0 },
            zoomLevel: Math.max(0.01, Number(value.zoomLevel) || 1),
            spineCanvasRenderZoom: Math.max(0.01, Number(value.spineCanvasRenderZoom) || 1)
        };
    }

    function groundY() {
        const current = scene();
        return Math.max(0, current.worldHeight - current.floorHeight);
    }

    function route() {
        const current = scene();
        const centerX = current.worldWidth * 0.5;
        const minX = WORLD_SIZE.width * 0.5;
        const maxX = current.worldWidth - minX;
        const encounterCenterX = centerX + ENCOUNTER_OFFSET_X;
        const originalHarvestCenterX = encounterCenterX + SOURCE_OFFSET_X + HARVEST_VISUAL_OFFSET_X;
        const harvestCenterX = Math.max(
            minX,
            Math.min(maxX, originalHarvestCenterX + HARVEST_GRID_SHIFT_X)
        );
        const pileCenterX = Math.max(
            PILE_SIZE.width * 0.5,
            Math.min(current.worldWidth - PILE_SIZE.width * 0.5, encounterCenterX + PILE_OFFSET_X)
        );
        return {
            // Keep the scenery fixed while placing both movement anchors a little
            // farther left, giving the Beaver room to stop beside each prop.
            sourceX: harvestCenterX - HARVEST_STOP_APPROACH_OFFSET_X,
            harvestCenterX,
            pileX: pileCenterX - PILE_SIZE.width * 0.5 - PILE_STOP_APPROACH_OFFSET_X,
            pileCenterX,
            shopX: (originalHarvestCenterX + pileCenterX) * 0.5
        };
    }

    function getDuration(animationName, fallback) {
        return beaver?.spinePlayer?.skeleton?.data?.findAnimation?.(animationName)?.duration || fallback;
    }

    function syncCarryingOverlay(baseAnimationName) {
        if (!beaver?.spinePlayer) return;
        const animationState = beaver.spinePlayer.animationState;
        const shouldShow = beaver.hasLog && CARRY_OVERLAY_BASE_ANIMATIONS.has(baseAnimationName);
        const currentOverlay = animationState?.getCurrent?.(1);
        if (shouldShow && beaver.overlayAvailable) {
            let overlayEntry = currentOverlay;
            if (currentOverlay?.animation?.name !== ANIMATIONS.carryOverlay) {
                overlayEntry = animationState.setAnimation(1, ANIMATIONS.carryOverlay, true);
            }
            if (overlayEntry) {
                overlayEntry.alpha = 1;
                overlayEntry.additive = false;
                overlayEntry.mixDuration = 0;
                overlayEntry.mixTime = 0;
                overlayEntry.timeScale = 1;
            }
            beaver.overlayActive = true;
            beaver.animationHistory.add(ANIMATIONS.carryOverlay);
        } else {
            if (currentOverlay) animationState.clearTrack?.(1);
            beaver.overlayActive = false;
        }
        if (beaver.carriedLogFallback) {
            beaver.carriedLogFallback.style.display = shouldShow && !beaver.overlayAvailable ? 'block' : 'none';
        }
    }

    function setAnimation(animationName, loop = false) {
        const animationState = beaver?.spinePlayer?.animationState;
        const skeletonData = beaver?.spinePlayer?.skeleton?.data;
        if (!animationState || !skeletonData?.findAnimation?.(animationName)) return null;
        const current = animationState.getCurrent?.(0);
        beaver.animation = animationName;
        beaver.animationHistory.add(animationName);
        let entry = current;
        if (current?.animation?.name !== animationName || Boolean(current.loop) !== Boolean(loop)) {
            entry = animationState.setAnimation(0, animationName, loop);
        }
        syncCarryingOverlay(animationName);
        return entry;
    }

    function syncFacing() {
        if (!beaver?.container) return;
        beaver.container.style.transform = 'none';
        const skeleton = beaver.spinePlayer?.skeleton;
        if (skeleton) skeleton.scaleX = beaver.facingRight ? -1 : 1;
        if (beaver.carriedLogFallback) {
            beaver.carriedLogFallback.style.left = beaver.facingRight ? '41%' : '25%';
            beaver.carriedLogFallback.style.transform = `${beaver.facingRight ? 'scaleX(-1) ' : ''}rotate(-8deg)`;
        }
    }

    function stabilizeSkeletonWorldTransform(instance) {
        const skeleton = instance?.skeleton;
        const root = skeleton?.getRootBone?.();
        if (root?.pose && root?.data?.setupPose) {
            root.pose.x = root.data.setupPose.x;
            root.pose.y = root.data.setupPose.y;
        }
        skeleton?.updateWorldTransform?.(2);
    }

    function getSpineBoneRenderPosition(bone) {
        const instance = beaver?.spinePlayer;
        const camera = instance?.sceneRenderer?.camera;
        if (!instance || !bone || !camera) return null;

        stabilizeSkeletonWorldTransform(instance);
        const boneX = Number(bone.worldX ?? bone.appliedPose?.worldX);
        const boneY = Number(bone.worldY ?? bone.appliedPose?.worldY);
        const visibleWidth = Number(camera.viewportWidth) * Number(camera.zoom);
        const visibleHeight = Number(camera.viewportHeight) * Number(camera.zoom);
        const cameraX = Number(camera.position?.x);
        const cameraY = Number(camera.position?.y);
        if (![boneX, boneY, visibleWidth, visibleHeight, cameraX, cameraY].every(Number.isFinite)
            || visibleWidth <= 0 || visibleHeight <= 0) return null;

        const normalizedX = (boneX - (cameraX - visibleWidth * 0.5)) / visibleWidth;
        const normalizedY = 1 - ((boneY - (cameraY - visibleHeight * 0.5)) / visibleHeight);
        return {
            x: normalizedX * beaver.renderWidth,
            y: normalizedY * beaver.renderHeight
        };
    }

    function beaverRootTargetWorldY() {
        return beaver.groundY;
    }

    function beaverRenderWorldTop() {
        if (!beaver) return 0;
        const rootCanvasPosition = getSpineBoneRenderPosition(beaver.spinePlayer?.skeleton?.getRootBone?.());
        if (rootCanvasPosition && Number.isFinite(rootCanvasPosition.y)) {
            return beaverRootTargetWorldY() - rootCanvasPosition.y;
        }
        return beaver.groundY - beaver.height + VISUAL_GROUND_OFFSET + FALLBACK_BEAVER_VERTICAL_OFFSET_Y;
    }

    function getLogBoneGameWorldPosition() {
        const boneCanvasPosition = getSpineBoneRenderPosition(beaver?.logBone);
        if (!boneCanvasPosition) return null;
        return {
            x: beaver.x - beaver.width * 0.5 + boneCanvasPosition.x,
            y: beaverRenderWorldTop() + boneCanvasPosition.y
        };
    }

    function handleSpineAnimationEvent(entry, event) {
        const eventName = event?.data?.name || event?.name || '';
        if (!beaver || beaver.phase !== 'drop' || beaver.dropSpawned
            || entry?.animation?.name !== ANIMATIONS.drop || eventName !== DROP_EVENT_NAME) return;
        beaver.dropEventCount += 1;
        beaver.lastDropEventName = eventName;
        spawnDroppedLog(getLogBoneGameWorldPosition());
    }

    function enterPhase(phase, options = {}) {
        if (!beaver) return;
        beaver.phase = phase;
        beaver.phaseTime = 0;
        beaver.phaseDuration = Math.max(0, Number(options.duration) || 0);
        beaver.resumePhase = options.resumePhase || '';
        beaver.dropSpawned = false;

        switch (phase) {
            case 'idle-source':
            case 'idle-pile':
                setAnimation(ANIMATIONS.idle, true);
                beaver.phaseDuration = randomFloat(1.2, 2.4);
                break;
            case 'look-source':
            case 'look-pile':
            case 'look-en-route':
                setAnimation(ANIMATIONS.look, false);
                beaver.phaseDuration = getDuration(ANIMATIONS.look, 3.57);
                break;
            case 'talk-source':
                setAnimation(ANIMATIONS.talk, false);
                beaver.phaseDuration = getDuration(ANIMATIONS.talk, 3.87);
                break;
            case 'talk-user':
                setAnimation(ANIMATIONS.talk, true);
                beaver.phaseDuration = 0;
                break;
            case 'harvest-hidden':
                beaver.hasLog = true;
                setAnimation(ANIMATIONS.idle, true);
                beaver.phaseDuration = randomFloat(1.1, 1.7);
                break;
            case 'walk-carry':
                beaver.hasLog = true;
                beaver.facingRight = beaver.pileX >= beaver.x;
                if (options.newLeg) {
                    beaver.lookStoppedThisLeg = false;
                    beaver.distanceSinceLookStop = 0;
                    beaver.nextLookStopDistance = randomFloat(LOOK_STOP_DISTANCE.min, LOOK_STOP_DISTANCE.max);
                }
                setAnimation(isRunning ? ANIMATIONS.run : ANIMATIONS.walkCarry, true);
                break;
            case 'walk-empty':
                beaver.hasLog = false;
                beaver.facingRight = beaver.sourceX >= beaver.x;
                if (options.newLeg) {
                    beaver.lookStoppedThisLeg = false;
                    beaver.distanceSinceLookStop = 0;
                    beaver.nextLookStopDistance = randomFloat(LOOK_STOP_DISTANCE.min, LOOK_STOP_DISTANCE.max);
                }
                setAnimation(isRunning ? ANIMATIONS.run : ANIMATIONS.walk, true);
                break;
            case 'stop-carry':
                setAnimation(ANIMATIONS.stopCarry, false);
                beaver.phaseDuration = Number(options.duration)
                    || getDuration(ANIMATIONS.stopCarry, 0.67) + randomFloat(0.35, 0.9);
                break;
            case 'stop-empty':
                setAnimation(ANIMATIONS.stop, false);
                beaver.phaseDuration = Number(options.duration)
                    || getDuration(ANIMATIONS.stop, 0.67) + randomFloat(0.2, 0.55);
                break;
            case 'drop':
                beaver.hasLog = true;
                setAnimation(ANIMATIONS.drop, false);
                beaver.phaseDuration = getDuration(ANIMATIONS.drop, 0.67) + 0.18;
                break;
            default:
                break;
        }
        syncFacing();
    }

    function configureViewport(instance) {
        if (!instance?.calculateAnimationViewport || !instance?.config?.viewport) return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        GAMEPLAY_ANIMATIONS.forEach((animationName) => {
            const animation = instance.skeleton?.data?.findAnimation?.(animationName);
            if (!animation) return;
            const bounds = {};
            instance.calculateAnimationViewport(animation, bounds);
            if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return;
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });
        if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return;
        const padX = (maxX - minX) * 0.08;
        const padY = (maxY - minY) * 0.08;
        beaver.calculatedViewportBounds = {
            x: minX - padX,
            y: minY - padY,
            width: maxX - minX + padX * 2,
            height: maxY - minY + padY * 2
        };
        beaver.viewportBounds = { ...STABLE_VIEWPORT };
        Object.assign(instance.config.viewport, {
            ...beaver.viewportBounds,
            padLeft: 0,
            padRight: 0,
            padTop: 0,
            padBottom: 0,
            transitionTime: 0
        });
        if (typeof instance.skeleton?.setupPoseSlots === 'function') instance.skeleton.setupPoseSlots();
        else instance.skeleton?.setSlotsToSetupPose?.();
        if (typeof instance.skeleton?.setupPoseBones === 'function') instance.skeleton.setupPoseBones();
        else instance.skeleton?.setBonesToSetupPose?.();
    }

    function updateRenderSurface() {
        if (!beaver?.container) return;
        const current = scene();
        const surface = beaver.container.querySelector(':scope > .spine-player');
        if (!surface) return;
        const renderWidth = Math.max(1, beaver.renderWidth * current.spineCanvasRenderZoom);
        const renderHeight = Math.max(1, beaver.renderHeight * current.spineCanvasRenderZoom);
        const displayScale = current.zoomLevel / current.spineCanvasRenderZoom;
        const layoutKey = `${renderWidth}|${renderHeight}|${displayScale}`;
        if (surface.dataset.gameZoomLayout === layoutKey) return;
        surface.dataset.gameZoomLayout = layoutKey;
        Object.assign(surface.style, {
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

    function updateContainer() {
        if (!beaver?.container) return;
        const current = scene();
        const left = beaver.x - beaver.width * 0.5;
        const top = beaverRenderWorldTop();
        const rootCanvasPosition = getSpineBoneRenderPosition(beaver.spinePlayer?.skeleton?.getRootBone?.());
        const rootWorldY = rootCanvasPosition ? top + rootCanvasPosition.y : NaN;
        const rootTargetWorldY = beaverRootTargetWorldY();
        beaver.container.style.left = `${(left - current.camera.x) * current.zoomLevel}px`;
        beaver.container.style.top = `${(top - current.camera.y) * current.zoomLevel}px`;
        beaver.container.style.width = `${beaver.renderWidth * current.zoomLevel}px`;
        beaver.container.style.height = `${beaver.renderHeight * current.zoomLevel}px`;
        beaver.container.dataset.phase = beaver.phase;
        beaver.container.dataset.animation = beaver.animation;
        beaver.container.dataset.deliveredLogs = String(beaver.deliveredCount);
        beaver.container.dataset.droppedLogs = String(droppedLogs.length);
        beaver.container.dataset.conversations = String(beaver.conversationCount);
        beaver.container.dataset.conversationActive = String(beaver.conversationActive);
        beaver.container.dataset.lookStops = String(beaver.lookStopCount);
        beaver.container.dataset.lookStoppedThisLeg = String(beaver.lookStoppedThisLeg);
        beaver.container.dataset.facing = beaver.facingRight ? 'right' : 'left';
        beaver.container.dataset.routeDistance = String(Math.abs(beaver.pileX - beaver.sourceX));
        beaver.container.dataset.sourceX = String(beaver.sourceX);
        beaver.container.dataset.harvestCenterX = String(beaver.harvestCenterX);
        beaver.container.dataset.pileX = String(beaver.pileX);
        beaver.container.dataset.pileCenterX = String(beaver.pileCenterX);
        beaver.container.dataset.worldX = String(beaver.x);
        beaver.container.dataset.rootWorldY = Number.isFinite(rootWorldY) ? String(rootWorldY) : '';
        beaver.container.dataset.rootTargetWorldY = String(rootTargetWorldY);
        beaver.container.dataset.rootAlignmentDeltaY = Number.isFinite(rootWorldY)
            ? String(rootWorldY - rootTargetWorldY)
            : '';
        beaver.container.dataset.carryOverlayAvailable = String(beaver.overlayAvailable);
        beaver.container.dataset.carryOverlayActive = String(beaver.overlayActive);
        beaver.container.dataset.dropEventCount = String(beaver.dropEventCount);
        beaver.container.dataset.lastDropUsedLogBone = String(beaver.lastDropUsedLogBone);
        beaver.container.dataset.availableAnimations = beaver.availableAnimations.join(',');
        if (beaver.viewportBounds) {
            beaver.container.dataset.viewportX = String(beaver.viewportBounds.x);
            beaver.container.dataset.viewportY = String(beaver.viewportBounds.y);
            beaver.container.dataset.viewportWidth = String(beaver.viewportBounds.width);
            beaver.container.dataset.viewportHeight = String(beaver.viewportBounds.height);
        }
        beaver.container.dataset.animationHistory = [...beaver.animationHistory].join(',');
        beaver.container.style.pointerEvents = beaver.phase === 'harvest-hidden' ? 'none' : 'auto';
        updateRenderSurface();
    }

    function updateHarvestArea() {
        if (!harvestArea || !beaver) return;
        const current = scene();
        const left = beaver.harvestCenterX - HARVEST_SIZE.width * 0.5;
        const top = beaver.groundY - HARVEST_SIZE.height;
        Object.assign(harvestArea.style, {
            left: `${(left - current.camera.x) * current.zoomLevel}px`,
            top: `${(top - current.camera.y) * current.zoomLevel}px`,
            width: `${HARVEST_SIZE.width * current.zoomLevel}px`,
            height: `${HARVEST_SIZE.height * current.zoomLevel}px`,
            borderWidth: `${Math.max(3, 10 * current.zoomLevel)}px`,
            borderRadius: `${Math.max(5, 18 * current.zoomLevel)}px ${Math.max(5, 18 * current.zoomLevel)}px ${Math.max(2, 6 * current.zoomLevel)}px ${Math.max(2, 6 * current.zoomLevel)}px`,
            fontSize: `${Math.max(10, 23 * current.zoomLevel)}px`,
            paddingTop: `${Math.max(8, 24 * current.zoomLevel)}px`
        });
    }

    function layout({ reset = false } = {}) {
        if (!beaver) return;
        const nextRoute = route();
        const previousSource = beaver.sourceX;
        const previousPile = beaver.pileX;
        const previousPileCenter = beaver.pileCenterX;
        const previousGround = beaver.groundY;
        beaver.sourceX = nextRoute.sourceX;
        beaver.harvestCenterX = nextRoute.harvestCenterX;
        beaver.pileX = nextRoute.pileX;
        beaver.pileCenterX = nextRoute.pileCenterX;
        beaver.groundY = groundY();
        if (reset || !Number.isFinite(beaver.x)) {
            const progress = Math.max(0, Math.min(1, Number(spawnProgress) || 0));
            beaver.x = nextRoute.sourceX + (nextRoute.pileX - nextRoute.sourceX) * progress;
        } else if (Number.isFinite(previousSource) && Number.isFinite(previousPile) && previousPile !== previousSource) {
            const progress = Math.max(0, Math.min(1, (beaver.x - previousSource) / (previousPile - previousSource)));
            beaver.x = nextRoute.sourceX + (nextRoute.pileX - nextRoute.sourceX) * progress;
        }
        if (Number.isFinite(previousPileCenter) && Number.isFinite(previousGround)) {
            const shiftX = beaver.pileCenterX - previousPileCenter;
            const shiftY = beaver.groundY - previousGround;
            droppedLogs.forEach((log) => {
                log.startX += shiftX;
                log.targetX += shiftX;
                log.x += shiftX;
                log.startY += shiftY;
                log.targetY += shiftY;
                log.y += shiftY;
            });
        }
        updateContainer();
        updateHarvestArea();
    }

    function logTarget(logIndex) {
        const slots = [
            { x: -78, y: -18, rotation: -0.04 },
            { x: 0, y: -20, rotation: 0.03 },
            { x: 78, y: -18, rotation: -0.02 },
            { x: -43, y: -57, rotation: 0.05 },
            { x: 43, y: -58, rotation: -0.04 },
            { x: 0, y: -96, rotation: 0.02 }
        ];
        const layer = Math.floor(logIndex / slots.length);
        const slot = slots[logIndex % slots.length];
        return {
            x: beaver.pileCenterX + slot.x + layer * 5,
            y: beaver.groundY + slot.y - layer * 8,
            rotation: slot.rotation + layer * 0.03
        };
    }

    function spawnDroppedLog(boneWorldPosition = null) {
        if (!beaver || beaver.dropSpawned) return;
        beaver.dropSpawned = true;
        const target = logTarget((beaver.deliveredCount + logSlotOffset) % MAX_DROPPED_LOGS);
        const hasBonePosition = Number.isFinite(boneWorldPosition?.x) && Number.isFinite(boneWorldPosition?.y);
        const startCenterX = hasBonePosition
            ? boneWorldPosition.x
            : beaver.x + (beaver.facingRight ? 48 : -48);
        const startCenterY = hasBonePosition ? boneWorldPosition.y : beaver.groundY - 190;
        const startBottomY = startCenterY + DROPPED_LOG_SIZE.height * 0.5;
        beaver.lastDropStartX = startCenterX;
        beaver.lastDropStartY = startCenterY;
        beaver.lastDropUsedLogBone = hasBonePosition;
        nextLogId += 1;
        droppedLogs.push({
            id: nextLogId,
            startX: startCenterX,
            startY: startBottomY,
            x: startCenterX,
            y: startBottomY,
            targetX: target.x,
            targetY: target.y,
            rotation: beaver.facingRight ? -0.28 : 0.28,
            targetRotation: target.rotation,
            elapsed: 0,
            duration: 0.72,
            settled: false
        });
        if (droppedLogs.length > MAX_DROPPED_LOGS) droppedLogs.shift();
        beaver.deliveredCount += 1;
    }

    function updateDroppedLogs(dt) {
        droppedLogs.forEach((log) => {
            if (log.settled) return;
            log.elapsed += dt;
            const t = Math.max(0, Math.min(1, log.elapsed / log.duration));
            const horizontalEase = 1 - Math.pow(1 - t, 3);
            const gravityEase = t * t;
            log.x = log.startX + (log.targetX - log.startX) * horizontalEase;
            log.y = log.startY + (log.targetY - log.startY) * gravityEase;
            log.rotation += (log.targetRotation - log.rotation) * Math.min(1, dt * 9);
            if (t >= 1) {
                log.x = log.targetX;
                log.y = log.targetY;
                log.rotation = log.targetRotation;
                log.settled = true;
            }
        });
    }

    function finishTimedPhase() {
        switch (beaver.phase) {
            case 'idle-source': enterPhase('look-source'); break;
            case 'look-source':
                enterPhase(beaver.cycleCount % 2 === 1 ? 'talk-source' : 'walk-carry');
                break;
            case 'talk-source': enterPhase('walk-carry'); break;
            case 'harvest-hidden': enterPhase('walk-carry', { newLeg: true }); break;
            case 'stop-carry':
            case 'stop-empty': {
                const resumePhase = beaver.resumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty');
                if (resumePhase === 'look-en-route') {
                    enterPhase('look-en-route', {
                        resumePhase: beaver.travelResumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty')
                    });
                } else if (resumePhase === 'talk-user') {
                    enterPhase('talk-user', {
                        resumePhase: beaver.talkResumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty')
                    });
                } else {
                    enterPhase(resumePhase);
                }
                break;
            }
            case 'drop':
                beaver.hasLog = false;
                beaver.cycleCount += 1;
                enterPhase('idle-pile');
                break;
            case 'idle-pile': enterPhase('look-pile'); break;
            case 'look-pile': enterPhase('walk-empty', { newLeg: true }); break;
            case 'look-en-route': enterPhase(beaver.resumePhase || 'walk-empty'); break;
            case 'talk-user': enterPhase(beaver.resumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty')); break;
            default: break;
        }
    }

    function getConversationResumePhase() {
        if (!beaver) return 'walk-empty';
        switch (beaver.phase) {
            case 'walk-carry':
            case 'walk-empty':
                return beaver.phase;
            case 'stop-carry':
            case 'stop-empty':
                if (beaver.resumePhase === 'look-en-route') {
                    return beaver.travelResumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty');
                }
                return beaver.resumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty');
            case 'look-en-route':
                return beaver.resumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty');
            case 'drop':
                return beaver.dropSpawned ? 'idle-pile' : 'drop';
            case 'harvest-hidden':
            case 'idle-source':
            case 'look-source':
            case 'talk-source':
                return 'walk-carry';
            case 'idle-pile':
            case 'look-pile':
                return 'look-pile';
            default:
                return beaver.hasLog ? 'walk-carry' : 'walk-empty';
        }
    }

    function facePlayer() {
        const playerState = getPlayerState?.();
        const playerX = Number(playerState?.x);
        if (!beaver || !Number.isFinite(playerX)) return;
        beaver.facingRight = playerX >= beaver.x;
        syncFacing();
    }

    function setConversationActive(active) {
        if (!beaver || beaver.conversationActive === Boolean(active)) return;
        beaver.conversationActive = Boolean(active);
        beaver.conversationInputGrace = active ? 0.2 : 0;
        onConversationChange?.(beaver.conversationActive, {
            beaverX: beaver.x,
            beaverGroundY: beaver.groundY,
            hasLog: beaver.hasLog
        });
    }

    function cancelConversation(reason = 'input', event = null) {
        if (!beaver?.conversationActive) return false;
        if ((event?.type === 'pointerdown' || event?.type === 'keydown') && beaver.container?.contains?.(event.target)) {
            beaver.suppressConversationClickUntil = performance.now() + 400;
        }
        let resumePhase = getConversationResumePhase();
        if ((beaver.phase === 'stop-carry' || beaver.phase === 'stop-empty') && beaver.resumePhase === 'talk-user') {
            resumePhase = beaver.talkResumePhase || resumePhase;
        }
        setConversationActive(false);
        enterPhase(resumePhase || (beaver.hasLog ? 'walk-carry' : 'walk-empty'));
        updateContainer();
        return true;
    }

    function handleConversationInput(event) {
        if (beaver?.conversationActive) cancelConversation(event?.type || 'input', event);
    }

    function requestConversation(event) {
        if (!beaver?.ready || beaver.conversationActive || beaver.phase === 'harvest-hidden') return;
        if (performance.now() < (beaver.suppressConversationClickUntil || 0)) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const resumePhase = getConversationResumePhase();
        if (beaver.phase === 'drop' && beaver.dropSpawned) beaver.hasLog = false;
        beaver.conversationCount += 1;
        setConversationActive(true);
        if (beaver.phase === 'walk-carry' || beaver.phase === 'walk-empty') {
            beaver.talkResumePhase = resumePhase;
            enterPhase(beaver.hasLog ? 'stop-carry' : 'stop-empty', {
                resumePhase: 'talk-user',
                duration: getDuration(beaver.hasLog ? ANIMATIONS.stopCarry : ANIMATIONS.stop, 0.67)
            });
        } else {
            enterPhase('talk-user', { resumePhase });
        }
        facePlayer();
        updateContainer();
    }

    function update(dt) {
        if (!beaver?.ready) return;
        const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));
        beaver.phaseTime += step;
        beaver.pauseCooldown = Math.max(0, beaver.pauseCooldown - step);
        beaver.conversationInputGrace = Math.max(0, beaver.conversationInputGrace - step);
        updateDroppedLogs(step);

        if (beaver.conversationActive && beaver.conversationInputGrace <= 0 && hasActivePlayerInput?.()) {
            cancelConversation('active player input');
        }

        if (beaver.phase === 'walk-carry' || beaver.phase === 'walk-empty') {
            const wasCarrying = beaver.phase === 'walk-carry';
            const targetX = wasCarrying ? beaver.pileX : beaver.sourceX;
            const delta = targetX - beaver.x;
            const direction = Math.sign(delta);
            const moveDistance = Math.min(Math.abs(delta), moveSpeed * step);
            beaver.facingRight = direction >= 0;
            beaver.x += direction * moveDistance;
            beaver.distanceSinceLookStop += moveDistance;
            syncFacing();

            if (Math.abs(targetX - beaver.x) <= ARRIVAL_DISTANCE) {
                beaver.x = targetX;
                beaver.distanceSinceLookStop = 0;
                beaver.nextLookStopDistance = randomFloat(LOOK_STOP_DISTANCE.min, LOOK_STOP_DISTANCE.max);
                enterPhase(wasCarrying ? 'stop-carry' : 'stop-empty', {
                    resumePhase: wasCarrying ? 'drop' : 'harvest-hidden',
                    duration: getDuration(wasCarrying ? ANIMATIONS.stopCarry : ANIMATIONS.stop, 0.67)
                });
            } else if (
                beaver.pauseCooldown <= 0
                && !beaver.lookStoppedThisLeg
                && Math.abs(targetX - beaver.x) > 115
                && beaver.distanceSinceLookStop >= beaver.nextLookStopDistance
            ) {
                const resumePhase = beaver.phase;
                beaver.pauseCooldown = randomFloat(4.5, 7.5);
                beaver.distanceSinceLookStop = 0;
                beaver.nextLookStopDistance = randomFloat(LOOK_STOP_DISTANCE.min, LOOK_STOP_DISTANCE.max);
                beaver.travelResumePhase = resumePhase;
                beaver.lookStoppedThisLeg = true;
                beaver.lookStopCount += 1;
                enterPhase(beaver.hasLog ? 'stop-carry' : 'stop-empty', { resumePhase: 'look-en-route' });
            }
        }

        if (beaver.phaseDuration > 0 && beaver.phaseTime >= beaver.phaseDuration) finishTimedPhase();
        updateContainer();
        updateHarvestArea();
    }

    function drawLog(context, log) {
        const { width, height } = DROPPED_LOG_SIZE;
        context.save();
        context.translate(log.x, log.y - height * 0.5);
        context.rotate(log.rotation);
        if (logImage.complete && logImage.naturalWidth > 0) {
            context.drawImage(logImage, -width * 0.5, -height * 0.5, width, height);
        }
        context.restore();
    }

    function drawShop(context, currentRoute, currentGroundY) {
        if (!shopImage.complete || shopImage.naturalWidth <= 0) return;
        context.save();
        context.drawImage(
            shopImage,
            currentRoute.shopX - SHOP_SIZE.width * 0.5,
            currentGroundY - SHOP_SIZE.height,
            SHOP_SIZE.width,
            SHOP_SIZE.height
        );
        context.restore();
    }

    function draw(context) {
        if (!context) return;
        const currentRoute = route();
        const currentGroundY = groundY();
        const left = currentRoute.pileCenterX - PILE_SIZE.width * 0.5;
        const top = currentGroundY - PILE_SIZE.height;
        context.save();
        if (ownsScenery) {
            drawShop(context, currentRoute, currentGroundY);
            context.fillStyle = 'rgba(111, 72, 38, 0.16)';
            context.strokeStyle = 'rgba(255, 218, 137, 0.8)';
            context.lineWidth = 4;
            context.setLineDash([18, 13]);
            roundedRectPath(context, left, top, PILE_SIZE.width, PILE_SIZE.height, 28);
            context.fill();
            context.stroke();
            context.setLineDash([]);
            context.fillStyle = 'rgba(52, 32, 20, 0.78)';
            context.font = 'bold 30px sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'bottom';
            context.fillText('LOG PILE', currentRoute.pileCenterX, top - 12);
        }
        droppedLogs.forEach(log => drawLog(context, log));
        context.restore();
    }

    function getSnapshot() {
        return {
            ready: Boolean(beaver?.ready),
            phase: beaver?.phase || 'missing',
            animation: beaver?.animation || '',
            hasLog: Boolean(beaver?.hasLog),
            x: beaver?.x ?? null,
            sourceX: beaver?.sourceX ?? null,
            harvestCenterX: beaver?.harvestCenterX ?? null,
            pileX: beaver?.pileX ?? null,
            pileCenterX: beaver?.pileCenterX ?? null,
            deliveredCount: beaver?.deliveredCount || 0,
            visibleDroppedLogs: droppedLogs.length,
            dropEventCount: beaver?.dropEventCount || 0,
            lastDropEventName: beaver?.lastDropEventName || '',
            lastDropUsedLogBone: Boolean(beaver?.lastDropUsedLogBone),
            lastDropStartX: beaver?.lastDropStartX ?? null,
            lastDropStartY: beaver?.lastDropStartY ?? null,
            logBoneName: beaver?.logBone?.data?.name || '',
            conversationCount: beaver?.conversationCount || 0,
            conversationActive: Boolean(beaver?.conversationActive),
            lookStopCount: beaver?.lookStopCount || 0,
            lookStoppedThisLeg: Boolean(beaver?.lookStoppedThisLeg),
            harvestAreaVisible: Boolean(harvestArea),
            routeDistance: beaver ? Math.abs(beaver.pileX - beaver.sourceX) : 0,
            carryOverlayAvailable: Boolean(beaver?.overlayAvailable),
            carryOverlayActive: Boolean(beaver?.overlayActive),
            rootAnchorName: beaver?.rootAnchorName || '',
            rootWorldY: (() => {
                const rootCanvasPosition = getSpineBoneRenderPosition(beaver?.spinePlayer?.skeleton?.getRootBone?.());
                return rootCanvasPosition ? beaverRenderWorldTop() + rootCanvasPosition.y : null;
            })(),
            rootTargetWorldY: beaver ? beaverRootTargetWorldY() : null,
            gameplayAnimations: [...GAMEPLAY_ANIMATIONS],
            availableAnimations: [...(beaver?.availableAnimations || [])],
            animationHistory: [...(beaver?.animationHistory || [])],
            internalRigAnimations: [...(beaver?.internalAnimations || [])]
        };
    }

    function create() {
        if (beaver || !gameBoardElement || !spine?.SpinePlayer) return false;
        if (hasSpineCapacity && !hasSpineCapacity()) {
            console.warn('Beaver NPC was not loaded because the scene reached its Spine graphics capacity.');
            return false;
        }
        if (ownsScenery) {
            harvestArea = document.createElement('div');
            harvestArea.className = 'beaver-harvest-area';
            harvestArea.textContent = 'HARVEST';
            harvestArea.setAttribute('aria-hidden', 'true');
            Object.assign(harvestArea.style, {
                position: 'absolute',
                boxSizing: 'border-box',
                pointerEvents: 'none',
                overflow: 'hidden',
                zIndex: String(drawOrder + 1),
                color: 'rgba(255, 232, 184, 0.9)',
                fontFamily: 'sans-serif',
                fontWeight: '800',
                letterSpacing: '0.08em',
                textAlign: 'center',
                background: 'linear-gradient(90deg, #583119 0%, #7b4725 20%, #6c3d20 54%, #4d2a17 100%)',
                borderStyle: 'solid',
                borderColor: '#3b2114',
                boxShadow: 'inset 20px 0 0 rgba(255, 190, 104, 0.08), inset -24px 0 0 rgba(35, 16, 8, 0.12)',
                willChange: 'left, top, width, height'
            });
            gameBoardElement.appendChild(harvestArea);
        }

        const container = document.createElement('div');
        container.className = 'beaver-npc-container';
        container.dataset.beaverId = debugName;
        container.setAttribute('role', 'button');
        container.setAttribute('aria-label', 'Talk to the beaver lumberjack');
        container.setAttribute('title', 'Tap to talk');
        container.tabIndex = 0;
        Object.assign(container.style, {
            position: 'absolute',
            pointerEvents: 'auto',
            overflow: 'visible',
            zIndex: String(drawOrder),
            cursor: 'pointer',
            touchAction: 'manipulation',
            willChange: 'left, top, transform'
        });
        container.addEventListener('pointerup', requestConversation);
        container.addEventListener('click', requestConversation);
        container.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') requestConversation(event);
        });
        document.addEventListener('pointerdown', handleConversationInput, true);
        document.addEventListener('keydown', handleConversationInput, true);
        document.addEventListener('wheel', handleConversationInput, { capture: true, passive: true });
        gameBoardElement.appendChild(container);
        beaver = {
            x: NaN,
            sourceX: NaN,
            harvestCenterX: NaN,
            pileX: NaN,
            pileCenterX: NaN,
            groundY: groundY(),
            width: WORLD_SIZE.width,
            height: WORLD_SIZE.height,
            renderWidth: SPINE_RENDER_SIZE.width,
            renderHeight: SPINE_RENDER_SIZE.height,
            container,
            spinePlayer: null,
            ready: false,
            facingRight: true,
            hasLog: false,
            phase: 'loading',
            phaseTime: 0,
            phaseDuration: 0,
            resumePhase: '',
            pauseCooldown: 3,
            distanceSinceLookStop: 0,
            nextLookStopDistance: randomFloat(LOOK_STOP_DISTANCE.min, LOOK_STOP_DISTANCE.max),
            lookStoppedThisLeg: false,
            travelResumePhase: '',
            talkResumePhase: '',
            conversationActive: false,
            conversationInputGrace: 0,
            suppressConversationClickUntil: 0,
            animation: '',
            overlayAvailable: false,
            overlayActive: false,
            carriedLogFallback: null,
            availableAnimations: [],
            calculatedViewportBounds: null,
            viewportBounds: null,
            rootAnchorName: '',
            logBone: null,
            animationEventListener: null,
            dropSpawned: false,
            dropEventCount: 0,
            lastDropEventName: '',
            lastDropUsedLogBone: false,
            lastDropStartX: NaN,
            lastDropStartY: NaN,
            deliveredCount: 0,
            conversationCount: 0,
            lookStopCount: 0,
            cycleCount: 0,
            animationHistory: new Set(),
            internalAnimations: []
        };
        layout({ reset: true });

        try {
            new spine.SpinePlayer(container, {
                skelUrl: assetPaths.skel,
                atlasUrl: assetPaths.atlas,
                showControls: false,
                interactive: false,
                alpha: true,
                backgroundAlpha: 0,
                fitToCanvas: true,
                defaultMix: DEFAULT_ANIMATION_MIX,
                animation: ANIMATIONS.idle,
                loop: true,
                updateWorldTransform: stabilizeSkeletonWorldTransform,
                success: (instance) => {
                    if (!beaver || beaver.container !== container) {
                        instance.dispose?.();
                        return;
                    }
                    const skeletonData = instance.skeleton?.data;
                    const missingAnimation = GAMEPLAY_ANIMATIONS.find(
                        animationName => !skeletonData?.findAnimation?.(animationName)
                    );
                    if (missingAnimation) {
                        console.error(`Beaver NPC animation "${missingAnimation}" was not found.`);
                        return;
                    }
                    beaver.spinePlayer = instance;
                    beaver.availableAnimations = (skeletonData.animations || []).map(animation => animation.name);
                    beaver.internalAnimations = beaver.availableAnimations
                        .filter(name => name.startsWith('__'));
                    beaver.overlayAvailable = Boolean(skeletonData.findAnimation?.(ANIMATIONS.carryOverlay));
                    beaver.rootAnchorName = instance.skeleton?.getRootBone?.()?.data?.name || '';
                    const animationStateData = instance.animationState?.data;
                    if (animationStateData?.setMix) {
                        const primaryLocomotionAnimation = isRunning ? ANIMATIONS.run : ANIMATIONS.walkCarry;
                        const primaryLocomotionMixIn = isRunning ? RUN_MIX_IN : WALK_CARRY_MIX_IN;
                        GAMEPLAY_ANIMATIONS.forEach((fromAnimationName) => {
                            if (fromAnimationName !== primaryLocomotionAnimation) {
                                animationStateData.setMix(
                                    fromAnimationName,
                                    primaryLocomotionAnimation,
                                    primaryLocomotionMixIn
                                );
                            }
                        });
                    }
                    beaver.logBone = instance.skeleton?.findBone?.(LOG_BONE_NAME) || null;
                    if (!beaver.logBone) {
                        console.error(`Beaver NPC bone "${LOG_BONE_NAME}" was not found.`);
                    }
                    beaver.animationEventListener = { event: handleSpineAnimationEvent };
                    instance.animationState?.addListener?.(beaver.animationEventListener);
                    const carriedLogFallback = document.createElement('img');
                    carriedLogFallback.className = 'beaver-carried-log-fallback';
                    carriedLogFallback.src = assetPaths.log;
                    carriedLogFallback.alt = '';
                    carriedLogFallback.draggable = false;
                    carriedLogFallback.setAttribute('aria-hidden', 'true');
                    Object.assign(carriedLogFallback.style, {
                        position: 'absolute',
                        left: '25%',
                        top: '45%',
                        width: '34%',
                        height: 'auto',
                        display: 'none',
                        pointerEvents: 'none',
                        zIndex: '2',
                        transform: 'rotate(-8deg)',
                        transformOrigin: '50% 50%'
                    });
                    container.appendChild(carriedLogFallback);
                    beaver.carriedLogFallback = carriedLogFallback;
                    beaver.ready = true;
                    configureViewport(instance);
                    enterPhase(initialPhase, {
                        newLeg: initialPhase === 'walk-carry' || initialPhase === 'walk-empty'
                    });
                    updateContainer();
                    if (!beaver.overlayAvailable) {
                        console.info('[Beaver NPC] carryingLogOverlay is absent; using the atlas log visual fallback.');
                    }
                    console.info('[Beaver NPC] Ready with gameplay animations:', GAMEPLAY_ANIMATIONS);
                },
                error: (instance, error) => {
                    console.error('Beaver NPC Spine error:', error || instance);
                }
            });
        } catch (error) {
            console.error('Beaver NPC could not be created:', error);
            harvestArea?.remove?.();
            harvestArea = null;
            return false;
        }
        return true;
    }

    function resize() {
        beaver?.spinePlayer?.resize?.();
        updateContainer();
        updateHarvestArea();
    }

    function dispose() {
        if (beaver?.conversationActive) setConversationActive(false);
        document.removeEventListener('pointerdown', handleConversationInput, true);
        document.removeEventListener('keydown', handleConversationInput, true);
        document.removeEventListener('wheel', handleConversationInput, true);
        if (beaver?.animationEventListener) {
            beaver.spinePlayer?.animationState?.removeListener?.(beaver.animationEventListener);
        }
        try { beaver?.spinePlayer?.dispose?.(); } catch (error) { /* no-op */ }
        beaver?.container?.remove?.();
        harvestArea?.remove?.();
        beaver = null;
        harvestArea = null;
        droppedLogs.length = 0;
    }

    const controller = Object.freeze({
        create,
        dispose,
        draw,
        getManagedPlayerCount: () => beaver ? 1 : 0,
        getSnapshot,
        layout,
        resize,
        update
    });

    Object.defineProperty(window, '__beaverNpcDebug', {
        configurable: true,
        value: Object.freeze({ getSnapshot })
    });

    return controller;
}
