/**
 * The system audio a screen share carries on Linux, minus this app.
 *
 * The Windows half (`share-audio.ts`) asks WASAPI for everything except one
 * process tree. PipeWire has no such switch, but it has something better suited
 * to it: a graph anybody can add links to. So this runs `pw-record` as a capture
 * stream that the session manager is told not to connect (`--target 0`), and
 * links every application's playback stream into it - *alongside* the link that
 * stream already has to the speakers, not instead of it, so nothing the user
 * hears changes. The streams this app plays are never linked, which is the
 * whole point: the call, the ringtone, a video in a chat stay out, and
 * everything else on the machine goes in.
 *
 * Streams come and go while a share runs - a video starts, a game launches - so
 * the graph is read again every `RELINK_MS` and whatever is new is linked.
 * PipeWire mixes several links into one input port on its own.
 *
 * `pw-record` writes the same PCM the Windows helper does - 48 kHz, stereo,
 * 16-bit, interleaved - so the renderer half (`src/services/share-audio.ts`) is
 * shared. It needs PipeWire (the default on current Ubuntu, Fedora, Debian and
 * Arch) with `pw-record`, `pw-dump` and `pw-link` installed; on anything else
 * `linuxShareAudioSupported` is false and the picker does not offer audio.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The capture node's name, which is how it is found again in the graph. */
export const RECORDER_NAME = 'betweenus-share-audio';
/** How often the graph is re-read for streams that started after the share. */
const RELINK_MS = 1_500;
/** How long the capture node has to appear before the share goes without it. */
const START_TIMEOUT_MS = 5_000;

const TOOLS = ['pw-record', 'pw-dump', 'pw-link'] as const;

let supported: boolean | null = null;

