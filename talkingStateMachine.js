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
                this.currentClip = this.findHomewardClip(this.pose);
                return this.currentClip;
            }

            const candidates = this.getOutgoingClips(this.pose)
                .filter(clip => clip.to === this.homePose || this.findHomewardClip(clip.to));
            this.currentClip = this.pickWeighted(candidates);
            return this.currentClip;
        }

        pickWeighted(clips) {
            if (!clips.length) return null;
            const totalWeight = clips.reduce((sum, clip) => sum + clip.weight, 0);
            let cursor = Math.max(0, Math.min(0.999999999, Number(this.random()) || 0)) * totalWeight;
            for (const clip of clips) {
                cursor -= clip.weight;
                if (cursor < 0) return clip;
            }
            return clips[clips.length - 1];
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
                homePose: this.homePose
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
        PoseTransitionStateMachine,
        SpineTalkingController
    });
})(typeof window !== 'undefined' ? window : globalThis);
