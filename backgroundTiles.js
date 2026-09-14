const DEFAULT_TILE_LOAD_CONCURRENCY = 6;
const DEFAULT_TILE_PREFETCH_MARGIN = 1;
const DEFAULT_TILE_CACHE_MAX_ENTRIES = 224;
const DEFAULT_TILE_CACHE_MAX_BYTES = 192 * 1024 * 1024;
const DEFAULT_TILE_ERROR_RETRY_MS = 10_000;
const DEFAULT_TILE_QUEUE_STALE_FRAMES = 2;
const TILE_RANGE_EPSILON = 1e-7;

function assertFinitePositive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return number;
}

function getAttachmentForSlot(psdData, slot) {
    const slotSkin = psdData?.skins?.default?.[slot.name];
    if (!slotSkin || typeof slotSkin !== 'object') return null;
    return slotSkin[slot.attachment] || slotSkin[slot.name] || Object.values(slotSkin)[0] || null;
}

function validateManifest(manifest) {
    if (!manifest || manifest.version !== 1 || manifest.layout !== 'deep-zoom') {
        throw new Error('Unsupported or invalid background tile manifest.');
    }
    const tileSize = assertFinitePositive(manifest.tileSize, 'manifest tile size');
    if (!Number.isInteger(tileSize)) throw new Error(`Background tile size must be an integer: ${tileSize}`);
    const overlap = Number(manifest.overlap ?? 0);
    if (!Number.isInteger(overlap) || overlap < 0 || overlap >= tileSize / 2) {
        throw new Error(`Background tile overlap is invalid: ${manifest.overlap}`);
    }
    if (!Array.isArray(manifest.layers) || !manifest.layers.length) {
        throw new Error('Background tile manifest has no layers.');
    }
    return { tileSize, overlap };
}

function normalizeManifestLayer(manifestLayer, manifestUrl, tileSize, overlap) {
    const sourceWidth = assertFinitePositive(manifestLayer?.source?.width, `${manifestLayer?.id} source width`);
    const sourceHeight = assertFinitePositive(manifestLayer?.source?.height, `${manifestLayer?.id} source height`);
    if (!Array.isArray(manifestLayer.levels) || !manifestLayer.levels.length) {
        throw new Error(`Background tile layer "${manifestLayer.id}" has no mip levels.`);
    }
    const levels = manifestLayer.levels.map((level) => {
        const width = assertFinitePositive(level.width, `${manifestLayer.id} mip width`);
        const height = assertFinitePositive(level.height, `${manifestLayer.id} mip height`);
        const columns = Number(level.columns);
        const rows = Number(level.rows);
        const directoryLevel = Number(level.directoryLevel);
        if (!Number.isInteger(columns) || columns !== Math.ceil(width / tileSize)
            || !Number.isInteger(rows) || rows !== Math.ceil(height / tileSize)) {
            throw new Error(`Background tile grid is invalid for layer "${manifestLayer.id}".`);
        }
        if (!Number.isInteger(directoryLevel) || directoryLevel < 0) {
            throw new Error(`Background tile directory level is invalid for layer "${manifestLayer.id}".`);
        }
        return {
            ...level,
            scale: assertFinitePositive(level.scale, `${manifestLayer.id} mip scale`),
            width,
            height,
            columns,
            rows,
            directoryLevel,
        };
    }).sort((a, b) => b.scale - a.scale);
    const fallbackLevel = levels[levels.length - 1];
    if (fallbackLevel.columns !== 1 || fallbackLevel.rows !== 1) {
        throw new Error(`Background tile layer "${manifestLayer.id}" must end with a one-tile fallback mip.`);
    }
    return {
        id: manifestLayer.id,
        sourceWidth,
        sourceHeight,
        tileSize,
        overlap,
        urlTemplate: manifestLayer.urlTemplate,
        manifestUrl,
        levels,
        fallbackLevel,
    };
}