/** Whether every tool this needs is on `PATH`. Asked once; it does not change. */
export function linuxShareAudioSupported(): boolean {
  if (supported !== null) return supported;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  supported =
    process.platform === 'linux' &&
    TOOLS.every((tool) =>
      dirs.some((dir) => {
        try {
          fs.accessSync(path.join(dir, tool), fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    );
  return supported;
}

/** The parts of a `pw-dump` object this reads. Everything else is ignored. */
interface DumpObject {
  id: number;
  type: string;
  info?: {
    props?: Record<string, unknown>;
    'output-port-id'?: number;
    'input-port-id'?: number;
  };
}

/**
 * Which recorder input a playback channel goes into.
 *
 * Stereo is the case that matters. A mono stream goes to both sides, and so do
 * a surround stream's centre and LFE, which would otherwise be lost from
 * dialogue-heavy 5.1 audio.
 */
export function recorderChannels(channel: string): ('FL' | 'FR')[] {
  switch (channel) {
    case 'FL':
    case 'RL':
    case 'SL':
    case 'FLC':
      return ['FL'];
    case 'FR':
    case 'RR':
    case 'SR':
    case 'FRC':
      return ['FR'];
    default:
      return ['FL', 'FR'];
  }
}

function props(object: DumpObject): Record<string, unknown> {
  return object.info?.props ?? {};
}

/**
 * A node's process id. Pulse clients - Chromium, Firefox - put it on the node
 * itself; native PipeWire clients such as `pw-record` put it only on their
 * client object, which the node names in `client.id`.
 */
function processOf(dump: readonly DumpObject[]): (node: DumpObject) => number {
  const clients = new Map<number, number>();
  for (const object of dump) {
    if (object.type === 'PipeWire:Interface:Client') {
      clients.set(object.id, Number(props(object)['application.process.id']));
    }
  }
  return (node) => {
    const own = props(node)['application.process.id'];
    if (own !== undefined) return Number(own);
    return clients.get(Number(props(node)['client.id'])) ?? Number.NaN;
  };
}

/** This share's recorder node, once it is in the graph. */
export function recorderNode(dump: readonly DumpObject[], recorderPid: number): DumpObject | null {
  const pidOf = processOf(dump);
  return (
    dump.find(
      (object) =>
        object.type === 'PipeWire:Interface:Node' &&
        props(object)['node.name'] === RECORDER_NAME &&
        pidOf(object) === recorderPid,
    ) ?? null
  );
}

/**
 * The links to add, as `[output port id, input port id]` pairs, given the whole
 * graph as `pw-dump` prints it.
 *
 * `recorderPid` picks this share's recorder out of the graph, so a recorder
 * left behind by a crashed share is never mistaken for it. `ownPids` are this
 * app's processes: their streams are the ones never linked. Links that already
 * exist are skipped, so calling this again on an unchanged graph returns
 * nothing.
 */
export function plannedLinks(
  dump: readonly DumpObject[],
  recorderPid: number,
  ownPids: ReadonlySet<number>,
): [number, number][] {
  const recorder = recorderNode(dump, recorderPid);
  if (!recorder) return [];
  const pidOf = processOf(dump);

  const nodes = dump.filter((object) => object.type === 'PipeWire:Interface:Node');
  // Applications playing sound. Not sinks: a sink's monitor is the whole mix
  // again, this app included.
  const sources = new Set(
    nodes
      .filter(
        (node) =>
          props(node)['media.class'] === 'Stream/Output/Audio' &&
          node.id !== recorder.id &&
          !ownPids.has(pidOf(node)),
      )
      .map((node) => node.id),
  );

  const ports = dump.filter((object) => object.type === 'PipeWire:Interface:Port');
  const inputs = new Map<string, number>();
  for (const port of ports) {
    const p = props(port);
    if (Number(p['node.id']) === recorder.id && p['port.direction'] === 'in') {
      inputs.set(String(p['audio.channel'] ?? ''), port.id);
    }
  }

  const linked = new Set(
    dump
      .filter((object) => object.type === 'PipeWire:Interface:Link')
      .map((link) => `${link.info?.['output-port-id']}:${link.info?.['input-port-id']}`),
  );

  const planned: [number, number][] = [];
  for (const port of ports) {
    const p = props(port);
    if (!sources.has(Number(p['node.id'])) || p['port.direction'] !== 'out') continue;
    // A stream's monitor ports carry what it plays, but so do its outputs;
    // taking both would play everything twice.
    if (p['port.monitor'] === true) continue;
    for (const channel of recorderChannels(String(p['audio.channel'] ?? ''))) {
      const input = inputs.get(channel);
      if (input === undefined || linked.has(`${port.id}:${input}`)) continue;
      planned.push([port.id, input]);
    }
  }
  return planned;
}

let recorder: ChildProcessWithoutNullStreams | null = null;
let relinkTimer: ReturnType<typeof setTimeout> | null = null;

function readGraph(): Promise<DumpObject[]> {
  return new Promise((resolve) => {
    execFile('pw-dump', { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      try {
        const parsed: unknown = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? (parsed as DumpObject[]) : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function link(output: number, input: number): Promise<void> {
  return new Promise((resolve) => {
    // A link that raced into existence since the graph was read fails here,
    // and that is the outcome that was wanted anyway.
    execFile('pw-link', [String(output), String(input)], () => resolve());
  });
}

/**
 * Starts the capture and hands its PCM to `onPcm` in the pieces the pipe cuts
 * it into. Resolves true once the recorder is in the graph, false if it never
 * got there. `ownPids` is asked on every pass, because this app starts and
 * stops processes of its own while a share runs.
 */
export function startLinuxShareAudio(
  onPcm: (chunk: Buffer) => void,
  ownPids: () => number[],
): Promise<boolean> {
  stopLinuxShareAudio();
  if (!linuxShareAudioSupported()) return Promise.resolve(false);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn('pw-record', [
      '--target',
      '0',
      '-P',
      `{ node.name = "${RECORDER_NAME}", node.description = "BetweenUs screen share", media.role = "Communication" }`,
      '--rate',
      '48000',
      '--channels',
      '2',
      '--format',
      's16',
      '-',
    ]);
  } catch (error) {
    console.error('[share-audio]', error instanceof Error ? error.message : error);
    return Promise.resolve(false);
  }
  recorder = child;
  child.stdout.on('data', onPcm);
  child.stderr.on('data', (chunk: Buffer) => {
    console.error('[share-audio]', chunk.toString().trim().split('\n')[0]);
  });

  const pass = async (): Promise<boolean> => {
    const graph = await readGraph();
    if (recorder !== child || child.pid === undefined) return false;
    const pids = new Set([process.pid, ...ownPids()]);
    for (const [output, input] of plannedLinks(graph, child.pid, pids)) await link(output, input);
    return recorderNode(graph, child.pid) !== null;
  };

  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) stopLinuxShareAudio();
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), START_TIMEOUT_MS);
    child.on('exit', () => {
      if (recorder === child) stopLinuxShareAudio();
      settle(false);
    });

    // Quick while waiting for the node to appear, which takes a moment after
    // the process starts, then at the steady rate.
    const tick = async (): Promise<void> => {
      if (recorder !== child) return;
      if (await pass()) settle(true);
      if (recorder === child) relinkTimer = setTimeout(() => void tick(), settled ? RELINK_MS : 200);
    };
    void tick();
  });
}

/** Ends the capture. The links go with the recorder's node. */
export function stopLinuxShareAudio(): void {
  if (relinkTimer) clearTimeout(relinkTimer);
  relinkTimer = null;
  const child = recorder;
  recorder = null;
  child?.kill();
}
