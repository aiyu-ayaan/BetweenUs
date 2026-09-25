/**
 * The system audio a screen share carries, minus this app.
 *
 * Electron's display-media handler offers two kinds of system audio, `loopback`
 * and `loopbackWithMute`, and both are the machine's whole output mix. That
 * mix includes the call coming out of the speakers, so a share with audio sent
 * everybody's voice back to them a beat late. The renderer asks for
 * `restrictOwnAudio`, the constraint that would leave this app out, but the
 * handler picks the loopback device before Chromium ever reads it: it is
 * accepted and does nothing.
 *
 * What does work is what Windows itself offers for exactly this: WASAPI process
 * loopback, told to capture everything *except* one process tree. The tree is
 * this main process, which is the parent of the renderer and of Chromium's
 * audio service, so every sound this app plays is left out - the call, the
 * ringtone, a video in a chat - and everything else on the machine goes in.
 *
 * Same shape as `remote-input.ts`, for the same reasons: a PowerShell helper
 * that compiles its interop with `Add-Type`, so there is no native module, no
 * node-gyp and no binary to rebuild for every Electron. It writes raw PCM to
 * stdout - 48 kHz, stereo, 16-bit, interleaved - and the renderer turns that
 * back into a track (`src/services/share-audio.ts`).
 *
 * Windows 10 2004 or later. Anything that stops the helper from starting
 * resolves `start` to false, and the share falls back to the old whole-mix
 * loopback rather than going out silent.
 *
 * Linux is `share-audio-linux.ts`: PipeWire, the same PCM, the same channel to
 * the renderer. It has no whole-mix fallback - Electron's loopback is
 * Windows-only - so a Linux share whose capture fails goes out without sound.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, type WebContents } from 'electron';
import {
  linuxShareAudioSupported,
  startLinuxShareAudio,
  stopLinuxShareAudio,
} from './share-audio-linux';

/** Bytes in one frame: two channels of 16-bit samples. */
const FRAME_BYTES = 4;
/** `Add-Type` compiles on every start, which is most of the wait. */
const START_TIMEOUT_MS = 10_000;

const SCRIPT = `
param([int]$TargetProcess)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct BuWaveFormat {
  public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec;
  public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample;
  public ushort cbSize;
}

// AUDIOCLIENT_ACTIVATION_PARAMS with the PROCESS_LOOPBACK arm of its union.
[StructLayout(LayoutKind.Sequential)]
public struct BuActivationParams {
  public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode;
}

// A PROPVARIANT holding a VT_BLOB. The blob's pointer is pointer-aligned, which
// sequential layout gets right on both 32- and 64-bit.
[StructLayout(LayoutKind.Sequential)]
public struct BuPropVariant {
  public ushort vt; public ushort r1; public ushort r2; public ushort r3;
  public uint cbSize; public IntPtr pBlobData;
}

[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BuActivateOperation {
  void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
}

[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BuActivateHandler {
  void ActivateCompleted(BuActivateOperation operation);
}

// The completion arrives on a worker thread, and Windows refuses a handler that
// is not agile.
[ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BuAgileObject {}

[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BuAudioClient {
  [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, ref BuWaveFormat format, IntPtr sessionGuid);
  [PreserveSig] int GetBufferSize(out uint frames);
  [PreserveSig] int GetStreamLatency(out long latency);
  [PreserveSig] int GetCurrentPadding(out uint padding);
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, IntPtr closest);
  [PreserveSig] int GetMixFormat(out IntPtr format);
  [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr handle);
  [PreserveSig] int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface BuCaptureClient {
  [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
  [PreserveSig] int ReleaseBuffer(uint frames);
  [PreserveSig] int GetNextPacketSize(out uint frames);
}

[ClassInterface(ClassInterfaceType.None)]
public class BuCompletion : BuActivateHandler, BuAgileObject {
  public readonly ManualResetEvent Done = new ManualResetEvent(false);
  public void ActivateCompleted(BuActivateOperation operation) { Done.Set(); }
}

public static class BetweenUsShareAudio {
  [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
  static extern void ActivateAudioInterfaceAsync(
    [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    IntPtr activationParams,
    BuActivateHandler completionHandler,
    out BuActivateOperation operation);

  const int PROCESS_LOOPBACK = 1;
  const int EXCLUDE_TARGET_PROCESS_TREE = 1;
  const ushort VT_BLOB = 65;
  const uint LOOPBACK = 0x00020000, EVENTCALLBACK = 0x00040000;
  const uint AUTOCONVERTPCM = 0x80000000, SRC_DEFAULT_QUALITY = 0x08000000;
  const uint BUFFER_SILENT = 0x2;

  static void Check(int hr, string what) {
    if (hr < 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8"));
  }

  // On its own MTA thread: the audio client is free-threaded, and PowerShell's
  // own thread is single-threaded, which would marshal every call through it.
  public static void Run(int targetProcess) {
    Exception failure = null;
    var worker = new Thread(() => {
      try { Capture(targetProcess); } catch (Exception e) { failure = e; }
    });
    worker.SetApartmentState(ApartmentState.MTA);
    worker.Start();
    worker.Join();
    if (failure != null) throw failure;
  }

  static void Capture(int targetProcess) {
    // The parent closing stdin is the signal to stop, and the only one needed:
    // with nothing playing there may be no packets, so a broken stdout pipe
    // alone would leave this running after the app has gone.
    var watcher = new Thread(() => {
      var input = Console.OpenStandardInput();
      var scratch = new byte[64];
      while (input.Read(scratch, 0, scratch.Length) > 0) {}
      Environment.Exit(0);
    });
    watcher.IsBackground = true;
    watcher.Start();

    var activation = new BuActivationParams {
      ActivationType = PROCESS_LOOPBACK,
      TargetProcessId = (uint)targetProcess,
      ProcessLoopbackMode = EXCLUDE_TARGET_PROCESS_TREE,
    };
    IntPtr activationPtr = Marshal.AllocHGlobal(Marshal.SizeOf(activation));
    Marshal.StructureToPtr(activation, activationPtr, false);
    var variant = new BuPropVariant {
      vt = VT_BLOB, cbSize = (uint)Marshal.SizeOf(activation), pBlobData = activationPtr,
    };
    IntPtr variantPtr = Marshal.AllocHGlobal(Marshal.SizeOf(variant));
    Marshal.StructureToPtr(variant, variantPtr, false);

    var completion = new BuCompletion();
    BuActivateOperation operation;
    ActivateAudioInterfaceAsync(
      "VAD\\\\Process_Loopback", typeof(BuAudioClient).GUID, variantPtr, completion, out operation);
    if (!completion.Done.WaitOne(5000)) throw new Exception("activation timed out");

    int activated; object activatedInterface;
    operation.GetActivateResult(out activated, out activatedInterface);
    Check(activated, "activation");
    var client = (BuAudioClient)activatedInterface;

    // Process loopback has no mix format to ask for; it converts to the one
    // it is given.
    var format = new BuWaveFormat {
      wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16,
      nBlockAlign = 4, nAvgBytesPerSec = 48000 * 4, cbSize = 0,
    };
    Check(client.Initialize(0, LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY,
      200000, 0, ref format, IntPtr.Zero), "Initialize");

    var ready = new AutoResetEvent(false);
    Check(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()), "SetEventHandle");
    object service;
    Check(client.GetService(typeof(BuCaptureClient).GUID, out service), "GetService");
    var capture = (BuCaptureClient)service;
    Check(client.Start(), "Start");

    Stream output = Console.OpenStandardOutput();
    Console.Error.WriteLine("ready");
    Console.Error.Flush();

    byte[] buffer = new byte[48000 * 4];
    while (true) {
      ready.WaitOne(100);
      uint packet;
      while (capture.GetNextPacketSize(out packet) >= 0 && packet > 0) {
        IntPtr data; uint frames, flags; ulong devicePosition, qpcPosition;
        Check(capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition), "GetBuffer");
        int bytes = (int)frames * 4;
        if (bytes > buffer.Length) buffer = new byte[bytes];
        if ((flags & BUFFER_SILENT) != 0) Array.Clear(buffer, 0, bytes);
        else Marshal.Copy(data, buffer, 0, bytes);
        capture.ReleaseBuffer(frames);
        output.Write(buffer, 0, bytes);
      }
      output.Flush();
    }
  }
}
"@

[BetweenUsShareAudio]::Run($TargetProcess)
`;

