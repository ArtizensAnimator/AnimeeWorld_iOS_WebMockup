(function environmentBgAnimsBootstrap(global) {
    'use strict';

    if (global.EnvironmentBgAnims) return;

    const FPS = 15;
    const FRAME_DURATION = 1 / FPS;
    const ROOT = 'Environment BG Anims';
    const MAX_DPR = 2;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const lerp = (a, b, t) => a + (b - a) * t;
    const random = (min, max) => min + Math.random() * (max - min);
    const randomInt = (min, max) => Math.floor(random(min, max + 1));
    const pad = (value, digits) => String(value).padStart(digits, '0');

    function assetUrl(relativePath) {
        return new URL(`${ROOT}/${relativePath}`, document.baseURI).href;
    }

    function createSequence(relativePaths) {
        return relativePaths.map(relativePath => {
            const image = new Image();
            image.decoding = 'async';
            image.src = assetUrl(relativePath);
            image.addEventListener('error', () => {
                console.warn(`[Environment BG Anims] Failed to load "${relativePath}".`);
            }, { once: true });
            return image;
        });
    }

    const assets = {
        whales: createSequence(Array.from(
            { length: 27 },
            (_, index) => `SkyWhales/SwimLoop/SkyWhales-swimLoop_${pad(index, 2)}.png`
        )),
        butterfliesFlying: createSequence(Array.from(
            { length: 10 },
            (_, index) => `ENV Bugs/Butterfly_png_seq/butterfly-fly_loop_${pad(index, 2)}.png`
        )),
        butterfliesLanded: createSequence(Array.from(
            { length: 10 },
            (_, index) => `ENV Bugs/Butterfly_png_seq/butterfly-idle_landed_${pad(index, 2)}.png`
        )),
        smoke: createSequence(Array.from(
            { length: 8 },
            (_, index) => `Chimney Smoke/Chimney Smoke SEQ/Chimney SmokeSeq__${pad(index + 1, 4)}.png`
        )),
        birds: createSequence(Array.from(
            { length: 9 },
            (_, index) => `birds/Bird Fly Loop SEQ/Bird Fly Loop_${pad(index + 1, 4)}.png`
        )),
        leaves: createSequence(Array.from(
            { length: 4 },
            (_, index) => `Leaves/LEAF${pad(index + 1, 2)}.png`
        ))
    };

    function getFrame(sequence, clock, offset = 0, loop = true) {
        if (!sequence.length) return null;
        const rawIndex = Math.floor(clock / FRAME_DURATION + offset);
        const index = loop
            ? ((rawIndex % sequence.length) + sequence.length) % sequence.length
            : clamp(rawIndex, 0, sequence.length - 1);
        const image = sequence[index];
        return image?.complete && image.naturalWidth > 0 ? image : null;
    }

    function drawImage(ctx, image, x, y, width, height, options = {}) {
        if (!image) return;
        const anchorX = options.anchorX ?? 0.5;
        const anchorY = options.anchorY ?? 0.5;
        ctx.save();
        ctx.globalAlpha = options.opacity ?? 1;
        ctx.translate(x, y);
        if (options.rotation) ctx.rotate(options.rotation);
        ctx.scale(options.flipX ? -1 : 1, 1);
        ctx.drawImage(image, -width * anchorX, -height * anchorY, width, height);
        ctx.restore();
    }

    function createWhale(width, height, initial = false) {
        const direction = Math.random() < 0.5 ? 1 : -1;
        const scale = random(0.48, 0.78);
        const drawWidth = 461 * scale;
        const baseY = random(height * 0.10, height * 0.36);
        return {
            x: initial ? random(0, width) : (direction > 0 ? -drawWidth : width + drawWidth),
            y: baseY,
            baseY,
            direction,
            speed: random(12, 25),
            scale,
            bobPhase: random(0, Math.PI * 2),
            bobSpeed: random(0.25, 0.55),
            bobAmount: random(5, 14),
            frameOffset: randomInt(0, assets.whales.length - 1),
            activeAt: initial ? 0 : random(2, 12)
        };
    }

    function resetWhale(whale, width, height, clock) {
        Object.assign(whale, createWhale(width, height, false));
        whale.activeAt += clock;
    }

    function createBird(width, height, initial = false) {
        const direction = Math.random() < 0.5 ? 1 : -1;
        const scale = random(0.42, 0.78);
        const drawWidth = 103 * scale;
        const baseY = random(height * 0.10, height * 0.56);
        return {
            x: initial ? random(0, width) : (direction > 0 ? -drawWidth : width + drawWidth),
            y: baseY,
            baseY,
            direction,
            speed: random(65, 135),
            scale,
            wavePhase: random(0, Math.PI * 2),
            waveSpeed: random(1.1, 2.2),
            waveAmount: random(3, 11),
            frameOffset: randomInt(0, assets.birds.length - 1),
            activeAt: initial ? random(0, 5) : random(2, 10)
        };
    }

    function resetBird(bird, width, height, clock) {
        Object.assign(bird, createBird(width, height, false));
        bird.activeAt += clock;
    }

    function createSmokeSource(width, clock, index) {
        return {
            x: width * random(0.12, 0.88),
            scale: random(0.17, 0.27),
            opacity: random(0.62, 0.88),
            active: false,
            startedAt: 0,
            nextStart: clock + index * random(0.3, 0.9),
            flipX: Math.random() < 0.5
        };
    }

    function scheduleSmoke(smoke, width, clock) {
        smoke.active = false;
        smoke.nextStart = clock + random(0.5, 2.3);
        smoke.x = clamp(smoke.x + random(-width * 0.12, width * 0.12), width * 0.08, width * 0.92);
        smoke.scale = random(0.17, 0.27);
        smoke.opacity = random(0.62, 0.88);
        smoke.flipX = Math.random() < 0.5;
    }

    function createLeaf(width, clock, windDirection) {
        const sourceIndex = randomInt(0, assets.leaves.length - 1);
        const scale = random(0.85, 1.75);
        return {
            sourceIndex,
            x: random(-30, width + 30),
            y: random(-70, -20),
            vx: windDirection * random(42, 105),
            vy: random(48, 96),
            scale,
            rotation: random(0, Math.PI * 2),
            spin: random(-2.8, 2.8),
            flutterPhase: random(0, Math.PI * 2),
            flutterSpeed: random(3.2, 6.5),
            flutterAmount: random(12, 38),
            bornAt: clock
        };
    }

    function setButterflyTarget(butterfly, width, height, groundTarget = false) {
        butterfly.targetX = random(width * 0.06, width * 0.94);
        butterfly.targetY = groundTarget
            ? height - random(3, 14)
            : random(height * 0.22, height * 0.75);
        butterfly.targetExpires = random(1.8, 4.5);
    }

    function createButterfly(width, height, clock, index) {
        const butterfly = {
            state: 'flying',
            x: random(width * 0.12, width * 0.88),
            y: random(height * 0.25, height * 0.72),
            vx: random(-35, 35),
            vy: random(-22, 22),
            targetX: 0,
            targetY: 0,
            targetExpires: 0,
            speed: random(38, 72),
            scale: random(0.38, 0.64),
            frameOffset: randomInt(0, assets.butterfliesFlying.length - 1),
            landAt: clock + random(5 + index, 14 + index * 2),
            landedUntil: 0,
            facingLeft: false,
            swayPhase: random(0, Math.PI * 2)
        };
        setButterflyTarget(butterfly, width, height, false);
        return butterfly;
    }

    function updateButterfly(butterfly, dt, clock, width, height) {
        if (butterfly.state === 'landed') {
            butterfly.y = height - 5;
            if (clock >= butterfly.landedUntil) {
                butterfly.state = 'flying';
                butterfly.y -= 12;
                butterfly.vy = -random(28, 55);
                butterfly.landAt = clock + random(8, 20);
                setButterflyTarget(butterfly, width, height, false);
            }
            return;
        }

        butterfly.targetExpires -= dt;
        if (butterfly.state === 'flying' && clock >= butterfly.landAt) {
            butterfly.state = 'landing';
            setButterflyTarget(butterfly, width, height, true);
        } else if (butterfly.targetExpires <= 0 && butterfly.state === 'flying') {
            setButterflyTarget(butterfly, width, height, false);
        }

        const dx = butterfly.targetX - butterfly.x;
        const dy = butterfly.targetY - butterfly.y;
        const distance = Math.hypot(dx, dy) || 1;
        const desiredVx = dx / distance * butterfly.speed;
        const desiredVy = dy / distance * butterfly.speed;
        const steering = 1 - Math.pow(0.05, dt);
        butterfly.vx = lerp(butterfly.vx, desiredVx, steering);
        butterfly.vy = lerp(butterfly.vy, desiredVy, steering);
        butterfly.x += butterfly.vx * dt;
        butterfly.y += butterfly.vy * dt;
        butterfly.facingLeft = butterfly.vx < 0;

        if (butterfly.state === 'landing' && distance < 18) {
            butterfly.state = 'landed';
            butterfly.y = height - 5;
            butterfly.vx = 0;
            butterfly.vy = 0;
            butterfly.landedUntil = clock + random(3, 8);
        }

        if (butterfly.x < 12 || butterfly.x > width - 12) {
            butterfly.x = clamp(butterfly.x, 12, width - 12);
            butterfly.vx *= -0.65;
            setButterflyTarget(butterfly, width, height, false);
        }
        butterfly.y = clamp(butterfly.y, height * 0.12, height - 5);
    }

    function createController(board) {
        const canvas = document.createElement('canvas');
        canvas.className = 'environment-bg-anims-layer';
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '1'
        });

        const playerContainer = board.querySelector('#player-container');
        board.insertBefore(canvas, playerContainer || null);

        const ctx = canvas.getContext('2d', { alpha: true });
        let width = 1;
        let height = 1;
        let dpr = 1;
        let enabled = true;
        let disposed = false;
        let animationId = 0;
        let lastTime = performance.now();
        let clock = 0;
        let leafSpawnAccumulator = 0;
        let windDirection = Math.random() < 0.5 ? -1 : 1;
        let windChangesAt = random(10, 22);

        const whales = [];
        const birds = [];
        const smokeSources = [];
        const butterflies = [];
        const leaves = [];

        function resize() {
            width = Math.max(1, board.clientWidth);
            height = Math.max(1, board.clientHeight);
            dpr = Math.min(MAX_DPR, Math.max(1, global.devicePixelRatio || 1));
            const pixelWidth = Math.round(width * dpr);
            const pixelHeight = Math.round(height * dpr);
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                canvas.width = pixelWidth;
                canvas.height = pixelHeight;
            }
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        resize();
        for (let index = 0; index < 2; index += 1) whales.push(createWhale(width, height, true));
        for (let index = 0; index < 5; index += 1) birds.push(createBird(width, height, true));
        for (let index = 0; index < 3; index += 1) smokeSources.push(createSmokeSource(width, clock, index));
        for (let index = 0; index < 5; index += 1) butterflies.push(createButterfly(width, height, clock, index));

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(resize)
            : null;
        resizeObserver?.observe(board);

        function update(dt) {
            if (clock >= windChangesAt) {
                windDirection *= -1;
                windChangesAt = clock + random(10, 22);
            }

            for (const whale of whales) {
                if (clock < whale.activeAt) continue;
                whale.x += whale.direction * whale.speed * dt;
                whale.y = whale.baseY + Math.sin(clock * whale.bobSpeed + whale.bobPhase) * whale.bobAmount;
                const drawWidth = 461 * whale.scale;
                if ((whale.direction > 0 && whale.x > width + drawWidth)
                    || (whale.direction < 0 && whale.x < -drawWidth)) {
                    resetWhale(whale, width, height, clock);
                }
            }

            for (const bird of birds) {
                if (clock < bird.activeAt) continue;
                bird.x += bird.direction * bird.speed * dt;
                bird.y = bird.baseY + Math.sin(clock * bird.waveSpeed + bird.wavePhase) * bird.waveAmount;
                const drawWidth = 103 * bird.scale;
                if ((bird.direction > 0 && bird.x > width + drawWidth)
                    || (bird.direction < 0 && bird.x < -drawWidth)) {
                    resetBird(bird, width, height, clock);
                }
            }

            for (const smoke of smokeSources) {
                if (!smoke.active && clock >= smoke.nextStart) {
                    smoke.active = true;
                    smoke.startedAt = clock;
                } else if (smoke.active && clock - smoke.startedAt >= assets.smoke.length * FRAME_DURATION) {
                    scheduleSmoke(smoke, width, clock);
                }
            }

            leafSpawnAccumulator += dt * 2.8;
            while (leafSpawnAccumulator >= 1 && leaves.length < 36) {
                leaves.push(createLeaf(width, clock, windDirection));
                leafSpawnAccumulator -= 1;
            }
            for (let index = leaves.length - 1; index >= 0; index -= 1) {
                const leaf = leaves[index];
                const age = clock - leaf.bornAt;
                leaf.x += leaf.vx * dt;
                leaf.y += leaf.vy * dt;
                leaf.rotation += leaf.spin * dt;
                leaf.flutterPhase += leaf.flutterSpeed * dt;
                const flutter = Math.sin(leaf.flutterPhase) * leaf.flutterAmount;
                leaf.drawX = leaf.x + flutter;
                leaf.drawRotation = leaf.rotation + Math.sin(leaf.flutterPhase * 0.65) * 0.8;
                if (leaf.y > height + 80 || leaf.drawX < -120 || leaf.drawX > width + 120 || age > 22) {
                    leaves.splice(index, 1);
                }
            }

            for (const butterfly of butterflies) {
                updateButterfly(butterfly, dt, clock, width, height);
            }
        }

        function draw() {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);

            for (const whale of whales) {
                if (clock < whale.activeAt) continue;
                const image = getFrame(assets.whales, clock, whale.frameOffset);
                drawImage(ctx, image, whale.x, whale.y, 461 * whale.scale, 203 * whale.scale, {
                    flipX: whale.direction < 0,
                    opacity: 0.68
                });
            }

            for (const smoke of smokeSources) {
                if (!smoke.active) continue;
                const elapsed = clock - smoke.startedAt;
                const image = getFrame(assets.smoke, elapsed, 0, false);
                drawImage(ctx, image, smoke.x, height + 3, 523 * smoke.scale, 888 * smoke.scale, {
                    anchorY: 1,
                    flipX: smoke.flipX,
                    opacity: smoke.opacity
                });
            }

            for (const bird of birds) {
                if (clock < bird.activeAt) continue;
                const image = getFrame(assets.birds, clock, bird.frameOffset);
                drawImage(ctx, image, bird.x, bird.y, 103 * bird.scale, 146 * bird.scale, {
                    flipX: bird.direction < 0,
                    opacity: 0.9
                });
            }

            for (const butterfly of butterflies) {
                const landed = butterfly.state === 'landed';
                const sequence = landed ? assets.butterfliesLanded : assets.butterfliesFlying;
                const image = getFrame(sequence, clock, butterfly.frameOffset);
                const baseWidth = landed ? 102 : 134;
                const baseHeight = landed ? 80 : 141;
                const sway = landed ? 0 : Math.sin(clock * 2.4 + butterfly.swayPhase) * 0.08;
                drawImage(
                    ctx,
                    image,
                    butterfly.x,
                    butterfly.y,
                    baseWidth * butterfly.scale,
                    baseHeight * butterfly.scale,
                    {
                        anchorY: landed ? 1 : 0.5,
                        rotation: sway,
                        flipX: butterfly.facingLeft,
                        opacity: 0.95
                    }
                );
            }

            for (const leaf of leaves) {
                const image = assets.leaves[leaf.sourceIndex];
                if (!image?.complete || image.naturalWidth <= 0) continue;
                drawImage(
                    ctx,
                    image,
                    leaf.drawX ?? leaf.x,
                    leaf.y,
                    image.naturalWidth * leaf.scale,
                    image.naturalHeight * leaf.scale,
                    {
                        rotation: leaf.drawRotation ?? leaf.rotation,
                        flipX: Math.sin(leaf.flutterPhase) < 0,
                        opacity: 0.94
                    }
                );
            }
        }

        function frame(now) {
            if (disposed) return;
            const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
            lastTime = now;
            if (enabled && !document.hidden) {
                clock += dt;
                update(dt);
                draw();
            }
            animationId = requestAnimationFrame(frame);
        }

        const controls = document.getElementById('ui-controls');
        const toggleButton = document.createElement('button');
        toggleButton.id = 'environment-bg-toggle';
        toggleButton.type = 'button';
        toggleButton.style.marginTop = '6px';

        function syncToggleButton() {
            toggleButton.textContent = `ENV FX: ${enabled ? 'ON' : 'OFF'}`;
            toggleButton.setAttribute('aria-pressed', String(enabled));
            canvas.style.display = enabled ? 'block' : 'none';
        }

        toggleButton.addEventListener('click', () => {
            enabled = !enabled;
            lastTime = performance.now();
            syncToggleButton();
            toggleButton.blur();
        });
        if (controls) {
            const backgroundSelect = document.getElementById('background-select');
            controls.insertBefore(toggleButton, backgroundSelect || null);
        }
        syncToggleButton();

        animationId = requestAnimationFrame(frame);

        return {
            setEnabled(value) {
                enabled = Boolean(value);
                lastTime = performance.now();
                syncToggleButton();
            },
            isEnabled() {
                return enabled;
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                cancelAnimationFrame(animationId);
                resizeObserver?.disconnect();
                toggleButton.remove();
                canvas.remove();
            }
        };
    }

    function init() {
        const board = document.getElementById('game-board');
        if (!board) {
            console.warn('[Environment BG Anims] #game-board was not found.');
            return null;
        }
        return createController(board);
    }

    global.EnvironmentBgAnims = { init, assets };

    const start = () => {
        if (!global.environmentBgAnimsController) {
            global.environmentBgAnimsController = init();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})(window);
