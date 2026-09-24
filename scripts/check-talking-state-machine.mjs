import '../talkingStateMachine.js';

const {
    discoverPoseTransitionClips,
    PoseTransitionStateMachine,
    SpineTalkingController
} = globalThis.WeightedTalking;

const clips = [
    { animation: 'H_H', from: 'H', to: 'H', weight: 8 },
    { animation: 'H_A', from: 'H', to: 'A', weight: 2 },
    { animation: 'A_H', from: 'A', to: 'H', weight: 5 },
    { animation: 'A_B', from: 'A', to: 'B', weight: 1 },
    { animation: 'B_C', from: 'B', to: 'C', weight: 1 },
    { animation: 'C_A', from: 'C', to: 'A', weight: 4 },
    { animation: 'C_D', from: 'C', to: 'D', weight: 1 },
    { animation: 'D_E', from: 'D', to: 'E', weight: 1 },
    { animation: 'E_F', from: 'E', to: 'F', weight: 1 },
    { animation: 'F_G', from: 'F', to: 'G', weight: 1 },
    { animation: 'G_A', from: 'G', to: 'A', weight: 1 }
];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const discoveredClips = discoverPoseTransitionClips([
    'GameAnims/Talking/talk_H_H_01',
    'GameAnims/Talking/talk_H_H_02',
    'GameAnims/Talking/talk_H_A_01',
    'GameAnims/Talking/talk_H_A_02',
    'GameAnims/Talking/talk_A_H_01',
    'GameAnims/Talking/talk_A_B_01',
    'GameAnims/Talking/talk_B_C_01',
    'GameAnims/not-a-transition'
]);
assert(discoveredClips.length === 7, 'Every correctly named transition iteration should be discovered.');
const sumEdgeWeight = (from, to) => discoveredClips
    .filter(clip => clip.from === from && clip.to === to)
    .reduce((sum, clip) => sum + clip.weight, 0);
assert(sumEdgeWeight('H', 'H') === 3, 'H_H variants should share the 30% home weight.');
assert(sumEdgeWeight('H', 'A') === 7, 'H_A variants should share the 70% home-exit weight.');
assert(discoveredClips.find(clip => clip.animation.endsWith('talk_H_A_02')), 'New iterations should require no code entry.');

const variantRandomValues = [0, 0, 0, 0.999];
const variantMachine = new PoseTransitionStateMachine({
    clips: discoveredClips,
    random: () => variantRandomValues.shift() ?? 0.5
});
assert(variantMachine.start().animation.endsWith('talk_H_H_01'), 'The first H_H iteration should be playable.');
assert(
    variantMachine.complete('GameAnims/Talking/talk_H_H_01').animation.endsWith('talk_H_H_02'),
    'Recent-variant suppression should explore another iteration of the same edge.'
);

const subtleMachine = new PoseTransitionStateMachine({ clips, random: () => 0 });
assert(subtleMachine.start().animation === 'H_H', 'The highest-weight H clip should be selectable.');
assert(subtleMachine.complete('H_H').animation === 'H_H', 'H_H should chain from H back to H.');

const gestureMachine = new PoseTransitionStateMachine({ clips, random: () => 0.999 });
assert(gestureMachine.start().animation === 'H_A', 'The H_A gesture branch should be selectable.');
assert(gestureMachine.complete('H_A').animation === 'A_B', 'The A_B gesture branch should be selectable.');
assert(gestureMachine.complete('A_B').animation === 'B_C', 'B must continue with a B-starting clip.');
assert(gestureMachine.complete('B_C').animation === 'C_D', 'The large C_D branch should be selectable.');
assert(gestureMachine.complete('C_D').animation === 'D_E', 'D must continue with a D-starting clip.');

gestureMachine.stop();
const returnPath = [];
let returnClip = gestureMachine.currentClip;
while (returnClip) {
    returnPath.push(returnClip.animation);
    returnClip = gestureMachine.complete(returnClip.animation);
}
assert(returnPath.join(',') === 'D_E,E_F,F_G,G_A,A_H', 'Stopping should follow the compatible path back to H.');
assert(gestureMachine.snapshot().pose === 'H', 'The stopped machine should finish in H.');

const fakeAnimationState = {
    current: null,
    setAnimation(_trackIndex, animationName) {
        this.current = { animation: { name: animationName }, listener: null };
        return this.current;
    },
    getCurrent() {
        return this.current;
    },
    clearTrack() {
        this.current = null;
    }
};
const controllerMachine = new PoseTransitionStateMachine({ clips, random: () => 0 });
const playedAnimations = [];
const controller = new SpineTalkingController({
    machine: controllerMachine,
    animationState: fakeAnimationState,
    setAnimation(animationName) {
        playedAnimations.push(animationName);
        return fakeAnimationState.setAnimation(4, animationName);
    }
});

controller.start();
assert(playedAnimations[0] === 'H_H', 'The Spine adapter should play the selected clip.');
fakeAnimationState.current.listener.complete(fakeAnimationState.current);
assert(playedAnimations[1] === 'H_H', 'The Spine adapter should chain after completion.');
controller.stop();
fakeAnimationState.current.listener.complete(fakeAnimationState.current);
assert(fakeAnimationState.current === null, 'The Spine adapter should clear its track after returning home.');

console.log('Weighted talking state machine OK.');
