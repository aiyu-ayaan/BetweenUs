/**
 * Self-check for which PipeWire streams a Linux share's audio takes.
 *
 * The rule that matters is the one a regression would break silently: this
 * app's own streams - the call - are never linked, or everybody in it hears
 * themselves a beat late.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { RECORDER_NAME, plannedLinks, recorderChannels } from './share-audio-linux';

const node = (id: number, props: Record<string, unknown>) => ({
  id,
  type: 'PipeWire:Interface:Node',
  info: { props },
});
const port = (id: number, nodeId: number, direction: 'in' | 'out', channel: string, extra = {}) => ({
  id,
  type: 'PipeWire:Interface:Port',
  info: { props: { 'node.id': nodeId, 'port.direction': direction, 'audio.channel': channel, ...extra } },
});
const link = (id: number, output: number, input: number) => ({
  id,
  type: 'PipeWire:Interface:Link',
  info: { 'output-port-id': output, 'input-port-id': input },
});

const RECORDER_PID = 500;
const APP_PID = 100;

const graph = [
  // This share's recorder.
  node(10, { 'node.name': RECORDER_NAME, 'application.process.id': RECORDER_PID, 'media.class': 'Stream/Input/Audio' }),
  port(11, 10, 'in', 'FL'),
  port(12, 10, 'in', 'FR'),
  // A browser playing a film: taken.
  node(20, { 'media.class': 'Stream/Output/Audio', 'application.process.id': 300 }),
  port(21, 20, 'out', 'FL'),
  port(22, 20, 'out', 'FR'),
  // This app's audio service playing the call: never taken.
  node(30, { 'media.class': 'Stream/Output/Audio', 'application.process.id': APP_PID }),
  port(31, 30, 'out', 'FL'),
  port(32, 30, 'out', 'FR'),
  // The speakers. A sink's monitor is the whole mix again, call included.
  node(40, { 'media.class': 'Audio/Sink' }),
  port(41, 40, 'out', 'FL', { 'port.monitor': true }),
  // A microphone recorder somebody else runs: an input, not a source.
  node(50, { 'media.class': 'Stream/Input/Audio', 'application.process.id': 301 }),
  port(51, 50, 'in', 'FL'),
];

assert.deepEqual(
  plannedLinks(graph, RECORDER_PID, new Set([APP_PID])),
  [
    [21, 11],
    [22, 12],
  ],
);

// Once linked, a second pass over the same graph adds nothing.
assert.deepEqual(
  plannedLinks([...graph, link(90, 21, 11), link(91, 22, 12)], RECORDER_PID, new Set([APP_PID])),
  [],
);

// A recorder left behind by another process is not this share's.
assert.deepEqual(plannedLinks(graph, 999, new Set([APP_PID])), []);

// `pw-record` is a native PipeWire client: its pid is on the client object,
// not the node, and it is still found.
assert.deepEqual(
  plannedLinks(
    [
      { id: 7, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': 700 } } },
      node(70, { 'node.name': RECORDER_NAME, 'client.id': 7, 'media.class': 'Stream/Input/Audio' }),
      port(71, 70, 'in', 'FL'),
      port(72, 70, 'in', 'FR'),
      ...graph.slice(3),
    ],
    700,
    new Set([APP_PID]),
  ),
  [
    [21, 71],
    [22, 72],
  ],
);

// A mono stream is heard on both sides.
assert.deepEqual(
  plannedLinks(
    [
      ...graph,
      node(60, { 'media.class': 'Stream/Output/Audio', 'application.process.id': 302 }),
      port(61, 60, 'out', 'MONO'),
    ],
    RECORDER_PID,
    new Set([APP_PID]),
  ).filter(([output]) => output === 61),
  [
    [61, 11],
    [61, 12],
  ],
);

// Surround folds onto stereo: sides to their side, centre and LFE to both.
assert.deepEqual(recorderChannels('RL'), ['FL']);
assert.deepEqual(recorderChannels('SR'), ['FR']);
assert.deepEqual(recorderChannels('FC'), ['FL', 'FR']);
assert.deepEqual(recorderChannels('LFE'), ['FL', 'FR']);

console.log('share-audio-linux check ok');
