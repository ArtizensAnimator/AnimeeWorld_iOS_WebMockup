(function (global) {
    'use strict';

    function normalizeClip(clip) {
        if (!clip || typeof clip.animation !== 'string') return null;
        const animation = clip.animation.trim();
        const from = String(clip.from || '').trim();
        const to = String(clip.to || '').trim();
        const weight = Number(clip.weight);
        if (!animation || !from || !to) return null;
        return {
            animation,
            from,
            to,
            weight: Number.isFinite(weight) && weight > 0 ? weight : 1
        };
    }

    function discoverPoseTransitionClips(animationNames, options = {}) {
        const homePose = String(options.homePose || 'H');
        const pattern = options.pattern instanceof RegExp
            ? options.pattern
            : /(?:^|\/)talk_([A-Za-z0-9]+)_([A-Za-z0-9]+)_([0-9]+)$/;
        const categoryWeights = Object.assign({
            homeSelf: 3,
            homeExit: 7,
            self: 2,
            homeReturn: 2,
            explore: 8
        }, options.categoryWeights || {});
        const discovered = [];

        (Array.isArray(animationNames) ? animationNames : []).forEach(animationName => {
            if (typeof animationName !== 'string') return;
            pattern.lastIndex = 0;
            const match = pattern.exec(animationName);
            if (!match) return;
            discovered.push({
                animation: animationName,
                from: match[1],
                to: match[2],
                iteration: Number(match[3]) || 0
            });
        });

        const outgoingEdges = new Map();
        discovered.forEach(clip => {
            const edgeKey = `${clip.from}>${clip.to}`;
            if (!outgoingEdges.has(clip.from)) outgoingEdges.set(clip.from, new Map());
            const edges = outgoingEdges.get(clip.from);
            if (!edges.has(edgeKey)) edges.set(edgeKey, []);
            edges.get(edgeKey).push(clip);
        });

        const weightedClips = [];
        outgoingEdges.forEach((edges, from) => {
            const edgeGroups = [...edges.values()];
            const categories = new Map();
            edgeGroups.forEach(group => {
                const to = group[0].to;
                let category;
                if (from === homePose) category = to === homePose ? 'homeSelf' : 'homeExit';
                else if (to === from) category = 'self';
                else if (to === homePose) category = 'homeReturn';
                else category = 'explore';
                if (!categories.has(category)) categories.set(category, []);
                categories.get(category).push(group);
            });

            categories.forEach((groups, category) => {
                const categoryWeight = Math.max(0.001, Number(categoryWeights[category]) || 1);
                const edgeWeight = categoryWeight / groups.length;
                groups.forEach(group => {
                    group.sort((a, b) => a.iteration - b.iteration || a.animation.localeCompare(b.animation));
                    const variantWeight = edgeWeight / group.length;
                    group.forEach(clip => weightedClips.push(Object.freeze({
                        animation: clip.animation,
                        from: clip.from,
                        to: clip.to,
                        weight: variantWeight
                    })));
                });
            });
        });

        return weightedClips;
    }

    class PoseTransitionStateMachine {
        constructor(options = {}) {
            this.homePose = String(options.homePose || 'H');
            this.random = typeof options.random === 'function' ? options.random : Math.random;
            this.clips = (Array.isArray(options.clips) ? options.clips : [])
                .map(normalizeClip)
                .filter(Boolean);
            this.availableAnimations = null;
            this.pose = this.homePose;
            this.active = false;
            this.currentClip = null;
            this.recentLimit = Math.max(1, Number(options.recentLimit) || 4);
            this.edgeRepeatPenalty = Math.max(0.01, Number(options.edgeRepeatPenalty) || 0.15);
            this.variantRepeatPenalty = Math.max(0.01, Number(options.variantRepeatPenalty) || 0.08);
            this.recentAnimations = [];
            this.recentEdges = [];
            this.selectionCounts = new Map();
        }

        setAvailableAnimations(animationNames) {
            this.availableAnimations = new Set(Array.isArray(animationNames) ? animationNames : []);
            if (this.currentClip && !this.isClipAvailable(this.currentClip)) {
                this.currentClip = null;
            }
            return this;
        }

        isClipAvailable(clip) {
            return !this.availableAnimations || this.availableAnimations.has(clip.animation);
        }

        getAvailableClips() {
            return this.clips.filter(clip => this.isClipAvailable(clip));
        }

        getOutgoingClips(pose = this.pose) {
            return this.getAvailableClips().filter(clip => clip.from === pose);
        }

        hasPlayableGraph() {
            const outgoingHomeClips = this.getOutgoingClips(this.homePose);
            return outgoingHomeClips.length > 0
                && outgoingHomeClips.every(clip => clip.to === this.homePose || this.findHomewardClip(clip.to));
        }

        start() {
            this.active = true;
            return this.currentClip || this.chooseNextClip();
        }

        stop() {
            this.active = false;
            return this.currentClip || this.chooseNextClip();
        }

        complete(animationName) {
            if (!this.currentClip || this.currentClip.animation !== animationName) return null;
            this.pose = this.currentClip.to;
            this.currentClip = null;
            return this.chooseNextClip();
        }

        interrupt(options = {}) {
            this.currentClip = null;
            this.pose = String(options.pose || this.homePose);
            if (options.active !== undefined) this.active = Boolean(options.active);
        }

        chooseNextClip() {
            if (this.currentClip) return this.currentClip;
            if (!this.active) {
                if (this.pose === this.homePose) return null;
                const homewardClip = this.findHomewardClip(this.pose);
                if (!homewardClip) return null;
                const variants = this.getOutgoingClips(this.pose).filter(
                    clip => clip.to === homewardClip.to
                );
                this.currentClip = this.pickVariant(variants);
                return this.currentClip;
            }

            const candidates = this.getOutgoingClips(this.pose)
                .filter(clip => clip.to === this.homePose || this.findHomewardClip(clip.to));
            this.currentClip = this.pickWeighted(candidates);
            return this.currentClip;
        }

        pickWeighted(clips) {
            if (!clips.length) return null;
            const edgeGroups = new Map();
            clips.forEach(clip => {
                const edgeKey = this.getEdgeKey(clip);
                if (!edgeGroups.has(edgeKey)) edgeGroups.set(edgeKey, []);
                edgeGroups.get(edgeKey).push(clip);
            });
            const lastEdge = this.recentEdges[this.recentEdges.length - 1] || '';
            const weightedEdges = [...edgeGroups.entries()].map(([edgeKey, variants]) => ({
                edgeKey,
                variants,
                weight: variants.reduce((sum, clip) => sum + clip.weight, 0)
                    * (edgeKey === lastEdge ? this.edgeRepeatPenalty : 1)
            }));
            const selectedEdge = this.pickByWeight(weightedEdges);
            return selectedEdge ? this.pickVariant(selectedEdge.variants) : null;
        }

        pickVariant(clips) {
            if (!clips.length) return null;
            const weightedVariants = clips.map(clip => {
                const selectionCount = this.selectionCounts.get(clip.animation) || 0;
                const recentlyUsed = this.recentAnimations.includes(clip.animation);
                return {
                    clip,
                    weight: (1 / (selectionCount + 1))
                        * (recentlyUsed ? this.variantRepeatPenalty : 1)
                };
            });
            const selectedVariant = this.pickByWeight(weightedVariants);
            const selectedClip = selectedVariant?.clip || null;
            if (selectedClip) this.recordSelection(selectedClip);
            return selectedClip;
        }

        pickByWeight(items) {
            if (!items.length) return null;
            const totalWeight = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
            let cursor = Math.max(0, Math.min(0.999999999, Number(this.random()) || 0)) * totalWeight;
            for (const item of items) {
                cursor -= Math.max(0, item.weight);
                if (cursor < 0) return item;
            }
            return items[items.length - 1];
        }

        getEdgeKey(clip) {
            return `${clip.from}>${clip.to}`;
        }

        recordSelection(clip) {
            const edgeKey = this.getEdgeKey(clip);
            this.selectionCounts.set(
                clip.animation,
                (this.selectionCounts.get(clip.animation) || 0) + 1
            );
            this.recentAnimations.push(clip.animation);
            this.recentEdges.push(edgeKey);
            if (this.recentAnimations.length > this.recentLimit) this.recentAnimations.shift();
            if (this.recentEdges.length > this.recentLimit) this.recentEdges.shift();
        }

        findHomewardClip(startPose) {
            if (startPose === this.homePose) return null;
            const clips = this.getAvailableClips().filter(clip => clip.from !== clip.to);
            const queue = [{ pose: startPose, firstClip: null }];
            const visited = new Set([startPose]);

            while (queue.length) {
                const node = queue.shift();
                for (const clip of clips) {
                    if (clip.from !== node.pose) continue;
                    const firstClip = node.firstClip || clip;
                    if (clip.to === this.homePose) return firstClip;
                    if (visited.has(clip.to)) continue;
                    visited.add(clip.to);
                    queue.push({ pose: clip.to, firstClip });
                }
            }
            return null;
        }

        snapshot() {
            return {
                active: this.active,
                pose: this.pose,
                currentAnimation: this.currentClip?.animation || '',
                homePose: this.homePose,
                discoveredClipCount: this.clips.length
            };
        }
    }

    class SpineTalkingController {
        constructor(options = {}) {
            this.machine = options.machine;
            this.animationState = options.animationState;
            this.trackIndex = Number.isFinite(options.trackIndex) ? options.trackIndex : 0;
            this.mixDuration = Number.isFinite(options.mixDuration) ? Math.max(0, options.mixDuration) : 0;
            this.setAnimation = typeof options.setAnimation === 'function'
                ? options.setAnimation
                : (animationName => this.animationState?.setAnimation?.(this.trackIndex, animationName, false));
            this.clearTrack = typeof options.clearTrack === 'function'
                ? options.clearTrack
                : (() => this.animationState?.clearTrack?.(this.trackIndex));
            this.onClipStart = typeof options.onClipStart === 'function' ? options.onClipStart : null;
            this.onStop = typeof options.onStop === 'function' ? options.onStop : null;
            this.currentEntry = null;
            this.destroyed = false;
        }

        isActive() {
            return Boolean(this.machine?.active);
        }

        isPlaying() {
            return Boolean(this.currentEntry);
        }

        start() {
            if (this.destroyed || !this.machine) return null;
            const clip = this.machine.start();
            if (!this.currentEntry && clip) this.playClip(clip);
            return this.currentEntry;
        }

        stop(options = {}) {
            if (this.destroyed || !this.machine) return;
            if (options.immediate) {
                this.machine.interrupt({ active: false });
                this.finish();
                return;
            }
            const clip = this.machine.stop();
            if (!this.currentEntry) {
                if (clip) this.playClip(clip);
                else this.finish();
            }
        }

        update() {
            if (this.destroyed || !this.currentEntry || !this.animationState?.getCurrent) return;
            if (this.animationState.getCurrent(this.trackIndex) === this.currentEntry) return;

            const shouldRestart = this.machine.active;
            this.currentEntry = null;
            this.machine.interrupt({ active: shouldRestart });
            const nextClip = this.machine.chooseNextClip();
            if (nextClip) this.playClip(nextClip);
            else this.finish();
        }

        playClip(clip) {
            if (this.destroyed || !clip) return null;
            const entry = this.setAnimation(clip.animation);
            if (!entry) {
                this.machine.interrupt({ active: false });
                this.finish();
                return null;
            }

            this.currentEntry = entry;
            entry.loop = false;
            entry.mixDuration = this.mixDuration;
            entry.mixTime = 0;
            entry.alpha = 1;

            const previousListener = entry.listener || {};
            entry.listener = Object.assign({}, previousListener, {
                complete: trackEntry => {
                    if (typeof previousListener.complete === 'function') {
                        previousListener.complete(trackEntry);
                    }
                    if (this.destroyed || trackEntry !== entry || this.currentEntry !== entry) return;
                    this.currentEntry = null;
                    const nextClip = this.machine.complete(clip.animation);
                    if (nextClip) this.playClip(nextClip);
                    else this.finish();
                }
            });

            this.onClipStart?.(clip, entry, this.machine.snapshot());
            return entry;
        }

        finish() {
            const hadEntry = Boolean(this.currentEntry);
            this.currentEntry = null;
            if (hadEntry || this.animationState?.getCurrent?.(this.trackIndex)) this.clearTrack();
            this.onStop?.(this.machine?.snapshot?.() || null);
        }

        destroy() {
            if (this.destroyed) return;
            this.stop({ immediate: true });
            this.destroyed = true;
        }
    }

    global.WeightedTalking = Object.freeze({
        discoverPoseTransitionClips,
        PoseTransitionStateMachine,
        SpineTalkingController
    });
})(typeof window !== 'undefined' ? window : globalThis);
