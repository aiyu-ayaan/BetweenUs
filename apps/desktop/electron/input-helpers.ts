/**
 * The long-lived helper programs for macOS and Linux. Each reads the one-line
 * protocol `input-keymap.ts` encodes and turns a line into one operating
 * system call. Neither needs anything compiled at install time: the Linux one
 * is Python's ctypes over libX11/libXtst, the macOS one is JavaScript for
 * Automation, which ships with the OS.
 */

/**
 * Linux, X11 only, through the XTEST extension. `--probe` connects, checks the
 * extension is there and exits without sending a single event, which is how
 * "is control available" is answered without touching the desktop.
 */
export const LINUX_SCRIPT = `
import sys, ctypes, ctypes.util

def fail(message):
    sys.stderr.write(message + "\\n")
    sys.stderr.flush()
    sys.exit(2)

x11_name = ctypes.util.find_library("X11")
xtst_name = ctypes.util.find_library("Xtst")
if not x11_name or not xtst_name:
    fail("libX11 and libXtst are needed for remote control and were not found")

X = ctypes.CDLL(x11_name)
T = ctypes.CDLL(xtst_name)
X.XOpenDisplay.restype = ctypes.c_void_p
X.XOpenDisplay.argtypes = [ctypes.c_char_p]
display = X.XOpenDisplay(None)
if not display:
    fail("Cannot open the X display")

a, b, c, d = (ctypes.c_int() for _ in range(4))
T.XTestQueryExtension.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_int)] * 4
if not T.XTestQueryExtension(display, ctypes.byref(a), ctypes.byref(b), ctypes.byref(c), ctypes.byref(d)):
    fail("This X server does not offer the XTEST extension")

if "--probe" in sys.argv:
    print("ok")
    sys.exit(0)

X.XKeysymToKeycode.restype = ctypes.c_ubyte
X.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X.XKeycodeToKeysym.restype = ctypes.c_ulong
X.XKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_int]
X.XFlush.argtypes = [ctypes.c_void_p]
T.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
T.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
T.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

SHIFT = 0xffe1

def key(keysym, down):
    code = X.XKeysymToKeycode(display, keysym)
    if code == 0:
        return
    # A keysym that sits on the shifted level of its key needs Shift held around it.
    shifted = X.XKeycodeToKeysym(display, code, 0) != keysym and X.XKeycodeToKeysym(display, code, 1) == keysym
    shift_code = X.XKeysymToKeycode(display, SHIFT)
    if shifted and down:
        T.XTestFakeKeyEvent(display, shift_code, 1, 0)
    T.XTestFakeKeyEvent(display, code, 1 if down else 0, 0)
    if shifted and not down:
        T.XTestFakeKeyEvent(display, shift_code, 0, 0)

def move(x, y):
    T.XTestFakeMotionEvent(display, -1, x, y, 0)

def button(number, down):
    T.XTestFakeButtonEvent(display, number, 1 if down else 0, 0)

for line in sys.stdin:
    p = line.split()
    try:
        if p[0] == "m":
            move(int(p[1]), int(p[2]))
        elif p[0] == "d":
            move(int(p[2]), int(p[3]))
            button(int(p[1]), True)
        elif p[0] == "u":
            button(int(p[1]), False)
        elif p[0] == "w":
            n = int(p[1])
            for _ in range(min(abs(n), 10)):
                button(4 if n > 0 else 5, True)
                button(4 if n > 0 else 5, False)
        elif p[0] == "k":
            key(int(p[2]), p[1] == "down")
        X.XFlush(display)
    except Exception:
        # One malformed line must not end the session's input.
        pass
`;

/**
 * macOS, through CGEventPost, run by \`osascript -l JavaScript\`. Needs the
 * Accessibility permission for whatever launched it; without it events are
 * dropped by the system, so the helper checks and says so on stderr.
 *
 * UNVERIFIED: written against the documented CoreGraphics API and never run,
 * because no Mac was available. It is the least trustworthy file in the repo.
 */
export const MACOS_SCRIPT = `
ObjC.import('ApplicationServices');
ObjC.import('Foundation');

function say(message) {
  $.NSFileHandle.fileHandleWithStandardError.writeData(
    $(message + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}

if (!$.AXIsProcessTrusted()) {
  say('Accessibility permission is needed: System Settings > Privacy & Security > Accessibility');
}

var FLAGS = { 56: 0x20000, 60: 0x20000, 59: 0x40000, 62: 0x40000, 58: 0x80000, 61: 0x80000, 55: 0x100000, 54: 0x100000 };
var mask = 0;
var held = -1;
var DRAG = [6, 7, 27];
var UP = [2, 4, 26];
var DOWN = [1, 3, 25];

function post(ev) { $.CGEventPost($.kCGHIDEventTap, ev); }
function point(x, y) { return $.CGPointMake(x, y); }
function pos(x, y) {
  if (held >= 0) return post($.CGEventCreateMouseEvent(null, DRAG[held], point(x, y), held));
  return post($.CGEventCreateMouseEvent(null, 5, point(x, y), 0));
}

function handle(line) {
  var p = line.split(' ');
  if (p[0] === 'm') { pos(+p[1], +p[2]); }
  else if (p[0] === 'd') {
    var b = +p[1];
    pos(+p[2], +p[3]);
    held = b;
    post($.CGEventCreateMouseEvent(null, DOWN[b], point(+p[2], +p[3]), b));
  }
  else if (p[0] === 'u') {
    var u = +p[1];
    held = -1;
    var here = $.CGEventGetLocation($.CGEventCreate(null));
    post($.CGEventCreateMouseEvent(null, UP[u], here, u));
  }
  else if (p[0] === 'w') { post($.CGEventCreateScrollWheelEvent(null, 1, 1, +p[1])); }
  else if (p[0] === 'k') {
    var code = +p[2];
    var down = p[1] === 'down';
    if (FLAGS[code]) { mask = down ? (mask | FLAGS[code]) : (mask & ~FLAGS[code]); }
    var ev = $.CGEventCreateKeyboardEvent(null, code, down);
    $.CGEventSetFlags(ev, mask);
    post(ev);
  }
}

var input = $.NSFileHandle.fileHandleWithStandardInput;
var pending = '';
while (true) {
  var data = input.availableData;
  if (data.length === 0) break;
  pending += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  var lines = pending.split('\\n');
  pending = lines.pop();
  for (var i = 0; i < lines.length; i++) {
    try { handle(lines[i]); } catch (e) { }
  }
}
`;
