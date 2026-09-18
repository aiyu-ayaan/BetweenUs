import { HeadphonesIcon } from './icons';

export function testIcons(): void {
  if (typeof HeadphonesIcon !== 'function') {
    throw new Error('HeadphonesIcon must be exported as a React functional component');
  }
}

testIcons();
console.log('icons.check.ts passed');