export async function loadTiledBackgroundScene(sceneDef, options = {}) {
    const sceneScale = assertFinitePositive(options.sceneScale ?? 1, 'background scene scale');
    const signal = options.signal;
    if (!sceneDef?.jsonPath || !sceneDef?.tileManifestPath) {
        throw new Error(`Background scene "${sceneDef?.id || 'unknown'}" is missing JSON or tile manifest paths.`);
    }
    const [psdResponse, manifestResponse] = await Promise.all([
        fetch(sceneDef.jsonPath, { signal }),
        fetch(sceneDef.tileManifestPath, { signal }),
    ]);
    if (!psdResponse.ok) throw new Error(`Failed to load background JSON: ${sceneDef.jsonPath}`);
    if (!manifestResponse.ok) throw new Error(`Failed to load background tile manifest: ${sceneDef.tileManifestPath}`);
    const [psdData, manifest] = await Promise.all([psdResponse.json(), manifestResponse.json()]);
    const { tileSize, overlap } = validateManifest(manifest);
    const manifestUrl = manifestResponse.url || new URL(sceneDef.tileManifestPath, window.location.href).href;
    const manifestLayers = new Map(
        manifest.layers.map(layer => [layer.id, normalizeManifestLayer(layer, manifestUrl, tileSize, overlap)]),
    );
    const slots = Array.isArray(psdData?.slots) ? psdData.slots : [];
    const rawLayers = [];
    for (const slot of slots) {
        const attachment = getAttachmentForSlot(psdData, slot);
        const tiledLayer = manifestLayers.get(slot.name);
        if (!attachment || !tiledLayer) {
            throw new Error(`Background layer "${slot.name}" is missing attachment metadata or generated tiles.`);
        }
        const width = assertFinitePositive(attachment.width, `${slot.name} attachment width`);
        const height = assertFinitePositive(attachment.height, `${slot.name} attachment height`);
        const centerX = Number(attachment.x);
        const centerY = Number(attachment.y);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
            throw new Error(`Background layer "${slot.name}" has invalid placement metadata.`);
        }
        // The layout JSON describes the layer's world-space size, while the tile
        // source may be exported at a higher resolution. The renderer maps the
        // source pixels into these layout dimensions, so the two sizes need not
        // match.
        const parallax = sceneDef.parallaxByLayer?.[slot.name] ?? 1;
        const zIndex = Number(sceneDef.zIndexByLayer?.[slot.name]);
        rawLayers.push({
            ...tiledLayer,
            label: slot.name,
            x: centerX - width / 2,
            y: -centerY - height / 2,
            width,
            height,
            parallaxX: parallax,
            parallaxY: parallax,
            zIndex: Number.isFinite(zIndex) ? Math.round(zIndex) : rawLayers.length * 10,
        });
    }
    if (!rawLayers.length) throw new Error(`Background JSON had no drawable tiled layers: ${sceneDef.jsonPath}`);
    if (rawLayers.length !== manifest.layers.length) {
        throw new Error(
            `Background JSON has ${rawLayers.length} drawable layers, but the tile manifest has ${manifest.layers.length}.`,
        );
    }
    const bounds = rawLayers.reduce((acc, layer) => ({
        minX: Math.min(acc.minX, layer.x),
        minY: Math.min(acc.minY, layer.y),
        maxX: Math.max(acc.maxX, layer.x + layer.width),
        maxY: Math.max(acc.maxY, layer.y + layer.height),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const layers = rawLayers.map(layer => ({
        ...layer,
        x: (layer.x - bounds.minX) * sceneScale,
        y: (layer.y - bounds.minY) * sceneScale,
        width: layer.width * sceneScale,
        height: layer.height * sceneScale,
    }));
    return {
        id: sceneDef.id,
        label: sceneDef.label,
        layers,
        width: Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * sceneScale)),
        height: Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * sceneScale)),
        tileManifestUrl: manifestUrl,
        totalTiles: Number(manifest.totalTiles) || 0,
    };
}