let helper: ChildProcessWithoutNullStreams | null = null;

export function shareAudioSupported(): boolean {
  if (process.platform === 'linux') return linuxShareAudioSupported();
  return process.platform === 'win32';
}

/**
 * Hands PCM to `target` in whole frames. stdout arrives in whatever pieces the
 * pipe cuts it into, and a frame split across two of them would swap the
 * channels for the rest of the share.
 */
function framesTo(target: WebContents): (chunk: Buffer) => void {
  let partial: Buffer = Buffer.alloc(0);
  return (chunk) => {
    const joined = partial.length > 0 ? Buffer.concat([partial, chunk]) : chunk;
    const whole = joined.length - (joined.length % FRAME_BYTES);
    partial = joined.subarray(whole);
    if (whole > 0 && !target.isDestroyed()) target.send('share-audio:pcm', joined.subarray(0, whole));
  };
}

function scriptPath(): string {
  const file = path.join(app.getPath('userData'), 'betweenus-share-audio.ps1');
  // Rewritten every start, like the input helper: a copy left by an older
  // version would be worse than none.
  fs.writeFileSync(file, SCRIPT, 'utf8');
  return file;
}

/**
 * Starts capturing and streams it to `target` as `share-audio:pcm`. Resolves
 * true once the audio client is running, false if it never got there.
 */
export function startShareAudio(target: WebContents): Promise<boolean> {
  stopShareAudio();
  if (!shareAudioSupported()) return Promise.resolve(false);
  if (process.platform === 'linux') {
    // Every process this app runs, the audio service among them: those are the
    // streams that must stay out of the share.
    return startLinuxShareAudio(framesTo(target), () =>
      app.getAppMetrics().map((metric) => metric.pid),
    );
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath(),
        String(process.pid),
      ],
      { windowsHide: true },
    );
  } catch (error) {
    console.error('[share-audio]', error instanceof Error ? error.message : error);
    return Promise.resolve(false);
  }
  helper = child;

  child.stdout.on('data', framesTo(target));

  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) stopShareAudio();
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), START_TIMEOUT_MS);

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (/^ready\b/m.test(text)) return settle(true);
      console.error('[share-audio]', text.trim().split('\n')[0]);
    });
    child.on('exit', () => {
      if (helper === child) helper = null;
      settle(false);
    });
  });
}

/** Ends the capture. Called when the share stops, and on quit. */
export function stopShareAudio(): void {
  stopLinuxShareAudio();
  const child = helper;
  helper = null;
  if (!child) return;
  child.stdin.end();
  child.kill();
}
