(function (global) {
    const STYLE_ID = 'vfx-smoke-style';

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .vfx-layer {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                overflow: visible;
                z-index: 1;
            }
            .vfx-smoke {
                position: absolute;
                pointer-events: none;
            }
            .vfx-smoke-ring,
            .vfx-smoke-core {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                border-radius: 50%;
            }
            .vfx-smoke-ring {
                background: rgba(0, 0, 0, 1);
                z-index: 0;
            }
            .vfx-smoke-core {
                background: rgba(180, 180, 180, 1);
                z-index: 1;
            }
            .vfx-sequence-layer {
                z-index: 2;
            }
            .vfx-sequence-frame {
                position: absolute;
                pointer-events: none;
                will-change: transform;
                image-rendering: auto;
            }
        `;
        document.head.appendChild(style);
    }

    const defaultConfig = {
        emissionRate: 40, // particles per second
        initialSize: 30,
        sizeVariance: 16,
        sizeGrowth: 20,
        lifetime: 0.8,
        fadeOutStart: 0.45,
        horizontalDrift: 45,
        verticalDrift: -25,
        spread: 22,
        outlineScale: 1.35,
        offset: { x: -20, y: 25, mirrorX: true }
    };

    function createParticleElement() {
        const wrapper = document.createElement('div');
        wrapper.className = 'vfx-smoke';
        const ring = document.createElement('div');
        ring.className = 'vfx-smoke-ring';
        const core = document.createElement('div');
        core.className = 'vfx-smoke-core';
        wrapper.appendChild(ring);
        wrapper.appendChild(core);
        return { wrapper, ring, core };
    }

    function randomRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    function mergeConfig(target, partial) {
        if (!partial || typeof partial !== 'object') return target;
        for (const key of Object.keys(partial)) {
            const value = partial[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                target[key] = mergeConfig(
                    Array.isArray(target[key]) ? [] : { ...(target[key] || {}) },
                    value
                );
            } else {
                target[key] = value;
            }
        }
        return target;
    }

    function clamp01(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return 0;
        return Math.min(1, Math.max(0, value));
    }

    function resolveNumber(value, fallback) {
        return (typeof value === 'number' && !Number.isNaN(value)) ? value : fallback;
    }

    function buildFramePaths(definition = {}) {
        if (Array.isArray(definition.framePaths) && definition.framePaths.length > 0) {
            return definition.framePaths.slice();
        }
        const pattern = definition.framePattern;
        if (!pattern) return [];
        const placeholders = definition.frameToken instanceof RegExp ? definition.frameToken : /\{frame\}/gi;
        const start = resolveNumber(definition.frameStart, 1);
        const end = resolveNumber(definition.frameEnd, start);
        const pad = Math.max(0, Math.floor(resolveNumber(definition.framePad, 4)));
        const paths = [];
        const baseStep = Math.max(1, Math.floor(resolveNumber(definition.frameStep, 1)));
        const step = start <= end ? baseStep : -baseStep;
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
            const padded = String(Math.abs(i)).padStart(pad, '0');
            if (typeof definition.frameFormatter === 'function') {
                const formatted = definition.frameFormatter(i, padded);
                if (formatted) paths.push(formatted);
                continue;
            }
            if (typeof pattern === 'function') {
                const generated = pattern(i, padded);
                if (generated) paths.push(generated);
                continue;
            }
            paths.push(String(pattern).replace(placeholders, padded));
        }
        return paths;
    }

    function preloadSequenceFrames(sequence, onComplete) {
        if (!sequence || !Array.isArray(sequence.framePaths)) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }
        let remaining = sequence.framePaths.length;
        if (remaining === 0) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }
        sequence.framePaths.forEach((path, index) => {
            const image = new Image();
            const finalize = (img) => {
                sequence.frames[index] = img || null;
                remaining -= 1;
                if (remaining <= 0 && typeof onComplete === 'function') onComplete();
            };
            image.onload = () => finalize(image);
            image.onerror = () => {
                console.warn(`[VFX] Failed to load frame "${path}" for sequence "${sequence.key}"`);
                finalize(null);
            };
            image.src = path;
        });
    }

    function init(options = {}) {
        const container = options.container;
        const stage = options.stage || container?.parentElement || document.body;
        if (!container || !stage) {
            console.warn('[VFX] init skipped: container or stage missing');
            return null;
        }

        ensureStyles();

        const config = mergeConfig(JSON.parse(JSON.stringify(defaultConfig)), options.config);
        const offsets = mergeConfig({ ...defaultConfig.offset }, options.offsets);

        const layer = document.createElement('div');
        layer.className = 'vfx-layer';
        stage.appendChild(layer);

        const particles = [];
        const pool = [];
        let emissionAccumulator = 0;
        let facingRight = false;
        let emitterWorldX = 0;
        let emitterWorldY = 0;
        let cameraX = 0;
        let cameraY = 0;
        let zoomLevel = 1;

        function spawnParticle() {
            const elements = pool.pop() || createParticleElement();
            layer.appendChild(elements.wrapper);
            const baseSize = config.initialSize + randomRange(-config.sizeVariance, config.sizeVariance);

            const horizontalSpread = randomRange(-config.spread, config.spread);
            const verticalSpread = randomRange(-config.spread, config.spread);

            const offsetX = (() => {
                if (offsets.mirrorX === false) return offsets.x || 0;
                const base = offsets.x || 0;
                return facingRight ? -base : base;
            })();
            const offsetY = offsets.y || 0;

            const anchorX = emitterWorldX + offsetX;
            const anchorY = emitterWorldY + offsetY;

            const particle = {
                elements,
                life: 0,
                lifespan: config.lifetime,
                size: baseSize,
                x: anchorX + horizontalSpread,
                y: anchorY + verticalSpread,
                vx: randomRange(-config.horizontalDrift, config.horizontalDrift),
                vy: randomRange(-config.verticalDrift, config.verticalDrift),
            };
            particles.push(particle);
            updateParticleVisual(particle, 0);
        }

        function updateParticleVisual(particle, progress) {
            const { elements } = particle;
            const growth = config.sizeGrowth * progress;
            const currentSize = Math.max(1, particle.size + growth);
            const outlineSize = currentSize * (config.outlineScale || 1.2);
            const screenX = (particle.x - cameraX) * zoomLevel;
            const screenY = (particle.y - cameraY) * zoomLevel;
            const fadeStart = Math.max(0, Math.min(1, config.fadeOutStart));
            let sizeMultiplier = 1;
            if (progress >= fadeStart) {
                const shrinkProgress = (progress - fadeStart) / (1 - fadeStart || 1);
                sizeMultiplier = Math.max(0, 1 - shrinkProgress);
            }
            const pixelSize = currentSize * zoomLevel * sizeMultiplier;
            const pixelOutline = outlineSize * zoomLevel * sizeMultiplier;
            elements.wrapper.style.transform = `translate(${screenX}px, ${screenY}px)`;
            elements.core.style.width = `${pixelSize}px`;
            elements.core.style.height = `${pixelSize}px`;
            elements.ring.style.width = `${pixelOutline}px`;
            elements.ring.style.height = `${pixelOutline}px`;
            elements.core.style.opacity = 1;
            elements.ring.style.opacity = 0.9;
        }

        function recycleParticle(particle, index) {
            if (particle.elements.wrapper.parentElement === layer) {
                layer.removeChild(particle.elements.wrapper);
            }
            pool.push(particle.elements);
            particles.splice(index, 1);
        }

        const controller = {
            update(dt, ctx = {}) {
                if (!layer.parentElement) return;
                emitterWorldX = ctx.emitterWorldX ?? emitterWorldX;
                emitterWorldY = ctx.emitterWorldY ?? emitterWorldY;
                cameraX = ctx.cameraX ?? cameraX;
                cameraY = ctx.cameraY ?? cameraY;
                zoomLevel = ctx.zoom ?? (zoomLevel ?? 1);
                facingRight = ctx.facingRight ?? facingRight;

                const emitting = !!ctx.emitting;
                if (emitting) {
                    emissionAccumulator += dt * Math.max(0, config.emissionRate);
                    while (emissionAccumulator >= 1) {
                        spawnParticle();
                        emissionAccumulator -= 1;
                    }
                } else {
                    emissionAccumulator = 0;
                }

                for (let i = particles.length - 1; i >= 0; i--) {
                    const particle = particles[i];
                    particle.life += dt;
                    const progress = particle.life / particle.lifespan;
                    if (particle.life >= particle.lifespan) {
                        recycleParticle(particle, i);
                        continue;
                    }
                    particle.x += particle.vx * dt;
                    particle.y += particle.vy * dt;
                    updateParticleVisual(particle, progress);
                }
            },
            setConfig(partial) {
                mergeConfig(config, partial);
            },
            setOffsets(partial) {
                mergeConfig(offsets, partial);
            },
            dispose() {
                particles.forEach(p => {
                    if (p.elements.wrapper.parentElement === layer) {
                        layer.removeChild(p.elements.wrapper);
                    }
                });
                particles.length = 0;
                pool.length = 0;
                if (layer.parentElement) {
                    layer.parentElement.removeChild(layer);
                }
            }
        };

        return controller;
    }

    function createSequenceController(options = {}) {
        const stage = options.stage || document.body;
        if (!stage) {
            console.warn('[VFX] createSequenceController skipped: stage missing');
            return null;
        }
        ensureStyles();
        const layer = document.createElement('div');
        layer.className = 'vfx-layer vfx-sequence-layer';
        if (typeof options.zIndex === 'number' && !Number.isNaN(options.zIndex)) {
            layer.style.zIndex = String(options.zIndex);
        }
        stage.appendChild(layer);

        const sequences = new Map();
        const activeInstances = [];
        let cameraX = 0;
        let cameraY = 0;
        let zoomLevel = 1;

        function finishSequenceLoad(sequence) {
            if (!sequence.baseWidth || !sequence.baseHeight) {
                const sample = sequence.frames.find(Boolean);
                if (sample) {
                    sequence.baseWidth = sample.naturalWidth || sample.width || sequence.baseWidth;
                    sequence.baseHeight = sample.naturalHeight || sample.height || sequence.baseHeight;
                }
            }
            sequence.loading = false;
            sequence.ready = true;
            if (sequence.pending.length) {
                const pendingCopies = sequence.pending.slice();
                sequence.pending.length = 0;
                pendingCopies.forEach(request => spawnInstance(sequence, request));
            }
        }

        function beginSequenceLoad(sequence) {
            if (!sequence || sequence.ready || sequence.loading) return;
            sequence.loading = true;
            preloadSequenceFrames(sequence, () => finishSequenceLoad(sequence));
        }

        function registerSequence(definition = {}) {
            const key = definition.key;
            if (!key) {
                console.warn('[VFX] Sequence definition missing "key"');
                return null;
            }
            if (sequences.has(key)) return sequences.get(key);
            const framePaths = buildFramePaths(definition);
            if (!framePaths.length) {
                console.warn(`[VFX] Sequence "${key}" has no frames to load`);
                return null;
            }
            const fps = Math.max(1, resolveNumber(definition.fps, 24) || 24);
            const frameDuration = Math.max(0.0001, resolveNumber(definition.frameDuration, 1 / fps) || (1 / fps));
            const seq = {
                key,
                framePaths,
                frames: new Array(framePaths.length),
                ready: false,
                loading: false,
                pending: [],
                loop: !!definition.loop,
                frameDuration,
                anchor: {
                    x: clamp01(definition.anchor?.x ?? 0.5),
                    y: clamp01(definition.anchor?.y ?? 0.5)
                },
                scale: Math.max(0.0001, resolveNumber(definition.scale, 1) || 1),
                opacity: clamp01(definition.opacity ?? 1),
                baseWidth: Math.max(0, resolveNumber(definition.frameWidth, 0) || 0),
                baseHeight: Math.max(0, resolveNumber(definition.frameHeight, 0) || 0)
            };
            sequences.set(key, seq);
            if (options.preload !== false) beginSequenceLoad(seq);
            return seq;
        }

        function spawnInstance(sequence, request = {}) {
            const img = document.createElement('img');
            img.className = 'vfx-sequence-frame';
            const opacity = clamp01(resolveNumber(request.opacity, sequence.opacity));
            img.style.opacity = `${opacity}`;
            img.draggable = false;
            layer.appendChild(img);
            const instance = {
                seq: sequence,
                img,
                worldX: resolveNumber(request.worldX, 0) ?? 0,
                worldY: resolveNumber(request.worldY, 0) ?? 0,
                elapsed: 0,
                frameIndex: 0,
                scale: Math.max(0.0001, resolveNumber(request.scale, sequence.scale) || sequence.scale || 1),
                anchor: {
                    x: clamp01(request.anchor?.x ?? sequence.anchor.x),
                    y: clamp01(request.anchor?.y ?? sequence.anchor.y)
                },
                flipX: !!request.flipX
            };
            activeInstances.push(instance);
            updateInstanceVisual(instance);
            return instance;
        }

        function updateInstanceVisual(instance) {
            const seq = instance.seq;
            const frame = seq.frames[instance.frameIndex];
            if (!frame) return;
            const zoom = zoomLevel || 1;
            const baseWidth = seq.baseWidth || frame.naturalWidth || frame.width || 1;
            const baseHeight = seq.baseHeight || frame.naturalHeight || frame.height || 1;
            const width = Math.max(1, baseWidth * instance.scale * zoom);
            const height = Math.max(1, baseHeight * instance.scale * zoom);
            const screenX = (instance.worldX - cameraX) * zoom;
            const screenY = (instance.worldY - cameraY) * zoom;
            const offsetX = width * (instance.anchor.x ?? 0.5);
            const offsetY = height * (instance.anchor.y ?? 0.5);
            const flipScale = instance.flipX ? -1 : 1;
            if (instance.img.src !== frame.src) {
                instance.img.src = frame.src;
            }
            instance.img.style.width = `${width}px`;
            instance.img.style.height = `${height}px`;
            instance.img.style.transform = `translate(${screenX - offsetX}px, ${screenY - offsetY}px) scaleX(${flipScale})`;
        }

        function disposeInstance(index) {
            const instance = activeInstances[index];
            if (!instance) return;
            if (instance.img.parentElement === layer) layer.removeChild(instance.img);
            activeInstances.splice(index, 1);
        }

        function play(sequenceKey, request = {}) {
            const seq = sequences.get(sequenceKey);
            if (!seq) {
                console.warn(`[VFX] Sequence "${sequenceKey}" is not registered`);
                return null;
            }
            if (!seq.ready) {
                seq.pending.push(request);
                beginSequenceLoad(seq);
                return null;
            }
            return spawnInstance(seq, request);
        }

        function playWithDelay(sequenceKey, request = {}, delayFrames = 0) {
            if (delayFrames <= 0 || typeof requestAnimationFrame !== 'function') {
                return play(sequenceKey, request);
            }
            let framesRemaining = Math.max(0, Math.floor(delayFrames));
            const schedule = () => {
                framesRemaining -= 1;
                if (framesRemaining <= 0) {
                    play(sequenceKey, request);
                } else {
                    requestAnimationFrame(schedule);
                }
            };
            requestAnimationFrame(schedule);
            return null;
        }

        function playBatch(sequenceKey, requests = [], options = {}) {
            if (!Array.isArray(requests) || !requests.length) return [];
            const delay = Math.max(0, Math.floor(options.delayFrames ?? 0));
            const spawned = [];
            requests.forEach((request, index) => {
                const spawnNow = () => {
                    const instance = play(sequenceKey, request);
                    if (instance) spawned.push(instance);
                };
                if (index === 0 || delay === 0 || typeof requestAnimationFrame !== 'function') {
                    spawnNow();
                    return;
                }
                let framesRemaining = delay;
                const schedule = () => {
                    framesRemaining -= 1;
                    if (framesRemaining <= 0) {
                        spawnNow();
                    } else {
                        requestAnimationFrame(schedule);
                    }
                };
                requestAnimationFrame(schedule);
            });
            return spawned;
        }

        function update(dt = 0, ctx = {}) {
            if (typeof dt !== 'number' || Number.isNaN(dt)) dt = 0;
            const nextCameraX = resolveNumber(ctx.cameraX, cameraX);
            const nextCameraY = resolveNumber(ctx.cameraY, cameraY);
            const nextZoom = resolveNumber(ctx.zoom, zoomLevel);
            if (typeof nextCameraX === 'number') cameraX = nextCameraX;
            if (typeof nextCameraY === 'number') cameraY = nextCameraY;
            if (typeof nextZoom === 'number' && nextZoom > 0) zoomLevel = nextZoom;
            for (let i = activeInstances.length - 1; i >= 0; i--) {
                const instance = activeInstances[i];
                const seq = instance.seq;
                instance.elapsed += dt;
                while (instance.elapsed >= seq.frameDuration) {
                    instance.elapsed -= seq.frameDuration;
                    instance.frameIndex += 1;
                    if (instance.frameIndex >= seq.frames.length) {
                        if (seq.loop) {
                            instance.frameIndex = 0;
                        } else {
                            disposeInstance(i);
                            break;
                        }
                    }
                }
                if (activeInstances[i] !== instance) continue;
                updateInstanceVisual(instance);
            }
        }

        function dispose() {
            for (let i = activeInstances.length - 1; i >= 0; i--) {
                disposeInstance(i);
            }
            sequences.clear();
            if (layer.parentElement) {
                layer.parentElement.removeChild(layer);
            }
        }

        if (Array.isArray(options.sequences)) {
            options.sequences.forEach(def => registerSequence(def));
        }

        return {
            registerSequence,
            play,
            playWithDelay,
            playBatch,
            update,
            dispose
        };
    }

    global.VFX = {
        init,
        createSequenceController
    };
})(window);