function makeReadyPromise(entry) {
    entry.readyPromise = new Promise(resolve => {
        entry.resolveReady = resolve;
    });
}

function closeBitmap(bitmap) {
    try {
        bitmap?.close?.();
    } catch {
        // Bitmap disposal is best-effort on browsers without ImageBitmap.close().
    }
}

async function decodeTileResponse(response) {
    if (!response.ok) throw new Error(`Tile request failed with HTTP ${response.status}: ${response.url}`);
    const blob = await response.blob();
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.decoding = 'async';
        if (typeof image.decode === 'function') {
            image.src = objectUrl;
            await image.decode();
        } else {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error(`Failed to decode background tile: ${response.url}`));
                image.src = objectUrl;
            });
        }
        return image;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export class BackgroundTileRenderer {
    constructor(options = {}) {
        this.loadConcurrency = options.loadConcurrency ?? DEFAULT_TILE_LOAD_CONCURRENCY;
        this.prefetchMargin = options.prefetchMargin ?? DEFAULT_TILE_PREFETCH_MARGIN;
        this.maxEntries = options.maxEntries ?? DEFAULT_TILE_CACHE_MAX_ENTRIES;
        this.maxBytes = options.maxBytes ?? DEFAULT_TILE_CACHE_MAX_BYTES;
        this.maxLevelScale = Number.isFinite(options.maxLevelScale) ? options.maxLevelScale : Infinity;
        this.errorRetryMs = options.errorRetryMs ?? DEFAULT_TILE_ERROR_RETRY_MS;
        this.queueStaleFrames = options.queueStaleFrames ?? DEFAULT_TILE_QUEUE_STALE_FRAMES;
        this.cache = new Map();
        this.queue = [];
        this.scene = null;
        this.generation = 0;
        this.frame = 0;
        this.activeLoads = 0;
        this.decodedBytes = 0;
        this.abortController = new AbortController();
        this.lastDrawState = { zoom: 1, camera: { x: 0, y: 0 }, layers: [] };
        this.stats = { hits: 0, misses: 0, evictions: 0, errors: 0 };
    }

    clearScene() {
        this.generation += 1;
        this.abortController.abort();
        this.abortController = new AbortController();
        for (const entry of this.cache.values()) {
            closeBitmap(entry.bitmap);
            entry.resolveReady?.(false);
        }
        this.cache.clear();
        this.queue.length = 0;
        this.decodedBytes = 0;
        this.scene = null;
        this.lastDrawState.layers = [];
    }

    dispose() {
        this.clearScene();
    }

    setScene(scene) {
        this.clearScene();
        this.scene = scene;
        const fallbackPromises = [];
        for (const layer of scene?.layers || []) {
            const entry = this.#ensureTile(layer, layer.fallbackLevel, 0, 0, {
                pinned: true,
                priority: -100_000,
                wanted: true,
            });
            fallbackPromises.push(entry.readyPromise);
        }
        this.#pumpQueue();
        return Promise.all(fallbackPromises).then(results => results.every(Boolean));
    }

    #tileKey(layer, level, column, row) {
        return `${layer.id}|${level.directoryLevel}|${column}|${row}`;
    }

    #tileUrl(layer, level, column, row) {
        const relativeUrl = layer.urlTemplate
            .replace('{level}', String(level.directoryLevel))
            .replace('{column}', String(column))
            .replace('{row}', String(row));
        return new URL(relativeUrl, layer.manifestUrl).href;
    }

    #estimateTileBytes(layer, level, column, row) {
        const nominalWidth = Math.max(0, Math.min(layer.tileSize, level.width - column * layer.tileSize));
        const nominalHeight = Math.max(0, Math.min(layer.tileSize, level.height - row * layer.tileSize));
        const width = nominalWidth
            + (column > 0 ? layer.overlap : 0)
            + (column < level.columns - 1 ? layer.overlap : 0);
        const height = nominalHeight
            + (row > 0 ? layer.overlap : 0)
            + (row < level.rows - 1 ? layer.overlap : 0);
        return width * height * 4;
    }

    #ensureTile(layer, level, column, row, options = {}) {
        const key = this.#tileKey(layer, level, column, row);
        let entry = this.cache.get(key);
        const now = performance.now();
        if (entry?.state === 'error' && now >= entry.retryAt) {
            entry.state = 'queued';
            entry.error = null;
            entry.priority = options.priority ?? entry.priority;
            makeReadyPromise(entry);
            this.queue.push(entry);
        }
        if (!entry) {
            entry = {
                key,
                url: this.#tileUrl(layer, level, column, row),
                layerId: layer.id,
                level: level.directoryLevel,
                column,
                row,
                state: 'queued',
                bitmap: null,
                bytes: 0,
                generation: this.generation,
                priority: options.priority ?? 0,
                pinned: options.pinned === true,
                lastWantedFrame: this.frame,
                lastUsedFrame: -1,
                retryAt: 0,
                error: null,
                estimatedBytes: this.#estimateTileBytes(layer, level, column, row),
            };
            makeReadyPromise(entry);
            this.cache.set(key, entry);
            this.queue.push(entry);
            this.stats.misses += 1;
        } else {
            this.stats.hits += 1;
            entry.priority = Math.min(entry.priority, options.priority ?? entry.priority);
            if (options.pinned) entry.pinned = true;
        }
        if (options.wanted !== false) entry.lastWantedFrame = this.frame;
        return entry;
    }

    #pumpQueue() {
        if (!this.scene) return;
        const queuedKeys = new Set();
        this.queue = this.queue.filter(entry => {
            if (this.cache.get(entry.key) !== entry || entry.state !== 'queued' || entry.generation !== this.generation) {
                return false;
            }
            if (!entry.pinned && this.frame - entry.lastWantedFrame > this.queueStaleFrames) {
                this.cache.delete(entry.key);
                entry.resolveReady?.(false);
                return false;
            }
            if (queuedKeys.has(entry.key)) return false;
            queuedKeys.add(entry.key);
            return true;
        });
        this.queue.sort((a, b) => a.priority - b.priority || b.lastWantedFrame - a.lastWantedFrame);
        while (this.activeLoads < this.loadConcurrency && this.queue.length) {
            const entry = this.queue.shift();
            this.#startLoad(entry);
        }
    }

    async #startLoad(entry) {
        entry.state = 'loading';
        const loadGeneration = entry.generation;
        this.activeLoads += 1;
        try {
            const response = await fetch(entry.url, { signal: this.abortController.signal });
            const bitmap = await decodeTileResponse(response);
            if (loadGeneration !== this.generation || this.cache.get(entry.key) !== entry) {
                closeBitmap(bitmap);
                entry.resolveReady?.(false);
                return;
            }
            entry.bitmap = bitmap;
            entry.bytes = Math.max(0, (bitmap.width || 0) * (bitmap.height || 0) * 4);
            entry.state = 'ready';
            entry.error = null;
            this.decodedBytes += entry.bytes;
            entry.resolveReady?.(true);
        } catch (error) {
            if (error?.name === 'AbortError' || loadGeneration !== this.generation) {
                entry.resolveReady?.(false);
            } else if (this.cache.get(entry.key) === entry) {
                entry.state = 'error';
                entry.error = error?.message || String(error);
                entry.retryAt = performance.now() + this.errorRetryMs;
                this.stats.errors += 1;
                entry.resolveReady?.(false);
                console.warn('Background tile failed to load.', { url: entry.url, error });
            }
        } finally {
            this.activeLoads = Math.max(0, this.activeLoads - 1);
            this.#pumpQueue();
        }
    }

    #selectLevel(layer, zoom) {
        const displayScaleX = (layer.width * zoom) / layer.sourceWidth;
        const displayScaleY = (layer.height * zoom) / layer.sourceHeight;
        const displayScale = Math.max(displayScaleX, displayScaleY);
        const eligibleLevels = layer.levels.filter(level => level.scale <= this.maxLevelScale);
        const levels = eligibleLevels.length ? eligibleLevels : [layer.fallbackLevel];
        let chosen = levels[0];
        for (const level of levels) {
            if (displayScale / level.scale >= 0.5) {
                chosen = level;
                break;
            }
        }
        return chosen;
    }

    #getLayerScreenRect(layer, camera, zoom) {
        const parallaxX = Number.isFinite(layer.parallaxX) ? layer.parallaxX : 1;
        const parallaxY = Number.isFinite(layer.parallaxY) ? layer.parallaxY : parallaxX;
        return {
            x: (layer.x - camera.x * parallaxX) * zoom,
            y: (layer.y - camera.y * parallaxY) * zoom,
            width: layer.width * zoom,
            height: layer.height * zoom,
        };
    }

    #getVisibleTiles(layer, level, screenRect, viewport, margin = 0) {
        if (screenRect.width <= 0 || screenRect.height <= 0) return [];
        const visibleLeft = Math.max(0, screenRect.x);
        const visibleTop = Math.max(0, screenRect.y);
        const visibleRight = Math.min(viewport.width, screenRect.x + screenRect.width);
        const visibleBottom = Math.min(viewport.height, screenRect.y + screenRect.height);
        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return [];

        const mipLeft = Math.max(0, ((visibleLeft - screenRect.x) / screenRect.width) * level.width);
        const mipTop = Math.max(0, ((visibleTop - screenRect.y) / screenRect.height) * level.height);
        const mipRight = Math.min(level.width, ((visibleRight - screenRect.x) / screenRect.width) * level.width);
        const mipBottom = Math.min(level.height, ((visibleBottom - screenRect.y) / screenRect.height) * level.height);
        const coreColumnStart = Math.max(0, Math.floor(mipLeft / layer.tileSize));
        const coreRowStart = Math.max(0, Math.floor(mipTop / layer.tileSize));
        const coreColumnEnd = Math.min(level.columns - 1, Math.floor((mipRight - TILE_RANGE_EPSILON) / layer.tileSize));
        const coreRowEnd = Math.min(level.rows - 1, Math.floor((mipBottom - TILE_RANGE_EPSILON) / layer.tileSize));
        const columnStart = Math.max(0, coreColumnStart - margin);
        const rowStart = Math.max(0, coreRowStart - margin);
        const columnEnd = Math.min(level.columns - 1, coreColumnEnd + margin);
        const rowEnd = Math.min(level.rows - 1, coreRowEnd + margin);
        const centerColumn = (coreColumnStart + coreColumnEnd) * 0.5;
        const centerRow = (coreRowStart + coreRowEnd) * 0.5;
        const tiles = [];
        for (let row = rowStart; row <= rowEnd; row += 1) {
            for (let column = columnStart; column <= columnEnd; column += 1) {
                const core = column >= coreColumnStart && column <= coreColumnEnd
                    && row >= coreRowStart && row <= coreRowEnd;
                tiles.push({
                    column,
                    row,
                    core,
                    priority: (core ? 0 : 10_000) + Math.hypot(column - centerColumn, row - centerRow),
                });
            }
        }
        return tiles;
    }

    #findBestReadyLevel(layer, targetLevel, screenRect, viewport) {
        const candidates = [...layer.levels].sort((a, b) => {
            const aDistance = Math.abs(Math.log2(a.scale / targetLevel.scale));
            const bDistance = Math.abs(Math.log2(b.scale / targetLevel.scale));
            return aDistance - bDistance;
        });
        for (const level of candidates) {
            const tiles = this.#getVisibleTiles(layer, level, screenRect, viewport, 0);
            if (tiles.length && tiles.every(tile => this.cache.get(this.#tileKey(layer, level, tile.column, tile.row))?.state === 'ready')) {
                return { level, tiles };
            }
        }
        return null;
    }

    #drawTile(context, layer, level, tile, entry, screenRect, viewport) {
        if (!entry?.bitmap || entry.state !== 'ready') return false;
        const sourceLeft = tile.column * layer.tileSize;
        const sourceTop = tile.row * layer.tileSize;
        const sourceRight = Math.min(level.width, sourceLeft + layer.tileSize);
        const sourceBottom = Math.min(level.height, sourceTop + layer.tileSize);
        const overlapLeft = tile.column > 0 ? layer.overlap : 0;
        const overlapTop = tile.row > 0 ? layer.overlap : 0;
        const overlapRight = tile.column < level.columns - 1 ? layer.overlap : 0;
        const overlapBottom = tile.row < level.rows - 1 ? layer.overlap : 0;
        const rawLeft = screenRect.x + (sourceLeft / level.width) * screenRect.width;
        const rawTop = screenRect.y + (sourceTop / level.height) * screenRect.height;
        const rawRight = screenRect.x + (sourceRight / level.width) * screenRect.width;
        const rawBottom = screenRect.y + (sourceBottom / level.height) * screenRect.height;
        const drawLeft = Math.max(0, Math.round(rawLeft));
        const drawTop = Math.max(0, Math.round(rawTop));
        const drawRight = Math.min(viewport.width, Math.round(rawRight));
        const drawBottom = Math.min(viewport.height, Math.round(rawBottom));
        if (drawRight <= drawLeft || drawBottom <= drawTop || rawRight <= rawLeft || rawBottom <= rawTop) return false;
        const imageSourceLeft = sourceLeft - overlapLeft;
        const imageSourceTop = sourceTop - overlapTop;
        const imageSourceRight = sourceRight + overlapRight;
        const imageSourceBottom = sourceBottom + overlapBottom;
        const imageLeft = screenRect.x + (imageSourceLeft / level.width) * screenRect.width;
        const imageTop = screenRect.y + (imageSourceTop / level.height) * screenRect.height;
        const imageRight = screenRect.x + (imageSourceRight / level.width) * screenRect.width;
        const imageBottom = screenRect.y + (imageSourceBottom / level.height) * screenRect.height;
        const bitmapWidth = entry.bitmap.width || imageSourceRight - imageSourceLeft;
        const bitmapHeight = entry.bitmap.height || imageSourceBottom - imageSourceTop;
        if (bitmapWidth <= 0 || bitmapHeight <= 0 || imageRight <= imageLeft || imageBottom <= imageTop) return false;

        // Clip each tile to its shared, pixel-aligned nominal rectangle, but draw
        // from the overlapping bitmap. The image therefore continues through the
        // clip edge, avoiding transparent antialias seams between adjacent tiles.
        context.save();
        try {
            context.beginPath();
            context.rect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop);
            context.clip();
            context.drawImage(
                entry.bitmap,
                0,
                0,
                bitmapWidth,
                bitmapHeight,
                imageLeft,
                imageTop,
                imageRight - imageLeft,
                imageBottom - imageTop,
            );
        } finally {
            context.restore();
        }
        entry.lastUsedFrame = this.frame;
        return true;
    }

    #evict(protectedKeys, desiredPrefetchKeys = new Set()) {
        for (const [key, entry] of this.cache) {
            if (entry.state === 'queued' && !entry.pinned && !protectedKeys.has(key)
                && this.frame - entry.lastWantedFrame > this.queueStaleFrames) {
                this.cache.delete(key);
                entry.resolveReady?.(false);
            }
            if (entry.state === 'error' && !entry.pinned && !protectedKeys.has(key)
                && !desiredPrefetchKeys.has(key)) {
                this.cache.delete(key);
            }
        }
        if (this.cache.size <= this.maxEntries && this.decodedBytes <= this.maxBytes) return;
        const candidates = [...this.cache.values()]
            .filter(entry => (entry.state === 'ready' || entry.state === 'error')
                && !entry.pinned && !protectedKeys.has(entry.key))
            .sort((a, b) => {
                const desiredDifference = Number(desiredPrefetchKeys.has(a.key)) - Number(desiredPrefetchKeys.has(b.key));
                return desiredDifference || a.lastUsedFrame - b.lastUsedFrame || a.lastWantedFrame - b.lastWantedFrame;
            });
        for (const entry of candidates) {
            if (this.cache.size <= this.maxEntries && this.decodedBytes <= this.maxBytes) break;
            this.cache.delete(entry.key);
            if (entry.state === 'ready') {
                this.decodedBytes = Math.max(0, this.decodedBytes - entry.bytes);
                closeBitmap(entry.bitmap);
                entry.bitmap = null;
            }
            entry.state = 'evicted';
            this.stats.evictions += 1;
        }
    }

    draw(context, view) {
        if (!this.scene || !context) return;
        const resolveContext = typeof context === 'function' ? context : () => context;
        const viewport = {
            width: Math.max(1, Number(view.width) || 1),
            height: Math.max(1, Number(view.height) || 1),
        };
        const camera = view.camera || { x: 0, y: 0 };
        const zoom = Math.max(0.0001, Number(view.zoom) || 1);
        this.frame += 1;
        const protectedKeys = new Set();
        const desiredPrefetchKeys = new Set();
        const layerDebug = [];
        const layerStates = [];

        // Reserve every visible/core tile before considering speculative prefetch work.
        // This prevents an early layer's prefetch ring from starving later layers.
        for (const layer of this.scene.layers) {
            const screenRect = this.#getLayerScreenRect(layer, camera, zoom);
            const targetLevel = this.#selectLevel(layer, zoom);
            const targetCoreTiles = this.#getVisibleTiles(layer, targetLevel, screenRect, viewport, 0);
            const visibleTileKeys = [];
            const loadingTileKeys = [];
            for (const tile of targetCoreTiles) {
                const entry = this.#ensureTile(layer, targetLevel, tile.column, tile.row, {
                    priority: tile.priority,
                    wanted: true,
                });
                visibleTileKeys.push(entry.key);
                protectedKeys.add(entry.key);
                if (entry.state !== 'ready') loadingTileKeys.push(entry.key);
            }

            const fallbackEntry = this.#ensureTile(layer, layer.fallbackLevel, 0, 0, {
                pinned: true,
                priority: -100_000,
                wanted: true,
            });
            protectedKeys.add(fallbackEntry.key);

            const prefetchTiles = this.prefetchMargin > 0
                ? this.#getVisibleTiles(layer, targetLevel, screenRect, viewport, this.prefetchMargin)
                    .filter(tile => !tile.core)
                : [];
            for (const tile of prefetchTiles) {
                const key = this.#tileKey(layer, targetLevel, tile.column, tile.row);
                desiredPrefetchKeys.add(key);
                if (this.cache.has(key)) {
                    this.#ensureTile(layer, targetLevel, tile.column, tile.row, {
                        priority: tile.priority,
                        wanted: true,
                    });
                }
            }
            layerStates.push({
                layer,
                screenRect,
                targetLevel,
                targetCoreTiles,
                prefetchTiles,
                visibleTileKeys,
                loadingTileKeys,
            });
        }

        for (const state of layerStates) {
            const layerContext = resolveContext(state.layer);
            if (!layerContext) continue;
            const previousSmoothingEnabled = layerContext.imageSmoothingEnabled;
            const previousSmoothingQuality = layerContext.imageSmoothingQuality;
            layerContext.imageSmoothingEnabled = true;
            layerContext.imageSmoothingQuality = 'low';
            try {
                const {
                    layer,
                    screenRect,
                    targetLevel,
                    targetCoreTiles,
                    visibleTileKeys,
                    loadingTileKeys,
                } = state;
                const readySelection = targetCoreTiles.length
                    ? this.#findBestReadyLevel(layer, targetLevel, screenRect, viewport)
                    : null;
                const displayedLevel = readySelection?.level || null;
                const displayedTiles = readySelection?.tiles || [];
                const drawnTileKeys = [];
                for (const tile of displayedTiles) {
                    const entry = this.#ensureTile(layer, displayedLevel, tile.column, tile.row, {
                        priority: tile.priority,
                        wanted: true,
                    });
                    protectedKeys.add(entry.key);
                    if (this.#drawTile(layerContext, layer, displayedLevel, tile, entry, screenRect, viewport)) {
                        drawnTileKeys.push(entry.key);
                    }
                }
                layerDebug.push({
                    id: layer.id,
                    zIndex: layer.zIndex,
                    selectedLevel: targetLevel.scale,
                    selectedDirectoryLevel: targetLevel.directoryLevel,
                    displayedLevel: displayedLevel?.scale ?? null,
                    displayedDirectoryLevel: displayedLevel?.directoryLevel ?? null,
                    visibleTileKeys,
                    drawnTileKeys,
                    loadingTileKeys,
                });
            } finally {
                layerContext.imageSmoothingEnabled = previousSmoothingEnabled;
                layerContext.imageSmoothingQuality = previousSmoothingQuality;
            }
        }

        this.lastDrawState = {
            zoom,
            camera: { x: Number(camera.x) || 0, y: Number(camera.y) || 0 },
            layers: layerDebug,
        };
        this.#evict(protectedKeys, desiredPrefetchKeys);

        let projectedEntries = this.cache.size;
        let projectedBytes = 0;
        for (const entry of this.cache.values()) {
            if (entry.state === 'ready') projectedBytes += entry.bytes;
            else if (entry.state === 'queued' || entry.state === 'loading') projectedBytes += entry.estimatedBytes || 0;
        }
        const missingPrefetchTiles = layerStates.flatMap(state => state.prefetchTiles
            .filter(tile => !this.cache.has(this.#tileKey(state.layer, state.targetLevel, tile.column, tile.row)))
            .map(tile => ({ ...state, tile }))
        ).sort((a, b) => a.tile.priority - b.tile.priority);
        for (const { layer, targetLevel, tile } of missingPrefetchTiles) {
            const estimatedBytes = this.#estimateTileBytes(layer, targetLevel, tile.column, tile.row);
            if (projectedEntries + 1 > this.maxEntries || projectedBytes + estimatedBytes > this.maxBytes) continue;
            this.#ensureTile(layer, targetLevel, tile.column, tile.row, {
                priority: tile.priority,
                wanted: true,
            });
            projectedEntries += 1;
            projectedBytes += estimatedBytes;
        }
        this.#pumpQueue();
    }

    getSnapshot() {
        const stateCounts = { queued: 0, loading: 0, ready: 0, error: 0 };
        for (const entry of this.cache.values()) {
            if (Object.prototype.hasOwnProperty.call(stateCounts, entry.state)) stateCounts[entry.state] += 1;
        }
        const fallbackReady = !!this.scene && this.scene.layers.every(layer => (
            this.cache.get(this.#tileKey(layer, layer.fallbackLevel, 0, 0))?.state === 'ready'
        ));
        return {
            ready: fallbackReady,
            sceneId: this.scene?.id || null,
            zoom: this.lastDrawState.zoom,
            camera: { ...this.lastDrawState.camera },
            cache: {
                entries: this.cache.size,
                decodedBytes: this.decodedBytes,
                maxEntries: this.maxEntries,
                maxBytes: this.maxBytes,
                maxLevelScale: this.maxLevelScale,
                queued: stateCounts.queued,
                loading: stateCounts.loading,
                ready: stateCounts.ready,
                errors: stateCounts.error,
                activeLoads: this.activeLoads,
                hits: this.stats.hits,
                misses: this.stats.misses,
                evictions: this.stats.evictions,
                errorCount: this.stats.errors,
            },
            layers: this.lastDrawState.layers.map(layer => ({
                ...layer,
                visibleTileKeys: [...layer.visibleTileKeys],
                drawnTileKeys: [...layer.drawnTileKeys],
                loadingTileKeys: [...layer.loadingTileKeys],
            })),
        };
    }
}
