import assert from 'node:assert/strict';
import { MOBILE_BREAKPOINT, isMobileScreen, isTouchDevice } from './responsive';

assert.equal(MOBILE_BREAKPOINT, 768, 'Mobile breakpoint should be 768px');

// In node environment without window, isMobileScreen should safely return false without throwing
assert.equal(typeof isMobileScreen(), 'boolean');
assert.equal(isMobileScreen(), false);

// In node environment without window, isTouchDevice should safely return false without throwing
assert.equal(typeof isTouchDevice(), 'boolean');
assert.equal(isTouchDevice(), false);

// Test with simulated window object in Node environment
const originalWindow = (globalThis as any).window;

try {
  // Test desktop resolution
  (globalThis as any).window = { innerWidth: 1024 };
  assert.equal(isMobileScreen(), false, '1024px width should not be mobile screen');

  // Test mobile breakpoint boundaries
  (globalThis as any).window = { innerWidth: 768 };
  assert.equal(isMobileScreen(), false, '768px width should not be mobile screen (< 768)');

  (globalThis as any).window = { innerWidth: 767 };
  assert.equal(isMobileScreen(), true, '767px width should be mobile screen');

  (globalThis as any).window = { innerWidth: 375 };
  assert.equal(isMobileScreen(), true, '375px width should be mobile screen');

  // Test touch device detection via window
  (globalThis as any).window = { ontouchstart: null };
  assert.equal(isTouchDevice(), true, 'ontouchstart in window should detect touch');

  // Test touch device detection via navigator.maxTouchPoints
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(globalThis.navigator, 'maxTouchPoints');
  try {
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });
    (globalThis as any).window = {};
    assert.equal(isTouchDevice(), true, 'maxTouchPoints > 0 should detect touch');

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true,
    });
    assert.equal(isTouchDevice(), false, 'no touch properties should not detect touch');
  } finally {
    if (originalMaxTouchPoints) {
      Object.defineProperty(globalThis.navigator, 'maxTouchPoints', originalMaxTouchPoints);
    } else {
      delete (globalThis.navigator as any).maxTouchPoints;
    }
  }
} finally {
  (globalThis as any).window = originalWindow;
}

console.log('responsive.check.ts ok');
